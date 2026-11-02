import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

await import("../../../scripts/sync-bundled-site-rules.mjs");
await import("./sync-media-context.mjs");
await import("./sync-site-rules.mjs");

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(__dirname, "..");
const distDir = process.env.YIQIKAN_EXTENSION_OUTPUT_DIR ? resolve(process.env.YIQIKAN_EXTENSION_OUTPUT_DIR) : resolve(extRoot, "dist");
const webDownloadsDir = resolve(extRoot, "../web/public/downloads");

// Single Source of Truth: ensure manifest.json version matches package.json
const pkgPath = resolve(extRoot, "package.json");
const manifestPath = resolve(extRoot, "manifest.json");
if (existsSync(pkgPath) && existsSync(manifestPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (pkg.version && manifest.version !== pkg.version) {
      manifest.version = pkg.version;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`📌 Automatically synced manifest.json version to v${pkg.version}`);
    }
  } catch (err) {
    console.warn("⚠️ Failed to sync version between package.json and manifest.json:", err);
  }
}

console.log("📦 Packaging Yiqikan Browser Extension...");

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

const zipOut = resolve(distDir, "yiqikan-extension.zip");
const staging = mkdtempSync(resolve(distDir, '.package-'));

// Package clean extension files into zip
try {
  const stagedZip = resolve(staging, 'yiqikan-extension.zip');
  execFileSync('zip', ['-r', '-q', '-X', stagedZip, 'manifest.json', 'background.js', 'site-rules-background.js', 'site-rules-content.js', 'media-context.js', 'content-script.js', 'injected-main.js', 'rules.json', 'icons', 'popup', 'README.md', 'THIRD_PARTY_NOTICES.txt', '-x', '*.DS_Store'],
    { cwd: extRoot, stdio: "inherit" }
  );
  const buffer = readFileSync(stagedZip);
  const metadata = JSON.stringify({
    version: JSON.parse(readFileSync(manifestPath, 'utf8')).version,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    sizeKb: (buffer.length / 1024).toFixed(1), updatedAt: new Date().toISOString(),
  }, null, 2) + '\n';
  renameSync(stagedZip, zipOut);
  writeFileSync(resolve(distDir, 'yiqikan-extension.meta.json'), metadata);

  console.log(`✅ Extension packaged successfully:`);
  console.log(`   - ${zipOut}`);

  // Copy to Web Public Downloads for direct 1-click download if running in monorepo
  const webDir = resolve(extRoot, "../web");
  if (existsSync(webDir) && !process.env.YIQIKAN_EXTENSION_OUTPUT_DIR) {
    if (!existsSync(webDownloadsDir)) {
      mkdirSync(webDownloadsDir, { recursive: true });
    }
    const webZipOut = resolve(webDownloadsDir, "yiqikan-extension.zip");
    copyFileSync(zipOut, webZipOut + '.tmp');
    renameSync(webZipOut + '.tmp', webZipOut);
    writeFileSync(resolve(webDownloadsDir, 'yiqikan-extension.meta.json.tmp'), metadata);
    renameSync(resolve(webDownloadsDir, 'yiqikan-extension.meta.json.tmp'), resolve(webDownloadsDir, 'yiqikan-extension.meta.json'));
    console.log(`   - ${webZipOut}`);
  }
} catch (error) {
  console.error("❌ Failed to package extension:", error);
  process.exit(1);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
