const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// 根目录与路径定义
const mobileDir = path.resolve(__dirname, '..');
const webDir = path.resolve(mobileDir, '../web');
const webPublicDir = path.join(webDir, 'public');
const webReleasesDir = path.join(webPublicDir, 'releases');
const pkgJson = require(path.join(mobileDir, 'package.json'));

// 读取版本号（支持命令行传入：node scripts/build-ota.js 1.15.3）
const version = process.argv[2] || pkgJson.version;
const buildDistDir = path.join(mobileDir, 'dist', 'ota-build');
const targetUpdatesDir = path.join(webPublicDir, 'updates', version);
const zipFileName = `mobile-bundle-${version}.zip`;
const zipFilePath = path.join(mobileDir, 'dist', zipFileName);
const targetReleasePath = path.join(webReleasesDir, zipFileName);

console.log(`\n📦 [Expo Updates OTA Build] 开始打包移动端双端热更新包 (版本: ${version})...\n`);

// 1. 清理构建目录
if (fs.existsSync(buildDistDir)) {
  fs.rmSync(buildDistDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDistDir, { recursive: true });

if (!fs.existsSync(webReleasesDir)) {
  fs.mkdirSync(webReleasesDir, { recursive: true });
}

// 2. 执行 Expo 官方 Export 构建 Android & iOS Hermes HBC Bundle 与静态资源
console.log('⚡ [1/4] 编译 Android & iOS JS Bundle 与静态资产...');
const cmd = `npx expo export -p android -p ios --output-dir "${buildDistDir}"`;

try {
  execSync(cmd, { cwd: mobileDir, stdio: 'inherit' });
} catch (err) {
  console.error('\n❌ Bundle 打包失败:', err);
  process.exit(1);
}

// 3. 同步至 Web /public/updates/<version> 目录 (供 expo-updates 官方协议使用)
console.log('\n🚀 [2/4] 同步 Expo Updates 官方分发目录...');
if (fs.existsSync(targetUpdatesDir)) {
  fs.rmSync(targetUpdatesDir, { recursive: true, force: true });
}
fs.mkdirSync(targetUpdatesDir, { recursive: true });

function copyDirRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
copyDirRecursive(buildDistDir, targetUpdatesDir);
console.log(`✅ 已同步官方 Updates 资源至: public/updates/${version}`);

// 4. 兼容性打包 Zip 文件（供现有 Admin 后台与全平台发布同步）
console.log('\n🗜️  [3/4] 压缩打包兼容归档 Zip 文件...');
if (fs.existsSync(zipFilePath)) {
  fs.rmSync(zipFilePath, { force: true });
}

try {
  execSync(`cd "${buildDistDir}" && zip -r "${zipFilePath}" . -x "*.DS_Store"`, { stdio: 'pipe' });
} catch (err) {
  console.error('\n❌ 压缩失败:', err);
  process.exit(1);
}

// 拷贝到 Web Releases 目录
fs.copyFileSync(zipFilePath, targetReleasePath);

// 计算 MD5 和 文件大小
const fileBuffer = fs.readFileSync(targetReleasePath);
const hashSum = crypto.createHash('md5');
hashSum.update(fileBuffer);
const md5 = hashSum.digest('hex');
const fileSizeKb = (fileBuffer.length / 1024).toFixed(1);

// 写入 .meta.json sidecar 文件（供 sync-release-config.ts 自动读取）
const metaFileName = `mobile-bundle-${version}.meta.json`;
const metaFilePath = path.join(webReleasesDir, metaFileName);
const metaData = {
  version,
  bundleUrl: `/releases/${zipFileName}`,
  md5,
  fileSizeBytes: fileBuffer.length,
  buildTime: new Date().toISOString(),
};
fs.writeFileSync(metaFilePath, JSON.stringify(metaData, null, 2), 'utf-8');
console.log(`📋 已生成 Admin 兼容构建元数据: ${metaFileName}`);

// 5. 执行「最多保留 3 个版本」的历史清理策略
console.log('\n🧹 [4/4] 检查并执行历史版本清理...');
function enforceMaxThreeReleases(prefix) {
  try {
    const files = fs.readdirSync(webReleasesDir);
    const targetFiles = files
      .filter((f) => f.startsWith(prefix) && f.endsWith('.zip'))
      .map((f) => {
        const fullPath = path.join(webReleasesDir, f);
        const stat = fs.statSync(fullPath);
        return { name: f, fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (targetFiles.length > 3) {
      const filesToDelete = targetFiles.slice(3);
      filesToDelete.forEach((f) => {
        console.log(`   🗑️  移除超出保留数量的历史版本: ${f.name}`);
        fs.rmSync(f.fullPath, { force: true });
        const metaPath = f.fullPath.replace(/\.zip$/, '.meta.json');
        if (fs.existsSync(metaPath)) {
          fs.rmSync(metaPath, { force: true });
        }
      });
    }
  } catch (e) {
    console.warn('   ⚠️ 清理历史版本出现非致命警告:', e);
  }
}

function enforceMaxThreeUpdates() {
  try {
    const parentUpdatesDir = path.join(webPublicDir, 'updates');
    if (!fs.existsSync(parentUpdatesDir)) return;
    const entries = fs.readdirSync(parentUpdatesDir, { withFileTypes: true });
    const versionDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => {
        const fullPath = path.join(parentUpdatesDir, e.name);
        const stat = fs.statSync(fullPath);
        return { name: e.name, fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (versionDirs.length > 3) {
      const dirsToDelete = versionDirs.slice(3);
      dirsToDelete.forEach((d) => {
        console.log(`   🗑️  移除超出保留数量的旧 updates 目录: ${d.name}`);
        fs.rmSync(d.fullPath, { recursive: true, force: true });
      });
    }
  } catch (e) {
    console.warn('   ⚠️ 清理历史 updates 目录出现非致命警告:', e);
  }
}

enforceMaxThreeReleases('mobile-bundle-');
enforceMaxThreeReleases('renderer-');
enforceMaxThreeUpdates();

// 6. 尝试自动同步 release-config
try {
  const syncScript = path.join(webDir, 'prisma/sync-release-config.ts');
  if (fs.existsSync(syncScript)) {
    console.log('🔄 自动触发 sync-release-config 同步发布配置...');
    execSync('pnpm sync-release-config', { cwd: path.resolve(mobileDir, '../..'), stdio: 'inherit' });
  }
} catch (e) {
  console.warn('⚠️ 自动同步 release-config 跳过:', e.message);
}

// 7. 输出发布结果
console.log('\n======================================================');
console.log('🎉 Expo Updates 双端热更新包构建与分发就绪！');
console.log('======================================================');
console.log(`📌 目标版本号: ${version}`);
console.log(`🌐 官方 Manifest 端点: /api/updates/manifest`);
console.log(`📁 静态资源目录: public/updates/${version}`);
console.log(`📦 兼容归档文件: /releases/${zipFileName} (${fileSizeKb} KB)`);
console.log(`🔑 MD5 校验和: ${md5}`);
console.log('======================================================\n');
