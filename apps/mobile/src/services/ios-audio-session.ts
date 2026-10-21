import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export interface AudioSessionState {
  reason: string;
  category: string;
  mode: string;
  options: number;
  outputs: string[];
  interrupted: boolean;
  nativeVoice?: boolean;
  nativeAudioRunning?: boolean;
  audioEnabled?: boolean;
  sessionActive?: boolean;
  inputAvailable?: boolean;
  inputChannels?: number;
  sampleRate?: number;
  audioUnitStartError?: { domain: string; code: number };
}

interface AudioSessionModule {
  activate: () => Promise<AudioSessionState>;
  recover: () => Promise<AudioSessionState>;
  retryActivation?: () => Promise<AudioSessionState>;
  getState?: () => Promise<AudioSessionState>;
  restartAudio?: () => Promise<AudioSessionState>;
  deactivate: () => Promise<void>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
}

const nativeSession: AudioSessionModule | undefined = Platform.OS === 'ios'
  ? NativeModules.YiQiKanAudioSession
  : undefined;

export const iosAudioSession = {
  async activate() {
    if (Platform.OS === 'ios' && !nativeSession) {
      console.warn('[VoiceAudio] 当前 iOS 包缺少音频模块，需要重新构建原生 App');
    }
    return nativeSession?.activate();
  },
  recover: (retryInterrupted = false) => retryInterrupted && nativeSession?.retryActivation
    ? nativeSession.retryActivation()
    : nativeSession?.recover(),
  deactivate: () => nativeSession?.deactivate(),
  snapshot: () => nativeSession?.getState?.(),
  restartAudio: () => nativeSession?.restartAudio?.(),
  subscribe(listener: (state: AudioSessionState) => void) {
    const subscription = nativeSession
      ? new NativeEventEmitter(nativeSession).addListener('YiQiKanAudioSessionChanged', listener)
      : undefined;
    return () => subscription?.remove();
  },
};
