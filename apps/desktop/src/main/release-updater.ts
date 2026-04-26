import { app, BrowserWindow, ipcMain, net } from "electron";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compareVersions } from "@yiqikan/shared";
import type { AppReleaseConfig } from "@yiqikan/shared";

declare const __DEV__: boolean;

const execFileAsync = promisify(execFile);
import {
  type RendererUpdateState,
  type ShellUpdateState,
  createInitialRendererUpdateState,
  createInitialShellUpdateState,
} from "../shared/renderer-update.js";

const RENDERER_UPDATE_CHANNEL = "yiqikan:renderer-update-state";
const SHELL_UPDATE_CHANNEL = "yiqikan:shell-update-state";

// Stored under userData so it survives app updates
const hotDir = join(app.getPath("userData"), "renderer-hot");
const hotIndexPath = join(hotDir, "index.html");
const hotVersionPath = join(hotDir, "version.txt");
const downloadingZipPath = join(hotDir, "pending.zip");

let rendererUpdateState = createInitialRendererUpdateState();
let shellUpdateState = createInitialShellUpdateState();
let releaseConfigUrl: string | null = null;
let checkTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

function readBooleanFlag(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function readOptionalUrl(value: string | undefined) {
  const v = value?.trim();
  return v || null;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function setRendererState(patch: Partial<RendererUpdateState>) {
  rendererUpdateState = { ...rendererUpdateState, ...patch };
  broadcast(RENDERER_UPDATE_CHANNEL, rendererUpdateState);
}

function setShellState(patch: Partial<ShellUpdateState>) {
  shellUpdateState = { ...shellUpdateState, ...patch };
  broadcast(SHELL_UPDATE_CHANNEL, shellUpdateState);
}

// Returns the installed hot renderer version, or null if not present
async function readHotVersion(): Promise<string | null> {
  try {
    const v = await readFile(hotVersionPath, "utf-8");
    return v.trim() || null;
  } catch {
    return null;
  }
}

// Returns path to hot renderer index.html if it exists, otherwise null
export function getHotRendererPath(): string | null {
  if (existsSync(hotIndexPath)) return hotIndexPath;
  return null;
}

async function downloadRendererZip(url: string): Promise<void> {
  await mkdir(hotDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const request = net.request(url);
    let received = 0;
    let total = 0;

    request.on("response", (response) => {
      const contentLength = response.headers["content-length"];
      total = contentLength ? Number(contentLength) : 0;

      const dest = createWriteStream(downloadingZipPath);
      response.on("data", (chunk) => {
        received += chunk.length;
        if (total > 0) {
          setRendererState({
            status: "downloading",
            progressPercent: Math.round((received / total) * 100),
            message: `热更下载中 ${Math.round((received / total) * 100)}%`,
          });
        }
        dest.write(chunk);
      });
      response.on("end", () => dest.end());
      dest.on("finish", resolve);
      dest.on("error", reject);
      response.on("error", reject);
    });

    request.on("error", reject);
    request.end();
  });
}

async function extractRendererZip(version: string): Promise<void> {
  const stagingDir = join(hotDir, "_staging");
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  // Use platform unzip — available on macOS/Linux; on Windows use PowerShell
  if (process.platform === "win32") {
    await execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -Force -Path "${downloadingZipPath}" -DestinationPath "${stagingDir}"`,
    ]);
  } else {
    await execFileAsync("unzip", ["-o", "-q", downloadingZipPath, "-d", stagingDir]);
  }

  // The zip may contain an index.html at root, or inside a single top-level folder
  const { readdir, cp } = await import("node:fs/promises");
  const entries = await readdir(stagingDir);
  let sourceDir = stagingDir;
  if (entries.length === 1) {
    const candidate = join(stagingDir, entries[0]!);
    const { stat } = await import("node:fs/promises");
    const s = await stat(candidate);
    if (s.isDirectory()) sourceDir = candidate;
  }

  const finalEntries = await readdir(sourceDir);
  for (const entry of finalEntries) {
    await cp(join(sourceDir, entry), join(hotDir, entry), { recursive: true, force: true });
  }

  await writeFile(hotVersionPath, version, "utf-8");
  await rm(stagingDir, { recursive: true, force: true });
  await rm(downloadingZipPath, { force: true });
}

async function fetchReleaseConfig(url: string): Promise<AppReleaseConfig | null> {
  try {
    const response = await new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve, reject) => {
      const req = net.request(url);
      req.on("response", (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve({
            ok: res.statusCode === 200,
            json: () => Promise.resolve(JSON.parse(body)),
          });
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });

    if (!response.ok) return null;
    return (await response.json()) as AppReleaseConfig;
  } catch {
    return null;
  }
}

async function runCheck() {
  if (!releaseConfigUrl) return;

  setRendererState({ status: "checking", message: "正在检查更新" });

  const config = await fetchReleaseConfig(releaseConfigUrl);
  if (!config) {
    setRendererState({ status: "error", message: "检查更新失败，无法连接服务器", error: "fetch failed" });
    return;
  }

  const currentShellVersion = app.getVersion();

  // --- Shell update check ---
  if (config.shellMinVersion) {
    const behind = compareVersions(currentShellVersion, config.shellMinVersion) < 0;
    if (behind) {
      setShellState({
        status: config.forceShellUpdate ? "forced" : "suggested",
        message: config.forceShellUpdate
          ? `当前版本 ${currentShellVersion} 过旧，必须更新到 ${config.shellMinVersion} 或以上才能继续使用`
          : `发现新版本 ${config.shellMinVersion}，建议更新以获得最佳体验`,
      });
    } else {
      setShellState({ status: "none", message: null });
    }
  } else {
    setShellState({ status: "none", message: null });
  }

  // --- Renderer hot update check ---
  if (!config.rendererVersion || !config.rendererUrl) {
    setRendererState({ status: "up-to-date", message: "当前已是最新版本", progressPercent: null, error: null });
    return;
  }

  const hotVersion = await readHotVersion();

  if (hotVersion === config.rendererVersion) {
    setRendererState({
      status: "up-to-date",
      currentVersion: hotVersion,
      availableVersion: config.rendererVersion,
      message: "当前已是最新版本",
      progressPercent: null,
      error: null,
    });
    return;
  }

  // Need to download
  setRendererState({
    status: "downloading",
    availableVersion: config.rendererVersion,
    progressPercent: 0,
    message: `正在后台下载新版本 ${config.rendererVersion}`,
    error: null,
  });

  try {
    await downloadRendererZip(config.rendererUrl);
    await extractRendererZip(config.rendererVersion);
    setRendererState({
      status: "ready",
      currentVersion: config.rendererVersion,
      availableVersion: config.rendererVersion,
      progressPercent: 100,
      message: `新版本 ${config.rendererVersion} 已就绪，重启后生效`,
      error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setRendererState({
      status: "error",
      progressPercent: null,
      message: "热更下载失败",
      error: msg,
    });
    // Clean up broken download
    await rm(downloadingZipPath, { force: true });
  }
}

export function registerReleaseUpdaterIpc() {
  ipcMain.handle("yiqikan:get-renderer-update-state", () => rendererUpdateState);
  ipcMain.handle("yiqikan:get-shell-update-state", () => shellUpdateState);
  ipcMain.handle("yiqikan:check-release-update", () => runCheck());
  ipcMain.handle("yiqikan:dismiss-shell-update", () => {
    if (shellUpdateState.status === "suggested") {
      setShellState({ status: "none", message: null });
    }
  });
}

export async function initializeReleaseUpdater() {
  if (initialized) return;
  initialized = true;

  // In dev mode, hot update is disabled unless explicitly enabled via env var
  const defaultEnabled = !__DEV__;
  const defaultUrl = "https://yiqikan.cpolar.cn/api/release-config";

  const enabled = readBooleanFlag(process.env.YIQIKAN_RELEASE_UPDATE_ENABLED, defaultEnabled);
  const url = readOptionalUrl(process.env.YIQIKAN_RELEASE_CONFIG_URL) ?? (enabled ? defaultUrl : null);
  const delayMs = readPositiveInteger(process.env.YIQIKAN_RELEASE_UPDATE_DELAY_MS, 6000);
  const intervalMs = readPositiveInteger(process.env.YIQIKAN_RELEASE_UPDATE_INTERVAL_MS, 3600000);

  if (!enabled || !url) {
    setRendererState({ status: "disabled", message: "热更未启用（开发模式）" });
    return;
  }

  releaseConfigUrl = url;
  setRendererState({ status: "idle", message: "热更待命中" });

  // Initial check after short delay
  checkTimer = setTimeout(() => {
    runCheck().catch(() => {});
    // Then check on interval
    checkTimer = setInterval(() => { runCheck().catch(() => {}); }, intervalMs);
  }, delayMs);
}
