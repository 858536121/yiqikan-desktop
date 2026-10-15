import { Platform } from 'react-native';

// Production iOS binaries and OTA use native voice; diagnostics can opt out.
export const NATIVE_IOS_VOICE_ENABLED = Platform.OS === 'ios' && process.env.EXPO_PUBLIC_NATIVE_VOICE_ENABLED !== 'false';
