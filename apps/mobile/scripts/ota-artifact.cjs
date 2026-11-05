const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const semver = /^\d+\.\d+\.\d+$/;
function validateVersion(version, runtime) {
  if (!semver.test(version) || !semver.test(runtime) ||
      version.split('.').slice(0, 2).join('.') !== runtime.split('.').slice(0, 2).join('.') ||
      Number(version.split('.')[2]) <= Number(runtime.split('.')[2])) {
    throw new Error(`OTA ${version} 必须是 runtime ${runtime} 同版本线的更高 patch；原生改动请发布新底包。`);
  }
}
function nextVersion(runtime, publicDir) {
  const versions = fs.existsSync(publicDir) ? fs.readdirSync(publicDir) : [];
  const prefix = runtime.split('.').slice(0, 2).join('.') + '.';
  const patch = Math.max(Number(runtime.split('.')[2]), ...versions.filter(v => semver.test(v) && v.startsWith(prefix)).map(v => Number(v.split('.')[2])));
  return prefix + (patch + 1);
}
function prepareArtifact(directory, version, runtimeVersion, nativeFingerprints) {
  validateVersion(version, runtimeVersion);
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8'));
  const asset = (relative, ext, launch = false) => {
    const full = path.resolve(directory, relative);
    if (!full.startsWith(path.resolve(directory) + path.sep)) throw Error('产物路径越界');
    const bytes = fs.readFileSync(full);
    const sha = crypto.createHash('sha256').update(bytes).digest();
    if (launch) fs.writeFileSync(`${full}.gz`, zlib.gzipSync(bytes, { level: 6 }));
    return { path: relative, key: launch ? `bundle-${sha.toString('hex')}` : path.basename(relative),
      hash: sha.toString('base64url'), fileExtension: `.${ext.replace(/^\./, '')}`,
      contentType: launch ? 'application/javascript' : undefined, size: bytes.length };
  };
  const release = { schemaVersion: 1, version, runtimeVersion, nativeFingerprints,
    createdAt: new Date().toISOString(), platforms: {} };
  for (const [platform, info] of Object.entries(metadata.fileMetadata)) {
    release.platforms[platform] = { id: crypto.randomUUID(), launchAsset: asset(info.bundle, 'hbc', true),
      assets: info.assets.map(a => asset(a.path, a.ext)) };
  }
  fs.writeFileSync(path.join(directory, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  return release;
}
module.exports = { validateVersion, nextVersion, prepareArtifact };
