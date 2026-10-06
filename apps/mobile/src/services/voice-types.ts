export type VoiceRecoveryPolicy = 'current' | 'abnormal-only';

export interface VoiceDiagnostics {
  engine?: 'native-webrtc';
  nativeAudioRunning?: boolean;
  inboundSamples?: number;
  microphoneEnabled?: boolean;
  audioUnitStartError?: { domain: string; code: number };
  connectionEpoch: number;
  statsSupported: boolean;
  inboundBytes: number | null;
  outboundBytes: number | null;
  inboundPackets: number | null;
  inboundAudioEnergy: number | null;
  audioState: string;
  audioCurrentTime: number | null;
  systemInterrupted: boolean;
  remoteStreams: number;
  maxRemoteVolume: number;
}

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface VoiceStats {
  localVolume: number;
  isLocalSpeaking: boolean;
  maxRemoteVolume: number;
  isRemoteSpeaking: boolean;
  remoteSpeakingByUserId: Record<string, boolean>;
}

export const emptyVoiceStats = (): VoiceStats => ({
  localVolume: 0,
  isLocalSpeaking: false,
  maxRemoteVolume: 0,
  isRemoteSpeaking: false,
  remoteSpeakingByUserId: {},
});

export interface VoiceContextValue {
  engine: 'webview-webrtc' | 'native-webrtc';
  voiceStatus: VoiceStatus;
  errorMessage: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  callVolume: number;
  stats: VoiceStats;
  joinVoice: (roomId: string, userId: string, userName: string) => void;
  leaveVoice: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setCallVolume: (vol: number) => void;
  notifyVideoPlayback: (paused: boolean) => void;
  voiceDiagnostics: VoiceDiagnostics | null;
  setVoiceDiagnosticsEnabled: (enabled: boolean) => void;
  setRecoveryPolicy: (policy: VoiceRecoveryPolicy) => void;
  getVoiceDiagnosticLog: () => Array<{ at: number; type: string; payload: unknown }>;
}

