module.exports = {
  dependencies: {
    'react-native-webrtc': {
      platforms: {
        android: null,
        ios: process.env.EXPO_PUBLIC_NATIVE_VOICE_ENABLED === 'false' ? null : {},
      },
    },
  },
};
