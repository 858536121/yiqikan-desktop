module.exports = ({ config }) => {
  // Resolve appVersion here so EAS accepts both generated and bare projects.
  // OTA patch exports still follow the configured application version.
  config = { ...config, runtimeVersion: config.version };
  // EAS embeds only the store-update policy in iOS build metadata.
  // The iOS config plugin also enforces this for local prebuilds.
  if (process.env.EAS_BUILD_PLATFORM === 'ios') {
    config = { ...config, updates: { enabled: false, checkAutomatically: 'NEVER' } };
  }
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
    // Android retains the existing patch OTA channel; iOS uses App Store updates.
    extra: { ...config.extra, iosNativeVoice: true },
    plugins: (config.plugins ?? []).map(plugin => plugin === './plugins/withAudioMixing'
      ? [plugin, { nativeRtc: true }] : plugin),
  };
};
