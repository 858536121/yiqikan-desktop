module.exports = ({ config }) => {
  // OTA business versions must never silently change the native compatibility identity.
  config = { ...config, runtimeVersion: config.runtimeVersion || config.version,
    updates: { ...config.updates, requestHeaders: { ...config.updates?.requestHeaders,
      'x-yiqikan-native-version': config.version } },
    extra: { ...config.extra, bundleVersion: process.env.YIQIKAN_OTA_VERSION || config.version } };
  // Explicit opt-out is reserved for diagnostic WebView iOS builds.
  if (process.env.EXPO_PUBLIC_NATIVE_VOICE_ENABLED === 'false') return config;
  return {
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
  };
};
