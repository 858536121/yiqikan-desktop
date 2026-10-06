import React, { useRef, useState, useCallback, useEffect, createContext, useContext } from 'react';
import { StyleSheet, View, AppState, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { VOICE_BRIDGE_HTML } from './voice-bridge-html';
import { useRoomStore } from '../store/useRoomStore';
import { showAlert } from '../store/useDialogStore';
import { iosAudioSession } from './ios-audio-session';
import { emptyVoiceStats } from './voice-types';
import type { VoiceStatus, VoiceStats, VoiceContextValue, VoiceDiagnostics, VoiceRecoveryPolicy } from './voice-types';
import { NATIVE_IOS_VOICE_ENABLED } from './native-voice-build';
import { createNativeVoiceProvider } from './native-voice-service';

const SafeWebView = WebView as React.ComponentType<any>;

export type { VoiceStatus, VoiceStats, VoiceContextValue } from './voice-types';

const VoiceContext = createContext<VoiceContextValue | null>(null);

const WebVoiceProvider: React.FC<{ children: React.ReactNode; onShowToast?: (msg: string) => void }> = ({
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
  const controlsRef = useRef({ muted: false, deafened: false, volume: 1 });
  const [stats, setStats] = useState<VoiceStats>(emptyVoiceStats);

  const pendingJoinRef = useRef<{ roomId: string; userId: string; userName: string } | null>(null);
  const connectingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callRequestedRef = useRef(false);
  const callGenerationRef = useRef(0);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshOutputRef = useRef(false);
  const retryInterruptedRef = useRef(false);
  const statusRef = useRef<VoiceStatus>('idle');
  const interruptedRef = useRef(false);
  const statsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<VoiceDiagnostics | null>(null);
  const diagnosticsEnabledRef = useRef(false);
  const diagnosticLogRef = useRef<Array<{ at: number; type: string; payload: unknown }>>([]);
  const recoveryPolicyRef = useRef<VoiceRecoveryPolicy>('current');
  const recordDiagnostic = useCallback((type: string, payload: unknown) => {
    if (!diagnosticsEnabledRef.current) return;
    diagnosticLogRef.current.push({ at: Date.now(), type, payload });
    if (diagnosticLogRef.current.length > 600) diagnosticLogRef.current.shift();
  }, []);
  const clearStats = useCallback(() => {
    if (statsTimerRef.current) clearTimeout(statsTimerRef.current);
    statsTimerRef.current = null;
    setStats(emptyVoiceStats());
  }, []);

  const requestAudioRecovery = useCallback((reason: string, refreshOutput = false, retryInterrupted = false) => {
    if (!callRequestedRef.current) return;
    refreshOutputRef.current ||= refreshOutput && (recoveryPolicyRef.current === 'current' || reason === 'output-clock-stalled');
    retryInterruptedRef.current ||= retryInterrupted;
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    const generation = callGenerationRef.current;
    // Let WebKit finish its playback/route transition before restoring output.
    recoveryTimerRef.current = setTimeout(async () => {
      recoveryTimerRef.current = null;
      const shouldRefresh = refreshOutputRef.current;
      const shouldRetryInterruption = retryInterruptedRef.current;
      refreshOutputRef.current = false;
      retryInterruptedRef.current = false;
      recordDiagnostic('RECOVERY_ATTEMPT', { reason, refreshOutput: shouldRefresh, retryInterrupted: shouldRetryInterruption });
      try {
        const state = await iosAudioSession.recover(shouldRetryInterruption);
        if (state?.interrupted) return;
        if (state) console.log('[VoiceAudio:Session]', state);
        if (!callRequestedRef.current || generation !== callGenerationRef.current) return;
        interruptedRef.current = false;
        if (state || shouldRetryInterruption) {
          webviewRef.current?.injectJavaScript(
            'window.__voiceClient && window.__voiceClient.setSystemInterrupted(false); true;'
          );
        }
      } catch (error) {
        console.warn('[VoiceAudio] 原生音频会话恢复失败', error);
        if (shouldRetryInterruption) return;
      }
      if (!callRequestedRef.current || generation !== callGenerationRef.current) return;
      webviewRef.current?.injectJavaScript(
        `window.__voiceClient && window.__voiceClient.resumeAudio(${JSON.stringify(reason)}, ${shouldRefresh}); true;`
      );
    }, 250);
  }, [recordDiagnostic]);

  const startVoiceBridge = useCallback(async (roomId: string, userId: string, userName: string) => {
    const generation = callGenerationRef.current;
    recordDiagnostic('CONNECTION_STEP', { message: '正在初始化 iOS 音频会话' });
    let interrupted = false;
    try {
      const state = await iosAudioSession.activate();
      if (callRequestedRef.current && generation === callGenerationRef.current) {
        recordDiagnostic('NATIVE_ACTIVATION_RESULT', { available: !!state, state });
      }
      if (state) console.log('[VoiceAudio:Session]', state);
      interrupted = !!state?.interrupted;
    } catch (error) {
      if (callRequestedRef.current && generation === callGenerationRef.current) recordDiagnostic('NATIVE_ACTIVATION_RESULT', { failed: true });
      console.warn('[VoiceAudio] 原生音频会话初始化失败', error);
    }
    if (!callRequestedRef.current || generation !== callGenerationRef.current) return;
    recordDiagnostic('CONNECTION_STEP', { message: '正在启动语音 WebView' });
    interruptedRef.current = interrupted;
    webviewRef.current?.injectJavaScript(
      `if (window.__voiceClient) { window.__voiceClient.setSystemInterrupted(${interrupted}); window.__voiceClient.setDiagnosticsEnabled(${diagnosticsEnabledRef.current}); window.__voiceClient.setMuted(${controlsRef.current.muted}); window.__voiceClient.setDeafened(${controlsRef.current.deafened}); window.__voiceClient.setVolume(${controlsRef.current.volume}); window.__voiceClient.join(${[roomId, userId, userName, generation].map(value => JSON.stringify(value)).join(',')}); } true;`
    );
  }, [recordDiagnostic]);

  const releaseAudioSession = useCallback(() => {
    callRequestedRef.current = false;
    callGenerationRef.current++;
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
    refreshOutputRef.current = false;
    retryInterruptedRef.current = false;
    void iosAudioSession.deactivate()?.catch(error => console.warn('[VoiceAudio] 释放音频会话失败', error));
  }, []);

  // All terminal paths invalidate the session before any asynchronous cleanup.
  const stopVoice = useCallback(() => {
    releaseAudioSession();
    if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
    connectingTimerRef.current = null;
    pendingJoinRef.current = null;
    interruptedRef.current = false;
    clearStats();
    setVoiceDiagnostics(null);
    webviewRef.current?.injectJavaScript('window.__voiceClient && window.__voiceClient.leave(); true;');
  }, [releaseAudioSession, clearStats]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type !== 'VOICE_LOG' && data.type !== 'VOICE_BRIDGE_READY' &&
          (!callRequestedRef.current || data.sessionId !== callGenerationRef.current)) return;
      if (['VOICE_STATUS', 'VOICE_ICE_STATE', 'VOICE_ERROR', 'VOICE_AUDIO_RECOVERY_REQUEST', 'VOICE_DIAGNOSTICS'].includes(data.type)) {
        recordDiagnostic(data.type, data.payload);
      }
      switch (data.type) {
        case 'VOICE_LOG':
          if (callRequestedRef.current && data.sessionId === callGenerationRef.current &&
              ['Join', 'TURN', 'RPC', 'Mic', 'SFU', 'ICE', 'PeerConn', 'ERROR', 'WARN'].includes(data.payload.tag)) {
            // Preserve the connection stage without exporting raw RPC payloads.
            recordDiagnostic('CONNECTION_STEP', { tag: data.payload.tag, message: data.payload.message });
          }
          if (data.payload.tag === 'AudioRecovery' || data.payload.tag === 'Resume') recordDiagnostic(data.type, data.payload);
          console.log(`[Voice:${data.payload.tag}] ${data.payload.message}`, data.payload.extra ?? '');
          break;
        case 'VOICE_AUDIO_RECOVERY_REQUEST':
          requestAudioRecovery(data.payload.reason, !!data.payload.refreshOutput);
          break;
        case 'VOICE_BRIDGE_READY':
          setIsBridgeReady(true);
          if (pendingJoinRef.current) {
            const { roomId, userId, userName } = pendingJoinRef.current;
            pendingJoinRef.current = null;
            void startVoiceBridge(roomId, userId, userName);
          }
          break;
        case 'VOICE_STATUS':
          if (data.payload.status === 'idle' || data.payload.status === 'error') stopVoice();
          statusRef.current = data.payload.status;
          if (data.payload.status !== 'connected') clearStats();
          if (data.payload.status === 'connected' || data.payload.status === 'error' || data.payload.status === 'idle') {
            if (connectingTimerRef.current) {
              clearTimeout(connectingTimerRef.current);
              connectingTimerRef.current = null;
            }
          }
          setVoiceStatus(prev => {
            if (prev === 'reconnecting' && data.payload.status === 'connected') {
              onShowToast?.('语音通话已恢复');
            } else if (data.payload.status === 'connected') {
              onShowToast?.('已连接实时语音频道');
            } else if (data.payload.status === 'reconnecting') {
              onShowToast?.('语音网络波动，正在重连...');
            }
            return data.payload.status;
          });
          break;
        case 'VOICE_ICE_STATE':
          if (data.payload.state === 'disconnected' || data.payload.state === 'failed') {
            statusRef.current = 'reconnecting';
            clearStats();
            setVoiceStatus(prev => {
              if (prev === 'connected') {
                onShowToast?.('语音网络波动，正在重连...');
              }
              return 'reconnecting';
            });
          } else if (data.payload.state === 'connected') {
            statusRef.current = 'connected';
            if (connectingTimerRef.current) {
              clearTimeout(connectingTimerRef.current);
              connectingTimerRef.current = null;
            }
            setVoiceStatus(prev => {
              if (prev === 'reconnecting') {
                onShowToast?.('语音通话已恢复');
              }
              return 'connected';
            });
          }
          break;
        case 'VOICE_DIAGNOSTICS':
          if (diagnosticsEnabledRef.current) setVoiceDiagnostics(data.payload);
          break;
        case 'VOICE_STATS':
          if (statusRef.current !== 'connected' || interruptedRef.current) return;
          setStats({ ...data.payload, remoteSpeakingByUserId: data.payload.remoteSpeakingByUserId ?? {} });
          if (statsTimerRef.current) clearTimeout(statsTimerRef.current);
          statsTimerRef.current = setTimeout(clearStats, 750);
          break;
        case 'VOICE_MUTE_CHANGED':
          controlsRef.current.muted = data.payload.isMuted;
          setIsMuted(data.payload.isMuted);
          break;
        case 'VOICE_DEAFEN_CHANGED':
          controlsRef.current.deafened = data.payload.isDeafened;
          setIsDeafened(data.payload.isDeafened);
          break;
        case 'VOICE_VOLUME_CHANGED':
          controlsRef.current.volume = data.payload.volume;
          setCallVolumeState(Math.round(data.payload.volume * 100));
          break;
        case 'VOICE_ERROR':
          stopVoice();
          statusRef.current = 'error';
          console.error('[MobileVoiceBridge:Error]', data.payload);
          setErrorMessage(data.payload.message || '语音连接失败');
          setVoiceStatus('error');
          if (onShowToast) {
            onShowToast(data.payload.message || '语音连接异常，请重试');
          } else {
            showAlert({
              title: '语音提示',
              message: data.payload.message || '连接语音服务器失败',
              type: 'warning',
              icon: 'alert',
            });
          }
          break;
      }
    } catch (e) {
      console.warn('Voice message parse error', e);
    }
  };

  useEffect(() => {
    const unsubscribe = iosAudioSession.subscribe(state => {
      if (!callRequestedRef.current) return;
      console.log('[VoiceAudio:Route]', state);
      recordDiagnostic('NATIVE_SESSION', state);
      interruptedRef.current = state.interrupted;
      if (state.interrupted) clearStats();
      webviewRef.current?.injectJavaScript(
        `window.__voiceClient && window.__voiceClient.setSystemInterrupted(${state.interrupted}); true;`
      );
      if (state.interrupted) {
        if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
        // iOS can deliver an interruption-began notification only after a
        // suspended app resumes. Let activation decide if it is still active.
        if (AppState.currentState === 'active') {
          requestAudioRecovery('foreground-interruption', true, true);
        }
      } else {
        requestAudioRecovery(state.reason, true);
      }
    });
    return unsubscribe;
  }, [requestAudioRecovery, clearStats, recordDiagnostic]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        requestAudioRecovery('foreground', Platform.OS === 'ios', true);
      }
    });
    return () => sub.remove();
  }, [requestAudioRecovery]);

  const joinVoice = useCallback((roomId: string, userId: string, userName: string) => {
    if (callRequestedRef.current) stopVoice();
    callRequestedRef.current = true;
    const generation = ++callGenerationRef.current;
    statusRef.current = 'connecting';
    clearStats();
    setVoiceStatus('connecting');
    setErrorMessage(null);

    if (connectingTimerRef.current) {
      clearTimeout(connectingTimerRef.current);
    }
    connectingTimerRef.current = setTimeout(() => {
      if (!callRequestedRef.current || generation !== callGenerationRef.current || statusRef.current !== 'connecting') return;
      stopVoice();
      statusRef.current = 'error';
      setVoiceStatus('error');
      setErrorMessage('语音连接超时，请重试');
      onShowToast?.('语音连接超时，请重试');
    }, 15000);

    if (!isBridgeReady) {
      pendingJoinRef.current = { roomId, userId, userName };
    } else {
      void startVoiceBridge(roomId, userId, userName);
    }
  }, [isBridgeReady, onShowToast, startVoiceBridge, stopVoice, clearStats]);

  const leaveVoice = useCallback(() => {
    stopVoice();
    statusRef.current = 'idle';
    setVoiceStatus('idle');
    setErrorMessage(null);
  }, [stopVoice]);

  const notifyVideoPlayback = useCallback((paused: boolean) => {
    if (Platform.OS === 'ios' && recoveryPolicyRef.current === 'current') requestAudioRecovery(paused ? 'video-pause' : 'video-play', true, true);
  }, [requestAudioRecovery]);

  useEffect(() => {
    return () => {
      leaveVoice();
    };
  }, [leaveVoice]);

  // 联动房间生命周期：当退出房间或房间被重置/解散时，彻底终止 WebRTC 语音通道并释放麦克风
  const currentRoomId = useRoomStore((state) => state.roomState?.id);
  const prevRoomIdRef = useRef<string | undefined>(currentRoomId);

  useEffect(() => {
    if (prevRoomIdRef.current && !currentRoomId) {
      console.log('[VoiceService] 房间已退出或解散，自动挂断 WebRTC 语音并释放麦克风');
      leaveVoice();
    } else if (prevRoomIdRef.current && currentRoomId && prevRoomIdRef.current !== currentRoomId) {
      console.log('[VoiceService] 已切换至新房间，自动断开旧房间语音');
      leaveVoice();
    }
    prevRoomIdRef.current = currentRoomId;
  }, [currentRoomId, leaveVoice]);

  const toggleMute = useCallback(() => {
    const next = !controlsRef.current.muted;
    controlsRef.current.muted = next;
    setIsMuted(next);
    if (next) setStats(prev => ({ ...prev, localVolume: 0, isLocalSpeaking: false }));
    webviewRef.current?.injectJavaScript(`window.__voiceClient && window.__voiceClient.setMuted(${next}); true;`);
  }, []);

  const toggleDeafen = useCallback(() => {
    const next = !controlsRef.current.deafened;
    controlsRef.current.deafened = next;
    setIsDeafened(next);
    if (next) setStats(prev => ({ ...prev, maxRemoteVolume: 0, isRemoteSpeaking: false, remoteSpeakingByUserId: {} }));
    webviewRef.current?.injectJavaScript(`window.__voiceClient && window.__voiceClient.setDeafened(${next}); true;`);
  }, []);

  const setCallVolume = useCallback((vol: number) => {
    const norm = Math.max(0, Math.min(100, vol));
    controlsRef.current.volume = norm / 100;
    setCallVolumeState(norm);
    webviewRef.current?.injectJavaScript(`window.__voiceClient && window.__voiceClient.setVolume(${norm / 100}); true;`);
  }, []);

  const setVoiceDiagnosticsEnabled = useCallback((enabled: boolean) => {
    diagnosticsEnabledRef.current = enabled;
    setVoiceDiagnostics(null);
    if (enabled) diagnosticLogRef.current = [];
    webviewRef.current?.injectJavaScript(`window.__voiceClient && window.__voiceClient.setDiagnosticsEnabled(${enabled}); true;`);
  }, []);
  const setRecoveryPolicy = useCallback((policy: VoiceRecoveryPolicy) => {
    recoveryPolicyRef.current = policy;
    // A strategy switch must not leave a queued refresh from the previous arm.
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
    refreshOutputRef.current = false;
    retryInterruptedRef.current = false;
    recordDiagnostic('RECOVERY_POLICY', { policy });
  }, [recordDiagnostic]);
  const getVoiceDiagnosticLog = useCallback(() => diagnosticLogRef.current.slice(), []);

  return (
    <VoiceContext.Provider
      value={{
        engine: 'webview-webrtc',
        voiceStatus,
        errorMessage,
        isMuted,
        isDeafened,
        callVolume,
        stats: voiceStatus === 'connected' ? {
          ...stats,
          localVolume: isMuted ? 0 : stats.localVolume,
          isLocalSpeaking: !isMuted && stats.isLocalSpeaking,
          maxRemoteVolume: isDeafened ? 0 : stats.maxRemoteVolume,
          isRemoteSpeaking: !isDeafened && stats.isRemoteSpeaking,
          remoteSpeakingByUserId: isDeafened ? {} : stats.remoteSpeakingByUserId,
        } : emptyVoiceStats(),
        joinVoice,
        leaveVoice,
        toggleMute,
        toggleDeafen,
        setCallVolume,
        notifyVideoPlayback,
        voiceDiagnostics, setVoiceDiagnosticsEnabled, setRecoveryPolicy, getVoiceDiagnosticLog,
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
          mediaCapturePermissionGrantType="grant"
          javaScriptEnabled={true}
          domStorageEnabled={true}
          style={styles.bridgeWebView}
        />
      </View>
    </VoiceContext.Provider>
  );
};

export const VoiceProvider = NATIVE_IOS_VOICE_ENABLED ? createNativeVoiceProvider(VoiceContext) : WebVoiceProvider;

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
