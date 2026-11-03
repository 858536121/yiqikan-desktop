import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import { emptyVoiceStats } from './voice-types';
import type { VoiceDiagnostics, VoiceContextValue, VoiceStats, VoiceStatus } from './voice-types';
import { NativeVoiceEngine } from './native-voice-engine';
import { iosAudioSession } from './ios-audio-session';
import { useRoomStore } from '../store/useRoomStore';

export function createNativeVoiceProvider(Context: React.Context<VoiceContextValue | null>) {
  return function NativeVoiceProvider({ children, onShowToast }: { children: React.ReactNode; onShowToast?: (message: string) => void }) {
    const [voiceStatus, setStatus] = useState<VoiceStatus>('idle');
    const [errorMessage, setError] = useState<string | null>(null);
    const [isMuted, setMuted] = useState(false), [isDeafened, setDeafened] = useState(false);
    const [callVolume, setVolume] = useState(100);
    const [stats, setStats] = useState<VoiceStats>(emptyVoiceStats);
    const [voiceDiagnostics, setDiagnostics] = useState<VoiceDiagnostics | null>(null);
    const engine = useRef<NativeVoiceEngine | null>(null);
    const controls = useRef({ muted: false, deafened: false, volume: 1 });
    const diagnosticsEnabled = useRef(false);
    const toast = useRef(onShowToast); toast.current = onShowToast;
    const alive = useRef(true);
    const journal = useRef<Array<{ at: number; type: string; payload: unknown }>>([]);
    const statsDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
    const record = useCallback((type: string, payload: unknown) => {
      if (!diagnosticsEnabled.current) return;
      journal.current.push({ at: Date.now(), type, payload });
      if (journal.current.length > 600) journal.current.shift();
    }, []);
    const clearStats = useCallback(() => {
      if (statsDeadline.current) clearTimeout(statsDeadline.current);
      statsDeadline.current = null; if (alive.current) setStats(emptyVoiceStats());
    }, []);
    const leaveVoice = useCallback(() => {
      engine.current?.leave(); clearStats();
      if (alive.current) { setStatus('idle'); setError(null); setDiagnostics(null); }
    }, [clearStats]);
    const joinVoice = useCallback((room: string, uid: string, name: string) => {
      setError(null);
      try {
        if (!NativeModules.WebRTCModule) throw new Error('当前安装包缺少语音组件，请更新 App 后重试');
        if (!engine.current) {
          // Load the native SDK on the first call, after checking the installed binary.
          const rtc = require('react-native-webrtc') as typeof import('react-native-webrtc');
          engine.current = new NativeVoiceEngine({ rtc, activate: () => iosAudioSession.activate(),
            deactivate: () => iosAudioSession.deactivate(), snapshot: async () => iosAudioSession.snapshot(),
            recover: retry => iosAudioSession.recover(retry), log: record,
            restartAudio: () => iosAudioSession.restartAudio(),
            status(next, error) {
              if (!alive.current) return;
              record('VOICE_STATUS', { status: next }); setStatus(next);
              if (next !== 'connected') { clearStats(); setDiagnostics(null); }
              if (error) { setError(error); setDiagnostics(null); toast.current?.(error); }
              if (next === 'connected') toast.current?.('已连接语音频道');
            },
            stats(value) {
              if (!alive.current) return;
              setStats(value);
              if (statsDeadline.current) clearTimeout(statsDeadline.current);
              statsDeadline.current = setTimeout(clearStats, 1500);
            },
            diagnostics(value) { if (alive.current && diagnosticsEnabled.current) setDiagnostics(value); },
          });
        }
        engine.current.setMuted(controls.current.muted);
        engine.current.setDeafened(controls.current.deafened);
        engine.current.setVolume(controls.current.volume);
        engine.current.setDiagnosticsEnabled(diagnosticsEnabled.current);
        void engine.current.join(room, uid, name);
      } catch (error) {
        clearStats(); setStatus('error'); setError((error as Error).message); toast.current?.((error as Error).message);
      }
    }, [record, clearStats]);

    useEffect(() => {
      alive.current = true;
      const unsubscribe = iosAudioSession.subscribe(state => {
        engine.current?.setInterrupted(state.interrupted); record('NATIVE_SESSION', state);
        // Audio-device callbacks report state; recovering them would feed back into start/stop.
        if (state.reason === 'route-change' || state.reason === 'media-services-reset' || state.reason === 'interruption-ended') {
          void engine.current?.recoverAudioSession(state.reason !== 'route-change');
        }
      });
      const sub = AppState.addEventListener('change', next => { if (next === 'active') void engine.current?.recoverAudioSession(true); });
      return () => { alive.current = false; unsubscribe(); sub.remove(); engine.current?.leave(); clearStats(); };
    }, [record, clearStats]);
    const room = useRoomStore(state => state.roomState?.id);
    const previousRoom = useRef(room);
    useEffect(() => {
      if (previousRoom.current && previousRoom.current !== room) leaveVoice();
      previousRoom.current = room;
    }, [room, leaveVoice]);
    const setVoiceDiagnosticsEnabled = useCallback((enabled: boolean) => {
      diagnosticsEnabled.current = enabled; setDiagnostics(null);
      if (enabled) journal.current = [];
      engine.current?.setDiagnosticsEnabled(enabled);
    }, []);
    const setRecoveryPolicy = useCallback((policy: 'current' | 'abnormal-only') => {
      record('RECOVERY_POLICY', { policy, applies: false, engine: 'native-webrtc' });
    }, [record]);
    const notifyVideoPlayback = useCallback((paused: boolean) => { record('VIDEO_PLAYBACK', { paused }); }, [record]);
    const getVoiceDiagnosticLog = useCallback(() => journal.current.slice(), []);
    const value: VoiceContextValue = { engine: 'native-webrtc', voiceStatus, errorMessage, isMuted, isDeafened, callVolume,
      stats: voiceStatus === 'connected' ? { ...stats, localVolume: isMuted ? 0 : stats.localVolume,
        isLocalSpeaking: !isMuted && stats.isLocalSpeaking, maxRemoteVolume: isDeafened ? 0 : stats.maxRemoteVolume,
        isRemoteSpeaking: !isDeafened && stats.isRemoteSpeaking,
        remoteSpeakingByUserId: isDeafened ? {} : stats.remoteSpeakingByUserId } : emptyVoiceStats(),
      joinVoice, leaveVoice,
      toggleMute() { const next = !controls.current.muted; controls.current.muted = next;
        setMuted(next); engine.current?.setMuted(next); if (next) clearStats(); },
      toggleDeafen() { const next = !controls.current.deafened; controls.current.deafened = next;
        setDeafened(next); engine.current?.setDeafened(next); if (next) clearStats(); },
      setCallVolume(vol) { const next = Math.min(100, Math.max(0, vol)); controls.current.volume = next / 100;
        setVolume(next); engine.current?.setVolume(next / 100); },
      notifyVideoPlayback,
      voiceDiagnostics,
      setVoiceDiagnosticsEnabled, setRecoveryPolicy, getVoiceDiagnosticLog,
    };
    return <Context.Provider value={value}>{children}</Context.Provider>;
  };
}
