import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(__dirname, "..");
const distDir = resolve(extRoot, "dist");
const webDownloadsDir = resolve(extRoot, "../web/public/downloads");

console.log("📦 Packaging Yiqikan Browser Extension...");

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

const zipOut = resolve(distDir, "yiqikan-extension.zip");

// Package clean extension files into zip
try {
  execSync(
    `zip -r -q -X "${zipOut}" manifest.json background.js content-script.js injected-main.js rules.json icons popup README.md -x "*.DS_Store"`,
    { cwd: extRoot, stdio: "inherit" }
  );

  console.log(`✅ Extension packaged successfully:`);
  console.log(`   - ${zipOut}`);

  // Copy to Web Public Downloads for direct 1-click download if running in monorepo
  const webDir = resolve(extRoot, "../web");
  if (existsSync(webDir)) {
    if (!existsSync(webDownloadsDir)) {
      mkdirSync(webDownloadsDir, { recursive: true });
    }
    const webZipOut = resolve(webDownloadsDir, "yiqikan-extension.zip");
    copyFileSync(zipOut, webZipOut);
    console.log(`   - ${webZipOut}`);
  }
} catch (error) {
  console.error("❌ Failed to package extension:", error);
  process.exit(1);
}
