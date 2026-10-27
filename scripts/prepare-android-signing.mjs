import fs from 'node:fs';
import path from 'node:path';

const required = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Configure GitHub Actions secrets: ${missing.join(', ')}`);

const encoded = process.env.ANDROID_KEYSTORE_BASE64.replace(/\s/g, '');
const keystore = Buffer.from(encoded, 'base64');
if (!keystore.length || keystore.toString('base64') !== encoded) throw new Error('ANDROID_KEYSTORE_BASE64 is invalid');

const appDir = path.resolve('android/app');
const gradlePath = path.join(appDir, 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
const start = gradle.indexOf('signingConfigs {');
if (start < 0) throw new Error('Android signingConfigs block not found');
let depth = 0, end = -1, quote = null;
for (let i = gradle.indexOf('{', start); i < gradle.length; i++) {
  const char = gradle[i];
  if (quote) {
    if (char === '\\') i++;
    else if (char === quote) quote = null;
    continue;
  }
  if (char === '/' && gradle[i + 1] === '/') {
    i = gradle.indexOf('\n', i + 2);
    if (i < 0) break;
    continue;
  }
  if (char === '/' && gradle[i + 1] === '*') {
    const close = gradle.indexOf('*/', i + 2);
    if (close < 0) break;
    i = close + 1;
    continue;
  }
  if (char === '"' || char === "'") { quote = char; continue; }
  if (char === '{') depth++;
  if (char === '}' && --depth === 0) { end = i + 1; break; }
}
if (end < 0) throw new Error('Android signingConfigs block is incomplete');
const signing = `signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file('yiqikan-release.keystore')
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
    }`;
gradle = gradle.slice(0, start) + signing + gradle.slice(end);
if (!/^\s*debuggableVariants\s*=/m.test(gradle)) {
  if (!gradle.includes('react {')) throw new Error('Android React Gradle configuration not found');
  gradle = gradle.replace('react {', 'react {\n    debuggableVariants = ["debug", "debugOptimized", "release"]');
}
// Expo's generated release block starts with this signingConfig; keep debug unchanged.
gradle = gradle.replace(/(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig signingConfigs\.(?:debug|release)/, '$1signingConfig signingConfigs.release');
if (!/buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?signingConfig signingConfigs\.release/.test(gradle)) throw new Error('Android release signing configuration not found');

fs.writeFileSync(path.join(appDir, 'yiqikan-release.keystore'), keystore, { mode: 0o600 });
fs.chmodSync(path.join(appDir, 'yiqikan-release.keystore'), 0o600);
fs.writeFileSync(gradlePath, gradle);
console.log('Android release signing configured from GitHub Secrets.');
