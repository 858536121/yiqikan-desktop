const fs = require('node:fs');
const path = require('node:path');

function withQqLoginProbe(config) {
  const probe = process.env.YIQIKAN_QQ_PROBE_NATIVE === '1';
  if (!probe && process.env.YIQIKAN_QQ_LOGIN_NATIVE !== '1') return config;
  if (probe) config = { ...config, updates: { ...config.updates, enabled: false } };
  if (!fs.existsSync(path.join(__dirname, 'modules/qq-login/sdk/TencentOpenAPI.xcframework'))) return config;

  const ios = config.ios || {};
  const plist = ios.infoPlist || {};
  return {
    ...config,
    ios: {
      ...ios,
      scheme: [...new Set([ios.scheme ?? [], 'tencent1112545470', 'QQ425018BE'].flat())],
      associatedDomains: [...new Set([...(ios.associatedDomains || []), 'applinks:yiqikan.club'])],
      infoPlist: {
        ...plist,
        LSApplicationQueriesSchemes: [...new Set([
          ...(plist.LSApplicationQueriesSchemes || []),
          'mqq', 'mqqapi', 'tim', 'mqqopensdknopasteboard', 'mqqopensdknopasteboardios16',
          'mqqopensdkapiV2', 'mqqOpensdkSSoLogin',
        ])],
      },
    },
  };
}

module.exports = ({ config }) => {
  const pipQaVersion = process.env.EAS_BUILD_PROFILE === 'ios-pip-qa' && process.env.YIQIKAN_PIP_QA_VERSION;
  if (pipQaVersion) config = { ...config, version: pipQaVersion };
  // OTA business versions must never silently change the native compatibility identity.
  config = { ...config, runtimeVersion: config.runtimeVersion || config.version,
    updates: { ...config.updates, requestHeaders: { ...config.updates?.requestHeaders,
      'x-yiqikan-native-version': config.version } },
    extra: { ...config.extra, bundleVersion: process.env.YIQIKAN_OTA_VERSION || config.version } };
  // Keep the TestFlight verification build on its embedded bundle.
  if (process.env.EAS_BUILD_PROFILE === 'ios-pip-qa') {
    config = { ...config, updates: { ...config.updates, enabled: false } };
  }
  // Explicit opt-out is reserved for diagnostic WebView iOS builds.
  if (process.env.EXPO_PUBLIC_NATIVE_VOICE_ENABLED === 'false') return withQqLoginProbe(config);
  return withQqLoginProbe({
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        // The linked SDK includes camera APIs even though voice only requests audio.
        NSCameraUsageDescription: config.ios?.infoPlist?.NSCameraUsageDescription
          || '相机供实时音视频组件的视频采集使用；当前连麦只启用语音，不会开启相机。',
      },
    },
    // OTA exports must match the binary: native voice on iOS, WebView on Android.
    extra: { ...config.extra, iosNativeVoice: true },
    plugins: (config.plugins ?? []).map(plugin => plugin === './plugins/withAudioMixing'
      ? [plugin, { nativeRtc: true }] : plugin),
  });
};
