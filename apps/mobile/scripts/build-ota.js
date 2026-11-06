const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { createProjectHashAsync, SourceSkips } = require('expo/fingerprint');
const { nextVersion, validateVersion, prepareArtifact } = require('./ota-artifact.cjs');
const mobileDir = path.resolve(__dirname, '..');
const publicDir = path.resolve(mobileDir, '../web/public');
const config = require(path.join(mobileDir, 'app.json')).expo;
const runtime = config.runtimeVersion;
const version = process.argv[2] || nextVersion(runtime, path.join(publicDir, 'updates'));
validateVersion(version, runtime);
const target = path.join(publicDir, 'updates', version);
const releases = path.join(publicDir, 'releases');
const zip = path.join(releases, `mobile-bundle-${version}.zip`);
if (fs.existsSync(target) || fs.existsSync(zip)) throw Error(`产物 ${version} 已存在，不允许覆盖；请递增 patch。`);
fs.mkdirSync(path.join(mobileDir, 'dist'), { recursive: true });
async function build() {
  process.env.EXPO_PUBLIC_NATIVE_VOICE_ENABLED = 'true';
  const nativeFingerprints = Object.fromEntries(await Promise.all(['android', 'ios'].map(async platform => [platform,
    await createProjectHashAsync(mobileDir, { platforms: [platform], hashAlgorithm: 'sha256',
      sourceSkips: SourceSkips.ExpoConfigExtraSection | SourceSkips.PackageJsonScriptsAll,
      ignorePaths: ['**/dist/**', '**/android/app/src/main/assets/index.android.bundle', '**/android/app/src/main/assets/app.manifest'],
    })])));
  const work = fs.mkdtempSync(path.join(mobileDir, 'dist', 'ota-'));
  try {
    execFileSync('pnpm', ['exec', 'expo', 'export', '-p', 'android', '-p', 'ios', '--output-dir', work], {
      cwd: mobileDir, stdio: 'inherit', env: { ...process.env,
        YIQIKAN_OTA_VERSION: version, EXPO_PUBLIC_NATIVE_VOICE_ENABLED: 'true',
        EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL || 'https://yiqikan.club',
        EXPO_PUBLIC_SERVER_URL: process.env.EXPO_PUBLIC_SERVER_URL || 'https://yiqikan.club',
      },
    });
    prepareArtifact(work, version, runtime, nativeFingerprints);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.mkdirSync(releases, { recursive: true });
    execFileSync('zip', ['-q', '-r', zip, '.', '-x', '*.DS_Store'], { cwd: work, stdio: 'inherit' });
    const bytes = fs.readFileSync(zip);
    fs.writeFileSync(zip.replace(/\.zip$/, '.meta.json'), JSON.stringify({ version, runtimeVersion: runtime,
      bundleUrl: `/releases/mobile-bundle-${version}.zip`, md5: crypto.createHash('md5').update(bytes).digest('hex'),
      fileSizeBytes: bytes.length, buildTime: new Date().toISOString(),
    }, null, 2) + '\n');
    fs.renameSync(work, target);
    console.log(`OTA ${version} (runtime ${runtime}) 已构建，尚未上线。原生版本保持 ${config.version}。`);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
build().catch(error => { console.error(error.message); process.exitCode = 1; });
