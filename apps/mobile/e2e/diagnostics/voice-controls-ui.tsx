// Diagnostic-only native layout fixture. Its controlled voice context performs
// no call or audio routing. The native E2E reports that limitation explicitly.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { RoomModule } from '../../src/components/app/room-module';
import { AppTabBar } from '../../src/components/app/app-tab-bar';
import { WatchSessionControls } from '../../src/components/app/watch-session-controls';
import { PlayerTransitionNotice } from '../../src/components/app/player-transition-notice';
import { useRoomStore } from '../../src/store/useRoomStore';
import { emptyVoiceStats } from '../../src/services/voice-types';
import type { VoiceContextValue, VoiceStatus } from '../../src/services/voice-types';
import type { RoomState } from '@yiqikan/shared';
import type { AppTab } from '../../src/components/app/module-shell';

const room = { id: 'voice-ui', hostId: 'self', members: [{ id: 'self', name: 'Layout test' }], playback: { url: '', paused: true, currentTime: 0 } } as RoomState;
useRoomStore.setState({ roomState: room });

export function VoiceControlsUi({ context }: { context: React.Context<VoiceContextValue | null> }) {
  const [voiceStatus, setStatus] = useState<VoiceStatus>('connected');
  const [isMuted, setMuted] = useState(false);
  const [isDeafened, setDeafened] = useState(false);
  const [callVolume, setCallVolume] = useState(100);
  const [narrow, setNarrow] = useState(false);
  const [activeTab, setTab] = useState<AppTab>('room');
  const [noticePhase, setNoticePhase] = useState<'loading' | 'choose'>('loading');
  const [chatInput, setChatInput] = useState('');
  useEffect(() => { SplashScreen.hideAsync().catch(() => {}); }, []);
  useEffect(() => {
    const timer = setInterval(async () => {
      const views = (globalThis as any).__voiceUiViews || {};
      const rectangles = await Promise.all(Object.entries(views).map(([name, node]) => new Promise(resolve => {
        (node as any).measureInWindow((x: number, y: number, width: number, height: number) => resolve([name, { x, y, width, height }]));
      })));
      fetch(`${process.env.EXPO_PUBLIC_TAKEOVER_PROBE_URL}/sample`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'voice-ui-measurement', rects: Object.fromEntries(rectangles as any) }) }).catch(() => {});
    }, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    fetch(`${process.env.EXPO_PUBLIC_TAKEOVER_PROBE_URL}/sample`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'voice-ui-state', controlledContext: true, voiceStatus, isMuted, isDeafened, callVolume, narrow, activeTab }) }).catch(() => {});
  }, [voiceStatus, isMuted, isDeafened, callVolume, narrow, activeTab]);
  const value: VoiceContextValue = { engine: 'native-webrtc', voiceStatus, isMuted, isDeafened, callVolume, errorMessage: null,
    stats: { ...emptyVoiceStats(), isLocalSpeaking: !isMuted }, joinVoice: () => setStatus('connected'), leaveVoice: () => setStatus('idle'),
    toggleMute: () => setMuted(v => !v), toggleDeafen: () => setDeafened(v => !v), setCallVolume,
    notifyVideoPlayback() {}, voiceDiagnostics: null, setVoiceDiagnosticsEnabled() {}, setRecoveryPolicy() {}, getVoiceDiagnosticLog: () => [] };
  return <SafeAreaProvider><context.Provider value={value}><SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: '#0c0d12', alignItems: 'center' }}>
    <View style={{ flexDirection: 'row', gap: 16, padding: 8 }}>
      <TouchableOpacity testID="voice-ui-width" onPress={() => setNarrow(v => !v)} style={{ padding: 12 }}><Text style={{ color: '#fb923c' }}>{narrow ? '320 点窄屏' : '正常宽度'}</Text></TouchableOpacity>
      <TouchableOpacity testID="voice-ui-reconnect" onPress={() => setStatus(v => v === 'reconnecting' ? 'connected' : 'reconnecting')} style={{ padding: 12 }}><Text style={{ color: '#fb923c' }}>切换重连</Text></TouchableOpacity>
      {activeTab === 'watch' && <TouchableOpacity testID="notice-ui-phase" onPress={() => setNoticePhase(v => v === 'loading' ? 'choose' : 'loading')} style={{ padding: 12 }}><Text style={{ color: '#fb923c' }}>切换提示</Text></TouchableOpacity>}
    </View>
    <View style={{ flex: 1, width: narrow ? 320 : '100%' }}>
      {activeTab === 'room' ? <RoomModule room={room} myUserId="self" active messages={[]} chatInput={chatInput} setChatInput={setChatInput}
        onSend={async () => true} onMessagesRead={() => {}} onLeaveRoom={() => {}} onEntryFormClose={() => {}} />
        : <View style={{ flex: 1 }}>{activeTab === 'watch' && <><PlayerTransitionNotice phase={noticePhase} isHost={false} isFollowingHost={false} episodeLabel="第01集" onConfirm={() => setNoticePhase('loading')} /><WatchSessionControls onOpenChat={() => {}} unreadCount={1} /></>}</View>}
    </View>
    <View style={{ width: narrow ? 320 : '100%' }}><AppTabBar activeTab={activeTab} onChange={setTab} unreadCount={1} /></View>
  </SafeAreaView></context.Provider></SafeAreaProvider>;
}
