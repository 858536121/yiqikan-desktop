import React, { useRef, useState, useCallback, useEffect, createContext, useContext } from 'react';
import { StyleSheet, View, Alert, AppState } from 'react-native';
import { WebView } from 'react-native-webview';
import { VOICE_BRIDGE_HTML } from './voice-bridge-html';

const SafeWebView = WebView as React.ComponentType<any>;

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface VoiceStats {
  localVolume: number;
  isLocalSpeaking: boolean;
  maxRemoteVolume: number;
  isRemoteSpeaking: boolean;
}

export interface VoiceContextValue {
  voiceStatus: VoiceStatus;
  errorMessage: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  callVolume: number;
  noiseCancellation: boolean;
  stats: VoiceStats;
  joinVoice: (roomId: string, userId: string, userName: string) => void;
  leaveVoice: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setCallVolume: (vol: number) => void;
  toggleNoiseCancellation: () => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export const VoiceProvider: React.FC<{ children: React.ReactNode; onShowToast?: (msg: string) => void }> = ({
  children,
  onShowToast,
}) => {
  const webviewRef = useRef<WebView>(null);
  const [isBridgeReady, setIsBridgeReady] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [callVolume, setCallVolumeState] = useState(100);
  const [noiseCancellation, setNoiseCancellation] = useState(true);
  const [stats, setStats] = useState<VoiceStats>({
    localVolume: 0,
    isLocalSpeaking: false,
    maxRemoteVolume: 0,
    isRemoteSpeaking: false,
  });

  const pendingJoinRef = useRef<{ roomId: string; userId: string; userName: string } | null>(null);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      switch (data.type) {
        case 'VOICE_LOG':
          console.log(`[Voice:${data.payload.tag}] ${data.payload.message}`);
          break;
        case 'VOICE_BRIDGE_READY':
          setIsBridgeReady(true);
          if (pendingJoinRef.current) {
            const { roomId, userId, userName } = pendingJoinRef.current;
            pendingJoinRef.current = null;
            webviewRef.current?.injectJavaScript(
              `window.__voiceClient && window.__voiceClient.join("${roomId}", "${userId}", "${userName}"); true;`
            );
          }
          break;
        case 'VOICE_STATUS':
          setVoiceStatus(data.payload.status);
          if (data.payload.status === 'connected') {
            onShowToast?.('已连接实时语音频道');
          }
          break;
        case 'VOICE_STATS':
          setStats(data.payload);
          break;
        case 'VOICE_MUTE_CHANGED':
          setIsMuted(data.payload.isMuted);
          break;
        case 'VOICE_DEAFEN_CHANGED':
          setIsDeafened(data.payload.isDeafened);
          break;
        case 'VOICE_VOLUME_CHANGED':
          setCallVolumeState(Math.round(data.payload.volume * 100));
          break;
        case 'VOICE_NOISE_CHANGED':
          setNoiseCancellation(data.payload.noiseCancellation);
          break;
        case 'VOICE_ERROR':
          console.error('[MobileVoiceBridge:Error]', data.payload);
          setErrorMessage(data.payload.message || '语音连接失败');
          setVoiceStatus('error');
          if (onShowToast) {
            onShowToast(data.payload.message || '语音连接异常，请重试');
          } else {
            Alert.alert('语音提示', data.payload.message || '连接语音服务器失败');
          }
          break;
      }
    } catch (e) {
      console.warn('Voice message parse error', e);
    }
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        webviewRef.current?.injectJavaScript('window.__voiceClient && window.__voiceClient.resumeAudio(); true;');
      }
    });
    return () => sub.remove();
  }, []);

  const joinVoice = useCallback((roomId: string, userId: string, userName: string) => {
    setVoiceStatus('connecting');
    setErrorMessage(null);
    if (!isBridgeReady) {
      pendingJoinRef.current = { roomId, userId, userName };
    } else {
      webviewRef.current?.injectJavaScript(
        `window.__voiceClient && window.__voiceClient.join("${roomId}", "${userId}", "${userName}"); true;`
      );
    }
  }, [isBridgeReady]);

  const leaveVoice = useCallback(() => {
    pendingJoinRef.current = null;
    webviewRef.current?.injectJavaScript('window.__voiceClient && window.__voiceClient.leave(); true;');
    setVoiceStatus('idle');
    setStats({
      localVolume: 0,
      isLocalSpeaking: false,
      maxRemoteVolume: 0,
      isRemoteSpeaking: false,
    });
  }, []);

  useEffect(() => {
    return () => {
      leaveVoice();
    };
  }, [leaveVoice]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    webviewRef.current?.injectJavaScript(`window.__voiceClient && window.__voiceClient.setMuted(${next}); true;`);
  }, [isMuted]);

  const toggleDeafen = useCallback(() => {
    const next = !isDeafened;
    setIsDeafened(next);
    webviewRef.current?.injectJavaScript(`window.__voiceClient && window.__voiceClient.setDeafened(${next}); true;`);
  }, [isDeafened]);

  const setCallVolume = useCallback((vol: number) => {
    const norm = Math.max(0, Math.min(100, vol));
    setCallVolumeState(norm);
    webviewRef.current?.injectJavaScript(`window.__voiceClient && window.__voiceClient.setVolume(${norm / 100}); true;`);
  }, []);

  const toggleNoiseCancellation = useCallback(() => {
    const next = !noiseCancellation;
    setNoiseCancellation(next);
    webviewRef.current?.injectJavaScript(`window.__voiceClient && window.__voiceClient.toggleNoiseCancellation(${next}); true;`);
    onShowToast?.(next ? '已开启语音降噪与回声消除' : '已关闭语音降噪');
  }, [noiseCancellation, onShowToast]);

  return (
    <VoiceContext.Provider
      value={{
        voiceStatus,
        errorMessage,
        isMuted,
        isDeafened,
        callVolume,
        noiseCancellation,
        stats,
        joinVoice,
        leaveVoice,
        toggleMute,
        toggleDeafen,
        setCallVolume,
        toggleNoiseCancellation,
      }}
    >
      {children}
      {/* WebRTC 媒体引擎容器 */}
      <View style={styles.hiddenBridge} pointerEvents="none">
        <SafeWebView
          ref={webviewRef}
          originWhitelist={['*']}
          source={{ 
            html: VOICE_BRIDGE_HTML,
            baseUrl: 'https://localhost'
          }}
          onMessage={handleMessage}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          style={styles.bridgeWebView}
        />
      </View>
    </VoiceContext.Provider>
  );
};

export const useVoice = () => {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice must be used within a VoiceProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  hiddenBridge: {
    width: 1,
    height: 1,
    position: 'absolute',
    bottom: -100,
    left: -100,
    opacity: 0.01,
    overflow: 'hidden',
  },
  bridgeWebView: {
    width: 1,
    height: 1,
    backgroundColor: '#000000',
  },
});
