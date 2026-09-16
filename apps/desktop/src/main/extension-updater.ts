import type { App } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { compareVersions, type AppReleaseConfig } from "@yiqikan/shared";

let app: App | undefined;
try {
  const electron = await import("electron");
  app = (electron as any)?.app || (electron as any)?.default?.app;
} catch {
  // Fallback for non-electron or testing environments
}

export interface ExtensionUpdateResult {
  checked: boolean;
  updated: boolean;
  currentVersion: string;
  targetVersion?: string;
  error?: string;
  path?: string;
}

interface ActiveExtensionRecord {
  version: string;
  path: string;
  hash: string;
  updatedAt: number;
}

export function getRuntimeExtensionsDir(customUserData?: string): string {
  const base = customUserData || (typeof app !== "undefined" && app?.getPath ? app.getPath("userData") : null) || join(tmpdir(), "yiqikan-desktop-extensions");
  return join(base, "runtime-extensions");
}

export function getActiveRecordPath(customUserData?: string): string {
  return join(getRuntimeExtensionsDir(customUserData), "active.json");
}

/**
 * Reads manifest.json version from a given directory
 */
export function getExtensionVersionFromDir(dirPath: string | null | undefined): string | null {
  if (!dirPath || !existsSync(dirPath)) return null;
  const manifestPath = join(dirPath, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Returns the currently active hot-updated extension path if available and intact
 */
export function getActiveHotExtensionPath(customUserData?: string): string | null {
  try {
    const recordPath = getActiveRecordPath(customUserData);
    if (!existsSync(recordPath)) return null;

    const raw = readFileSync(recordPath, "utf-8");
    const record: ActiveExtensionRecord = JSON.parse(raw);

    if (record?.path && existsSync(record.path)) {
      const manifestVersion = getExtensionVersionFromDir(record.path);
      if (manifestVersion && manifestVersion === record.version) {
        return record.path;
      }
    }
  } catch (err) {
    console.warn("[Desktop Extension OTA] Failed to read active extension record:", err);
  }
  return null;
}

/**
 * Resolves the active extension directory following multi-level fallback:
 * 1. Active hot-updated extension in userData/runtime-extensions/vX.Y.Z
 * 2. Packaged factory builtin extension in Resources/extension
 * 3. Local source tree in development
 */
export function resolveEffectiveExtensionPath(
  fallbackBuiltinPath: string | null,
  customUserData?: string,
  forceAppPackaged?: boolean
): string | null {
  const isPackaged = forceAppPackaged ?? (typeof app !== "undefined" ? app.isPackaged : false);
  // In development without forceAppPackaged, prioritize local source tree
  if (!isPackaged) {
    return fallbackBuiltinPath;
  }

  const hotPath = getActiveHotExtensionPath(customUserData);
  if (hotPath) {
    console.info(`[Desktop Extension OTA] Using active hot-updated extension: ${hotPath}`);
    return hotPath;
  }

  return fallbackBuiltinPath;
}

/**
 * Checks for extension updates against remote /api/release-config
 * Downloads, verifies SHA-256, and extracts to userData/runtime-extensions/
 */
export async function checkForExtensionUpdate(options?: {
  releaseConfigUrl?: string;
  fallbackBuiltinPath?: string | null;
  customUserDataDir?: string;
  forceAppPackaged?: boolean;
}): Promise<ExtensionUpdateResult> {
  const currentEffectivePath = resolveEffectiveExtensionPath(
    options?.fallbackBuiltinPath ?? null,
    options?.customUserDataDir,
    options?.forceAppPackaged
  );
  const currentVersion = getExtensionVersionFromDir(currentEffectivePath) || "0.0.0";

  let baseUrl = "https://yiqikan.club";
  if (process.env.YIQIKAN_ONLINE_ROOM_URL) {
    try {
      const u = new URL(process.env.YIQIKAN_ONLINE_ROOM_URL);
      baseUrl = u.origin;
    } catch (_) {}
  }

  const targetApi = options?.releaseConfigUrl || `${baseUrl}/api/release-config`;
  const userAgent = typeof app !== "undefined" && app?.getVersion ? `YiqikanDesktop/${app.getVersion()}` : "YiqikanDesktop/1.17.0";

  try {
    const res = await fetch(targetApi, {
      cache: "no-store",
      headers: { "User-Agent": userAgent },
    });

    if (!res.ok) {
      return { checked: true, updated: false, currentVersion, error: `HTTP ${res.status}` };
    }

    const config = (await res.json()) as AppReleaseConfig;
    const extConfig = config.extension;

    if (!extConfig || !extConfig.version || !extConfig.downloadUrl) {
      return { checked: true, updated: false, currentVersion };
    }

    const targetVersion = extConfig.version.trim();
    const shouldUpdate = compareVersions(targetVersion, currentVersion) > 0;

    if (!shouldUpdate && !extConfig.forceUpdate) {
      return { checked: true, updated: false, currentVersion, targetVersion };
    }

    // Resolve download URL
    let downloadUrl = extConfig.downloadUrl.trim();
    if (downloadUrl.startsWith("/")) {
      downloadUrl = `${baseUrl}${downloadUrl}`;
    }

    console.info(`[Desktop Extension OTA] Found new extension v${targetVersion} (current: v${currentVersion}). Downloading from ${downloadUrl}...`);

    const zipRes = await fetch(downloadUrl);
    if (!zipRes.ok) {
      throw new Error(`Failed to download extension package: HTTP ${zipRes.status}`);
    }

    const arrayBuffer = await zipRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Verify SHA-256 hash if provided
    const expectedHash = extConfig.hash?.trim()?.toLowerCase();
    const computedHash = createHash("sha256").update(buffer).digest("hex").toLowerCase();

    if (expectedHash && expectedHash !== computedHash) {
      console.error(`[Desktop Extension OTA] Hash mismatch! Expected: ${expectedHash}, Computed: ${computedHash}`);
      return {
        checked: true,
        updated: false,
        currentVersion,
        targetVersion,
        error: `SHA-256 hash mismatch (expected: ${expectedHash.slice(0, 10)}, got: ${computedHash.slice(0, 10)})`,
      };
    }

    // Unpack to target directory
    const baseDir = getRuntimeExtensionsDir(options?.customUserDataDir);
    const targetDir = join(baseDir, `v${targetVersion}`);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const zip = new AdmZip(buffer);
    zip.extractAllTo(targetDir, true);

    const manifestVersion = getExtensionVersionFromDir(targetDir);
    if (!manifestVersion) {
      throw new Error("Extracted package is missing a valid manifest.json");
    }

    // Atomically write active pointer
    const record: ActiveExtensionRecord = {
      version: targetVersion,
      path: targetDir,
      hash: computedHash,
      updatedAt: Date.now(),
    };

    writeFileSync(getActiveRecordPath(options?.customUserDataDir), `${JSON.stringify(record, null, 2)}\n`, "utf-8");

    console.info(`[Desktop Extension OTA] ✅ Extension successfully hot-updated to v${targetVersion} at ${targetDir}`);

    return {
      checked: true,
      updated: true,
      currentVersion,
      targetVersion,
      path: targetDir,
    };
  } catch (error) {
    const msg = (error as Error).message;
    console.warn("[Desktop Extension OTA] Update check/install failed:", msg);
    return { checked: true, updated: false, currentVersion, error: msg };
  }
}
