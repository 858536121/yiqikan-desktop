const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// 根目录与路径定义
const mobileDir = path.resolve(__dirname, '..');
const webReleasesDir = path.resolve(mobileDir, '../web/public/releases');
const pkgJson = require(path.join(mobileDir, 'package.json'));

// 读取版本号（支持命令行传入：node scripts/build-ota.js 1.11.2）
const version = process.argv[2] || pkgJson.version;
const buildDistDir = path.join(mobileDir, 'dist', 'ota-build');
const zipFileName = `mobile-bundle-${version}.zip`;
const zipFilePath = path.join(mobileDir, 'dist', zipFileName);
const targetReleasePath = path.join(webReleasesDir, zipFileName);

console.log(`\n📦 [OTA Build] 开始打包移动端 UI 热更新包 (版本: ${version})...\n`);

// 1. 清理并确保目录准备就绪
if (fs.existsSync(buildDistDir)) {
  fs.rmSync(buildDistDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDistDir, { recursive: true });

if (!fs.existsSync(webReleasesDir)) {
  fs.mkdirSync(webReleasesDir, { recursive: true });
}

// 2. 执行 Expo 官方 Export 构建 Hermes JS Bundle 与静态资源
console.log('⚡ [1/4] 编译 React Native / Hermes JS Bundle 与静态资产...');
const cmd = `npx expo export -p android --output-dir "${buildDistDir}"`;

try {
  execSync(cmd, { cwd: mobileDir, stdio: 'inherit' });
} catch (err) {
  console.error('\n❌ Bundle 打包失败:', err);
  process.exit(1);
}

// 3. 规范化 Bundle 文件（确保根目录有标准的 index.android.bundle）
try {
  const metadataPath = path.join(buildDistDir, 'metadata.json');
  if (fs.existsSync(metadataPath)) {
    const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    const bundleRelPath = meta?.fileMetadata?.android?.bundle;
    if (bundleRelPath && fs.existsSync(path.join(buildDistDir, bundleRelPath))) {
      fs.copyFileSync(path.join(buildDistDir, bundleRelPath), path.join(buildDistDir, 'index.android.bundle'));
      console.log('✅ 已同步标准 Bundle 入口: index.android.bundle');
    }
  }
} catch (e) {
  console.warn('⚠️ 同步标准 Bundle 文件警告:', e.message);
}

// 4. 写入版本元数据文件
const versionMeta = {
  version,
  platform: 'android',
  buildTime: new Date().toISOString(),
  targetPackage: pkgJson.name,
};
fs.writeFileSync(path.join(buildDistDir, 'version.json'), JSON.stringify(versionMeta, null, 2), 'utf-8');

// 4. 压缩打包为 Zip 文件
console.log('\n🗜️  [2/4] 压缩打包为 Zip 文件...');
if (fs.existsSync(zipFilePath)) {
  fs.rmSync(zipFilePath, { force: true });
}

try {
  execSync(`cd "${buildDistDir}" && zip -r "${zipFilePath}" . -x "*.DS_Store"`, { stdio: 'pipe' });
} catch (err) {
  console.error('\n❌ 压缩失败:', err);
  process.exit(1);
}

// 5. 拷贝到 Web Releases 目录
console.log('🚀 [3/4] 同步分发至 Web Releases 目录...');
fs.copyFileSync(zipFilePath, targetReleasePath);

// 计算 MD5 和 文件大小
const fileBuffer = fs.readFileSync(targetReleasePath);
const hashSum = crypto.createHash('md5');
hashSum.update(fileBuffer);
const md5 = hashSum.digest('hex');
const fileSizeKb = (fileBuffer.length / 1024).toFixed(1);

// 6. 写入 .meta.json sidecar 文件（供 sync-release-config.ts 自动读取）
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
console.log(`📋 [3.5/4] 已生成构建元数据: ${metaFileName}`);

// 7. 执行「最多保留 3 个版本」的自动清理策略
console.log('🧹 [4/4] 检查并执行历史版本清理（仅保留最新 3 个版本）...');
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
      .sort((a, b) => b.mtime - a.mtime); // 按修改时间从新到旧排序

    if (targetFiles.length > 3) {
      const filesToDelete = targetFiles.slice(3);
      filesToDelete.forEach((f) => {
        console.log(`   🗑️  移除超出保留数量的历史版本: ${f.name}`);
        fs.rmSync(f.fullPath, { force: true });
        // 同时移除对应的 .meta.json
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

// 分别清理移动端 bundle 和 桌面端 renderer 历史包
enforceMaxThreeReleases('mobile-bundle-');
enforceMaxThreeReleases('renderer-');

// 8. 输出发布结果
console.log('\n======================================================');
console.log('🎉 移动端 UI 热更新包构建与归档成功！');
console.log('======================================================');
console.log(`📌 版本号 (bundleVersion): ${version}`);
console.log(`🌐 相对下载地址 (bundleUrl): /releases/${zipFileName}`);
console.log(`📦 文件大小: ${fileSizeKb} KB`);
console.log(`🔑 MD5 校验和: ${md5}`);
console.log('======================================================');
console.log('💡 部署后 sync-release-config 会自动同步配置，也可在后台手动调整。');
console.log(`   或运行: pnpm sync-release-config\n`);
