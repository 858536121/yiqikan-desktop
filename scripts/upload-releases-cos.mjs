import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import COS from 'cos-nodejs-sdk-v5';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 加载 .env.cos
function loadEnv() {
  const envFile = path.join(rootDir, '.env.cos');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...vals] = trimmed.split('=');
      if (key && vals.length > 0) {
        process.env[key.trim()] = vals.join('=').trim();
      }
    }
  }
}

loadEnv();

const SecretId = process.env.COS_SECRET_ID;
const SecretKey = process.env.COS_SECRET_KEY;
const Bucket = process.env.COS_BUCKET || 'yiqikan-downloads-1304286896';
const Region = process.env.COS_REGION || 'ap-shanghai';
const CustomDomain = process.env.COS_CUSTOM_DOMAIN || 'download.yiqikan.club';

if (!SecretId || !SecretKey) {
  console.error('❌ 缺少 COS 密钥，请检查根目录 .env.cos 或系统环境变量 COS_SECRET_ID / COS_SECRET_KEY');
  process.exit(1);
}

const cos = new COS({
  SecretId,
  SecretKey,
});

async function uploadFile(filePath, isDryRun = false) {
  const fileName = path.basename(filePath);
  const cosKey = `releases/${fileName}`;
  const fileSizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);

  if (isDryRun) {
    console.log(`🔍 [DRY RUN] 模拟上传: ${fileName} (${fileSizeMB} MB) -> ${cosKey}`);
    console.log(`   目标地址: https://${CustomDomain}/${cosKey}`);
    return;
  }

  console.log(`\n🚀 开始上传: ${fileName} (${fileSizeMB} MB) -> ${cosKey}`);

  let lastPercent = 0;
  return new Promise((resolve, reject) => {
    cos.uploadFile(
      {
        Bucket,
        Region,
        Key: cosKey,
        FilePath: filePath,
        SliceSize: 1024 * 1024 * 5, // 5MB 分片
        onProgress: function (progressData) {
          const percent = Math.floor(progressData.percent * 100);
          if (percent >= lastPercent + 10 || percent === 100) {
            process.stdout.write(`   上传进度: ${percent}% (速度: ${(progressData.speed / 1024 / 1024).toFixed(2)} MB/s)\r`);
            lastPercent = percent;
          }
        },
      },
      function (err, data) {
        if (err) {
          console.error(`\n❌ 上传失败 [${fileName}]:`, err.message || err);
          return reject(err);
        }
        console.log(`\n✅ 上传完成: https://${CustomDomain}/${cosKey}`);
        resolve(data);
      }
    );
  });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const isDryRun = rawArgs.includes('--dry-run');
  const customFiles = rawArgs.filter(a => a !== '--dry-run');
  let filesToUpload = [];

  if (customFiles.length > 0) {
    for (const f of customFiles) {
      const resolved = path.resolve(process.cwd(), f);
      if (fs.existsSync(resolved)) {
        const s = fs.statSync(resolved);
        if (s.isFile()) {
          filesToUpload.push(resolved);
        } else if (s.isDirectory()) {
          const inner = fs.readdirSync(resolved)
            .filter(name => name.endsWith('.dmg') || name.endsWith('.exe') || name.endsWith('.apk'))
            .map(name => path.join(resolved, name));
          filesToUpload.push(...inner);
        }
      } else if (f.includes('*')) {
        const dir = path.dirname(resolved);
        if (fs.existsSync(dir)) {
          const pattern = new RegExp('^' + path.basename(f).replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
          const matched = fs.readdirSync(dir).filter(name => pattern.test(name)).map(name => path.join(dir, name));
          filesToUpload.push(...matched);
        }
      }
    }
  } else {
    // 默认自动扫描 apps/desktop/release 与 apps/mobile/release
    const dirs = [
      path.join(rootDir, 'apps/desktop/release'),
      path.join(rootDir, 'apps/mobile/release')
    ];
    for (const d of dirs) {
      if (fs.existsSync(d)) {
        const files = fs.readdirSync(d)
          .filter(name => name.endsWith('.dmg') || name.endsWith('.exe') || name.endsWith('.apk'))
          .map(name => path.join(d, name));
        filesToUpload.push(...files);
      }
    }
  }

  if (filesToUpload.length === 0) {
    console.log('⚠️ 没有找到待上传的文件。');
    return;
  }

  console.log(`📦 待上传文件共 ${filesToUpload.length} 个${isDryRun ? ' (DRY RUN 演练模式)' : ''}:`);
  filesToUpload.forEach(f => console.log(`   - ${path.basename(f)}`));

  for (const file of filesToUpload) {
    await uploadFile(file, isDryRun);
  }

  if (isDryRun) {
    console.log('\n✅ [DRY RUN] 模拟上传演练全部成功，路径与映射匹配正常！');
  } else {
    console.log('\n🎉 所有文件已成功上传至腾讯云 COS 存储桶！');
    console.log(`🌐 访问域名: https://${CustomDomain}/releases/`);
  }
}

main().catch(err => {
  console.error('执行出错:', err);
  process.exit(1);
});
