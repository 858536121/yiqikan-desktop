import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, Share, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useVoice } from '../../src/services/voice-service';
import { beginCoexistenceRun, observeCoexistenceRun, coexistenceVerdict, reportSource, isDemoVideoSample } from './voice-coexistence-monitor';
import type { CoexistenceRun, DemoObservation, DemoVideoSample } from './voice-coexistence-monitor';
import type { VoiceDiagnostics, VoiceRecoveryPolicy } from '../../src/services/voice-types';
import { buildDemoVideoHtml, DEFAULT_DEMO_VIDEO, VOICE_DEMO_VIDEO_PROBE } from './voice-demo-video';
import { VoicePanel } from '../../src/components/app/voice-panel';
import { iosAudioSession } from '../../src/services/ios-audio-session';
import { createLocalAudioProbe, idleLocalProbe } from './voice-local-probe';
import type { LocalProbeKind } from './voice-local-probe';

interface Props { roomId: string; myUserId: string; myName: string; onClose: () => void }
interface Trace { at: number; type: string; payload: unknown }

export function VoiceCoexistenceDemo({ roomId, myUserId, myName, onClose }: Props) {
  const voice = useVoice();
  const voiceRef = useRef(voice); voiceRef.current = voice;
  const webview = useRef<WebView<{}>>(null);
  const [policy, setPolicy] = useState<VoiceRecoveryPolicy>('abnormal-only');
  const [urlInput, setUrlInput] = useState(DEFAULT_DEMO_VIDEO);
  const [source, setSource] = useState({ url: DEFAULT_DEMO_VIDEO, page: false, revision: 0 });
  const [video, setVideo] = useState<DemoVideoSample | null>(null);
  const [run, setRun] = useState<CoexistenceRun | null>(null);
  const [heard, setHeard] = useState(false), [partnerHeard, setPartnerHeard] = useState(false), [noEcho, setNoEcho] = useState(false);
  const [hint, setHint] = useState('先开启视频和语音，让另一台设备进入同一房间并轮流讲话。');
  const [connectionStep, setConnectionStep] = useState('等待进入语音');
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const [localProbeState, setLocalProbeState] = useState(idleLocalProbe);
  const latestVideo = useRef<{ value: DemoVideoSample | null; at: number }>({ value: null, at: 0 });
  const latestAudio = useRef<{ value: VoiceDiagnostics | null; at: number }>({ value: null, at: 0 });
  const runRef = useRef<CoexistenceRun | null>(null);
  const trace = useRef<Trace[]>([]);
  const active = useRef(AppState.currentState === 'active');
  const originalRoom = useRef(roomId);
  const sourceRef = useRef(source); sourceRef.current = source;
  const record = (type: string, payload: unknown) => {
    trace.current.push({ at: Date.now(), type, payload });
    if (trace.current.length > 3000) trace.current.shift();
  };
  const localProbe = useMemo(() => createLocalAudioProbe({
    getVideo: () => latestVideo.current,
    activateNative: () => iosAudioSession.activate(),
    releaseNative: () => iosAudioSession.deactivate(),
    startPage: id => webview.current?.injectJavaScript(`window.__voiceDemoVideo && window.__voiceDemoVideo.startMicrophoneProbe(${id}); true;`),
    stopPage: id => webview.current?.injectJavaScript(`window.__voiceDemoVideo && window.__voiceDemoVideo.stopMicrophoneProbe(${id}); true;`),
    onChange: setLocalProbeState, record,
  }), []);
  const probeBusy = localProbeState.status === 'starting' || localProbeState.status === 'active';
  const updateRun = (next: CoexistenceRun | null) => {
    if (next && next.phase !== runRef.current?.phase) record('RUN_PHASE', { phase: next.phase, reason: next.reason });
    runRef.current = next; setRun(next);
  };
  const observation = (): DemoObservation => ({ now: Date.now(), active: active.current,
    voiceStatus: voiceRef.current.voiceStatus, muted: voiceRef.current.isMuted,
    deafened: voiceRef.current.isDeafened, callVolume: voiceRef.current.callVolume,
    video: latestVideo.current.value, videoAt: latestVideo.current.at,
    audio: latestAudio.current.value, audioAt: latestAudio.current.at });
  const observe = () => {
    if (runRef.current && ['running', 'waiting-remote'].includes(runRef.current.phase)) updateRun(observeCoexistenceRun(runRef.current, observation()));
  };

  useEffect(() => {
    voice.setVoiceDiagnosticsEnabled(true);
    voice.setRecoveryPolicy('abnormal-only');
    const sub = AppState.addEventListener('change', next => {
      // Permission dialogs can temporarily make iOS inactive; allow the grant to finish.
      if (next === 'background') localProbe.stop();
      active.current = next === 'active'; record('APP_STATE', next); observe();
    });
    const timer = setInterval(() => {
      observe();
      const logs = voiceRef.current.getVoiceDiagnosticLog();
      const step = [...logs].reverse().find(entry => entry.type === 'CONNECTION_STEP');
      if (step) setConnectionStep((step.payload as { message: string }).message);
    }, 500);
    const back = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => {
      clearInterval(timer); sub.remove(); back.remove();
      localProbe.dispose();
      voice.leaveVoice(); voice.setVoiceDiagnosticsEnabled(false); voice.setRecoveryPolicy('current');
    };
  }, [voice.leaveVoice, voice.setVoiceDiagnosticsEnabled, voice.setRecoveryPolicy, localProbe]);

  useEffect(() => { if (voice.voiceStatus !== 'idle' && voice.voiceStatus !== 'error') localProbe.stop(); }, [voice.voiceStatus, localProbe]);

  useEffect(() => {
    latestAudio.current = { value: voice.voiceDiagnostics, at: Date.now() };
    if (voice.voiceDiagnostics) record('AUDIO', voice.voiceDiagnostics);
  }, [voice.voiceDiagnostics]);
  useEffect(() => { if (roomId !== originalRoom.current) onClose(); }, [roomId, onClose]);

  const webSource = useMemo(() => source.page ? { uri: source.url }
    : { html: buildDemoVideoHtml(source.url), baseUrl: 'https://localhost' }, [source]);
  const reset = () => { updateRun(null); setHeard(false); setPartnerHeard(false); setNoEcho(false); };
  const changePolicy = (next: VoiceRecoveryPolicy) => {
    localProbe.stop();
    // Hang up first so a pending recovery from the previous arm cannot leak into the next.
    voice.leaveVoice(); reset(); voice.setRecoveryPolicy(next); setPolicy(next);
    record('POLICY', next); setHint('策略已切换并挂断语音，请重新进入语音后开始一轮。');
  };
  const load = (page: boolean) => {
    let url: URL;
    try { url = new URL(urlInput.trim()); } catch { setHint('请输入有效的 HTTPS 地址'); return; }
    if (url.protocol !== 'https:' || url.username || url.password) { setHint('仅支持不带账号密码的 HTTPS 地址'); return; }
    localProbe.stop();
    reset(); latestVideo.current = { value: null, at: 0 }; setVideo(null);
    record('SOURCE', { url: reportSource(url.href), page });
    setSource({ url: url.href, page, revision: source.revision + 1 });
    setHint(page ? '网页模式只观测主页面可见视频；未识别到视频时不会判为通过。' : '测试视频不自动播放；请点播放，确认视频声音可听。');
  };
  const handleVideo = (event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'DEMO_MIC_PROBE') { localProbe.handlePageMessage(data.payload); return; }
      if (data.type === 'DEMO_NO_VIDEO') {
        latestVideo.current = { value: null, at: Date.now() }; setVideo(null); observe(); return;
      }
      if (data.type !== 'DEMO_VIDEO') return;
      const value = data.payload;
      if (!isDemoVideoSample(value)) { setHint('视频探测数据不完整，不能作为验收证据'); return; }
      latestVideo.current = { value, at: Date.now() }; setVideo(value); record('VIDEO', value);
      // Reproduce the selected strategy using the same provider as the regular room.
      if (value.event === 'play' || value.event === 'pause') voiceRef.current.notifyVideoPlayback(value.paused);
      observe();
    } catch { setHint('视频探测消息无效，不能作为验收证据'); }
  };
  const command = (action: string) => {
    record('VIDEO_COMMAND', action);
    webview.current?.injectJavaScript(`window.__voiceDemoVideo && window.__voiceDemoVideo.command(${JSON.stringify(action)}); true;`);
  };
  const begin = () => {
    if (probeBusy) { setHint('先停止单机定位，再进入语音开始共存观测'); return; }
    reset();
    const durationMs = latestVideo.current.value && latestVideo.current.value.duration > 0 && latestVideo.current.value.duration < 65 ? 30000 : 60000;
    const next = beginCoexistenceRun(observation(), durationMs); updateRun(next); record('RUN_BEGIN', { policy, next });
  };
  const startLocalProbe = (kind: LocalProbeKind) => {
    if (voiceRef.current.voiceStatus !== 'idle' && voiceRef.current.voiceStatus !== 'error') {
      setHint('先挂断语音，再开始单机定位'); return;
    }
    if (sourceRef.current.page) { setHint('单机定位请先加载 MP4；网页／B 站仍用上方正常连麦测试'); return; }
    reset(); void localProbe.start(kind);
  };
  const exportReport = async () => {
    const report = {
      schema: 'yiqikan-voice-coexistence-v1', exportedAt: new Date().toISOString(),
      engine: voice.engine, policy: voice.engine === 'native-webrtc' ? null : policy,
      platform: Platform.OS, osVersion: Platform.Version, appVersion: Constants.expoConfig?.version,
      runtimeVersion: Updates.runtimeVersion, updateId: Updates.updateId,
      configBuildNumber: Constants.expoConfig?.ios?.buildNumber, roomId,
      source: { url: reportSource(sourceRef.current.url), page: sourceRef.current.page },
      run, humanChecks: { heardRemoteAndVideo: heard, partnerHeardMe: partnerHeard, noEcho },
      verdict: coexistenceVerdict(run, heard, partnerHeard, noEcho),
      trace: trace.current, voiceTrace: voice.getVoiceDiagnosticLog(),
    };
    try { await Share.share({ title: '连麦共存测试报告', message: JSON.stringify(report, null, 2) }); }
    catch { setHint('报告分享失败，请重试'); }
  };
  const check = (label: string, value: boolean, set: (value: boolean) => void) => (
    <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled: run?.phase !== 'observed' }}
      disabled={run?.phase !== 'observed'} style={styles.button} onPress={() => set(!value)}>
      <Text style={styles.text}>{value ? '☑' : '☐'} {label}</Text>
    </TouchableOpacity>
  );
  const audio = voice.voiceDiagnostics;
  const nativeVoice = voice.engine === 'native-webrtc';
  return (
    // Keep the video and the shared voice WebView in the room's native window.
    // A full-screen native modal covers the presenting voice engine on iOS.
    <View style={styles.overlay} accessibilityViewIsModal>
      <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}><Text style={styles.title}>视频与语音共存测试</Text>
          <TouchableOpacity onPress={onClose} accessibilityLabel="退出共存测试"><Text style={styles.text}>退出并挂断</Text></TouchableOpacity></View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.text}>房号 {roomId} · {Platform.OS} {String(Platform.Version)}</Text>
          <Text style={styles.note}>{nativeVoice ? '当前引擎：原生 WebRTC（iOS 测试版），没有语音 WebView；A/B 网页恢复策略不适用。' : '当前引擎：网页 WebRTC。A/B 只比较恢复策略，使用相同开麦流程。'}先测试视频后语音，再反过来；对方可用原有 Android 进入同房间。测试页的视频不广播房间播放状态。</Text>
          {!nativeVoice && <View style={styles.row}>
            <TouchableOpacity testID="voice-demo-current" style={[styles.button, policy === 'current' && styles.selected]} onPress={() => changePolicy('current')}><Text style={styles.text}>A 现有恢复策略</Text></TouchableOpacity>
            <TouchableOpacity testID="voice-demo-abnormal" style={[styles.button, policy === 'abnormal-only' && styles.selected]} onPress={() => changePolicy('abnormal-only')}><Text style={styles.text}>B 仅异常时恢复</Text></TouchableOpacity>
          </View>}
          <TextInput value={urlInput} onChangeText={setUrlInput} style={styles.input} autoCapitalize="none" autoCorrect={false} accessibilityLabel="共存测试视频或网页地址" />
          <View style={styles.row}>
            <TouchableOpacity style={styles.button} onPress={() => load(false)}><Text style={styles.text}>加载 MP4</Text></TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => load(true)}><Text style={styles.text}>加载网页／B 站</Text></TouchableOpacity>
          </View>
          <View style={styles.player}>
            <WebView<{}> key={source.revision} ref={webview} source={webSource} originWhitelist={['*']} javaScriptEnabled
              injectedJavaScript={VOICE_DEMO_VIDEO_PROBE} onMessage={handleVideo} allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false} sharedCookiesEnabled
              mediaCapturePermissionGrantType={source.page ? 'prompt' : 'grant'}
              onLoadStart={() => { localProbe.stop(); latestVideo.current = { value: null, at: 0 }; setVideo(null); observe(); }}
              onError={() => { latestVideo.current = { value: null, at: 0 }; setVideo(null); observe(); setHint('视频页面加载失败，请检查网络或换地址'); }}
              onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url.startsWith('https://')}
              style={styles.webview} />
          </View>
          <View style={styles.row}>{['play', 'pause', 'rewind'].map((action, index) =>
            <TouchableOpacity key={action} disabled={!video} style={[styles.button, !video && styles.disabled]} onPress={() => command(action)}><Text style={styles.text}>{['播放', '暂停', '回到开头'][index]}</Text></TouchableOpacity>)}</View>
          {probeBusy ? <Text style={styles.note}>单机定位进行中，请先停止定位再进入语音。</Text> : <VoicePanel roomId={roomId} myUserId={myUserId} myName={myName} />}
          <Text style={styles.note}>{hint}</Text>
          <View style={styles.card}>
            <Text style={styles.text}>视频：{video ? `${video.paused ? '暂停' : '播放'} ${video.currentTime.toFixed(1)} / ${video.duration.toFixed(1)} 秒 · ${video.muted ? '静音' : '有声设置'} · 帧 ${video.frames ?? '不支持'}` : '尚未识别到可测视频'}</Text>
            <Text style={styles.text}>语音：{voice.voiceStatus} · 输出 {audio?.audioState ?? '等待统计'} · {nativeVoice ? `原生音频 ${audio?.nativeAudioRunning ? '已收到启动通知' : '尚无启动通知'}` : `时钟 ${audio?.audioCurrentTime?.toFixed(2) ?? '—'}`}</Text>
            <Text style={styles.note}>连接阶段：{voice.voiceStatus === 'idle' ? '等待进入语音' : connectionStep}</Text>
            {voice.errorMessage && <Text style={styles.text}>连接错误：{voice.errorMessage}</Text>}
            <Text style={styles.text}>RTP 收／发：{audio?.inboundBytes ?? '—'} / {audio?.outboundBytes ?? '—'} 字节</Text>
            <Text style={styles.text}>远端音轨 {audio?.remoteStreams ?? 0} · 发声电平 {Math.round((audio?.maxRemoteVolume ?? 0) * 100)}%</Text>
          </View>
          <TouchableOpacity testID="voice-demo-begin" style={[styles.button, styles.selected]} onPress={begin}><Text style={styles.text}>开始观测（成员加入后测 {video && video.duration > 0 && video.duration < 65 ? 30 : 60} 秒）</Text></TouchableOpacity>
          <Text style={styles.text}>{coexistenceVerdict(run, heard, partnerHeard, noEcho)}</Text>
          {run && <Text style={styles.note}>已观测 {Math.max(0, (run.checkedAt - run.startedAt) / 1000).toFixed(1)} 秒；视频推进 {(run.lastTime - run.firstTime).toFixed(1)} 秒</Text>}
          {check('我同时听到视频和对方讲话', heard, setHeard)}
          {check('对方确认能听到我的讲话', partnerHeard, setPartnerHeard)}
          {check('双方确认没有明显回声', noEcho, setNoEcho)}
          {!nativeVoice && <View style={styles.card}>
            <Text style={styles.text}>单机定位（不连服务器）</Text>
            <Text style={styles.note}>每项先重启 App，再进入 Demo 播放有声 MP4，测完点停止。第一项只切换原生会话，不开麦；第二项在视频页开麦，不初始化原生会话。观察是否暂停，以及手动点播放后能否继续。这两项不能作为双人连麦验收。</Text>
            <TouchableOpacity testID="voice-demo-native-probe" disabled={probeBusy || Platform.OS !== 'ios'} style={[styles.button, (probeBusy || Platform.OS !== 'ios') && styles.disabled]} onPress={() => startLocalProbe('native-session')}><Text style={styles.text}>1 只初始化原生音频会话</Text></TouchableOpacity>
            <TouchableOpacity testID="voice-demo-page-probe" disabled={probeBusy} style={[styles.button, probeBusy && styles.disabled]} onPress={() => startLocalProbe('same-page-mic')}><Text style={styles.text}>2 只在视频页开启麦克风</Text></TouchableOpacity>
            <TouchableOpacity testID="voice-demo-stop-probe" style={styles.button} onPress={() => localProbe.stop()}><Text style={styles.text}>停止单机定位</Text></TouchableOpacity>
            <Text style={styles.note}>{localProbeState.message}</Text>
          </View>}
          <TouchableOpacity style={styles.button} onPress={exportReport}><Text style={styles.text}>分享本轮 JSON 报告</Text></TouchableOpacity>
          <Text style={styles.note}>没有采集到视频或 RTP、暂停、卡住、重连、后台都会使本轮未通过；Demo 不自动续播掩盖暂停。有音量／RTP 不代表扬声器实际出声，勾选听音项后才算本轮通过。长时间与耳机切换仍需另测。</Text>
        </ScrollView>
      </SafeAreaView>
      </SafeAreaProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, elevation: 100, backgroundColor: '#090c13' },
  root: { flex: 1, backgroundColor: '#090c13' },
  header: { padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  body: { padding: 16, gap: 12 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  text: { color: '#e4e4e7', fontSize: 13, lineHeight: 21 }, note: { color: '#999', fontSize: 12, lineHeight: 19 },
  input: { color: '#fff', padding: 12, borderWidth: 1, borderColor: '#333', borderRadius: 8 },
  button: { padding: 10, backgroundColor: '#232833', borderRadius: 8 }, disabled: { opacity: 0.4 }, selected: { backgroundColor: '#9a4317' },
  player: { height: 230, backgroundColor: '#000', borderRadius: 8, overflow: 'hidden' }, webview: { flex: 1, backgroundColor: '#000' },
  card: { padding: 12, gap: 4, backgroundColor: '#151a24', borderRadius: 8 },
});
