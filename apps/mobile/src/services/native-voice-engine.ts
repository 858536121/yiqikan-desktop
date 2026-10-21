import type * as RTC from 'react-native-webrtc';
import type { AudioSessionState } from './ios-audio-session';
import { emptyVoiceStats } from './voice-types';
import type { VoiceDiagnostics, VoiceStats, VoiceStatus } from './voice-types';

interface Ports {
  rtc: typeof RTC;
  activate: () => Promise<AudioSessionState | undefined>;
  deactivate: () => Promise<void> | undefined;
  snapshot: () => Promise<AudioSessionState | undefined>;
  recover: (retry: boolean) => Promise<AudioSessionState | undefined> | undefined;
  restartAudio?: () => Promise<AudioSessionState | undefined> | undefined;
  status: (status: VoiceStatus, error?: string) => void;
  stats: (stats: VoiceStats) => void;
  diagnostics: (value: VoiceDiagnostics) => void;
  log: (type: string, payload: unknown) => void;
}
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g,
  c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+');
// The existing SFU expects base64 of the URI-encoded name, rather than raw UTF-8.
export function nativeVoiceName(uid: string, name: string): string {
  const value = encodeURIComponent(name || 'User'), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < value.length; i += 3) {
    const a = value.charCodeAt(i), b = value.charCodeAt(i + 1), c = value.charCodeAt(i + 2);
    result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)] +
      (Number.isNaN(b) ? '=' : alphabet[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)]) +
      (Number.isNaN(c) ? '=' : alphabet[c & 63]);
  }
  return encode(`${uid}:${result}`);
}
const fingerprint = (sdp: string) => sdp.split('\r\n').filter(line => /^(m=|a=ssrc:|a=mid:)/.test(line)).join(';');
// The SDK's vendored EventTarget is present at runtime but lacks a declaration.
function listen<T>(target: object, type: string, callback: (event: T) => void) {
  (target as { addEventListener(type: string, callback: (event: T) => void): void }).addEventListener(type, callback);
}
interface AudioStats {
  type: string; kind?: string; mediaType?: string; audioLevel?: number;
  bytesSent?: number; bytesReceived?: number; packetsReceived?: number; totalAudioEnergy?: number;
  totalSamplesReceived?: number;
  trackIdentifier?: string; trackId?: string; receiverId?: string;
}

export class NativeVoiceEngine {
  private epoch = 0;
  private active = false;
  private audioOwned = false;
  private connected = false;
  private interrupted = false;
  private diagnosticsEnabled = false;
  private muted = false;
  private deafened = false;
  private volume = 1;
  private pc: RTC.RTCPeerConnection | null = null;
  private stream: RTC.MediaStream | null = null;
  private remote = new Map<string, { peer: string; track: RTC.MediaStreamTrack }>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private controllers = new Set<AbortController>();
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private identity: { room: string; uid: string; name: string } | null = null;
  private retrying: number | null = null;
  private recovery: Promise<void> | null = null;
  private emptySendSamples = 0;
  private audioRestartAttempted = false;
  constructor(private ports: Ports) {}

  private current(epoch: number) { return this.active && this.epoch === epoch; }
  private later(callback: () => void, delay: number) {
    const id = setTimeout(() => { this.timers.delete(id); callback(); }, delay);
    this.timers.add(id); return id;
  }
  private cancelTimer(id: ReturnType<typeof setTimeout> | null) { if (id) { clearTimeout(id); this.timers.delete(id); } }
  private clear(keepAudio = false) {
    this.active = false; this.connected = false; this.epoch++;
    this.timers.forEach(clearTimeout); this.timers.clear(); this.connectionTimer = this.disconnectTimer = null;
    this.controllers.forEach(c => c.abort()); this.controllers.clear(); this.recovery = null;
    this.emptySendSamples = 0;
    if (!keepAudio) this.audioRestartAttempted = false;
    this.pc?.close(); this.pc = null;
    if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); this.stream.release(); this.stream = null; }
    this.remote.clear(); this.ports.stats(emptyVoiceStats());
    if (!keepAudio && this.audioOwned) { this.audioOwned = false; void this.ports.deactivate()?.catch(() => {}); }
    if (!keepAudio) this.retrying = null;
  }
  leave() { this.identity = null; this.clear(); this.ports.status('idle'); }
  private fail(epoch: number, message: string) {
    if (!this.current(epoch)) return;
    this.clear(); this.ports.status('error', message);
  }
  private step(message: string) { this.ports.log('CONNECTION_STEP', { message }); }
  private async rpc(epoch: number, method: string, params: unknown[]) {
    if (!this.current(epoch)) throw new Error('Cancelled');
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = this.later(() => controller.abort(), 8000);
    try {
      const response = await fetch('https://api.videotogether.cn/kraken', { method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, signal: controller.signal,
        body: JSON.stringify({ id: `native-${epoch}-${Date.now()}-${Math.random().toString(36).slice(2)}`, method, params }) });
      if (!response.ok) throw new Error(`RPC ${method} HTTP ${response.status}`);
      const reply = await response.json();
      if (!this.current(epoch)) throw new Error('Cancelled');
      // Codes are useful for diagnosing expired publishers; never log server
      // messages which can echo SDP, ICE credentials or member identities.
      if (reply.error) throw new Error(`RPC ${method} failed${typeof reply.error.code === 'number' ? ` (${reply.error.code})` : ''}`);
      return reply;
    } finally { this.cancelTimer(timeout); this.controllers.delete(controller); }
  }
  async join(room: string, uid: string, name: string, reconnect = false): Promise<void> {
    this.clear(reconnect); this.active = true;
    const epoch = this.epoch, current = () => this.current(epoch);
    this.identity = { room, uid, name };
    this.ports.status(reconnect ? 'reconnecting' : 'connecting');
    this.connectionTimer = this.later(() => this.fail(epoch, '原生语音连接超时，请重试'), 15000);
    try {
      if (!room || !uid) throw new Error('缺少房间或用户身份');
      const rname = encode(`yiqikan_${room}`), uname = nativeVoiceName(uid, name);
      this.step('原生 WebRTC：正在获取 TURN');
      const turn = await this.rpc(epoch, 'turn', [uname]);
      if (!current()) return;
      const configuration: NonNullable<ConstructorParameters<typeof RTC.RTCPeerConnection>[0]> = { bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' };
      if (Array.isArray(turn.data) && turn.data.length) { configuration.iceServers = turn.data; configuration.iceTransportPolicy = 'relay'; }
      this.step('原生 WebRTC：正在初始化混音会话');
      if (!this.audioOwned) {
        this.audioOwned = true;
        const state = await this.ports.activate();
        if (!current()) return;
        this.ports.log('NATIVE_ACTIVATION_RESULT', state);
        if (!state?.nativeVoice) throw new Error('当前安装包缺少语音配置，请更新 App 后重试');
        if (state.interrupted) throw new Error('系统音频仍被中断，请结束其他通话后重试');
        this.interrupted = false;
      }
      if (!current()) return;
      const pc = new this.ports.rtc.RTCPeerConnection(configuration); this.pc = pc;
      let ucid = '', pending: unknown[] = [], offerFingerprint = '';
      listen<{ candidate: RTC.RTCIceCandidate | null }>(pc, 'icecandidate', event => {
        if (!current() || !event.candidate) return;
        const candidate = event.candidate.toJSON();
        if (!ucid) pending.push(candidate);
        else void this.rpc(epoch, 'trickle', [rname, uname, ucid, JSON.stringify(candidate)]).catch(() => {});
      });
      listen(pc, 'iceconnectionstatechange', () => {
        if (!current()) return;
        const state = pc.iceConnectionState;
        this.step(`原生 ICE：${state}`);
        if (state === 'connected' || state === 'completed') {
          this.cancelTimer(this.connectionTimer); this.cancelTimer(this.disconnectTimer);
          this.connectionTimer = this.disconnectTimer = null; this.connected = true; this.ports.status('connected');
        } else if (state === 'disconnected') {
          this.connected = false; this.ports.stats(emptyVoiceStats()); this.ports.status('reconnecting');
          this.cancelTimer(this.disconnectTimer);
          this.disconnectTimer = this.later(() => { if (current() && pc.iceConnectionState === 'disconnected') void this.reconnect(); }, 3500);
        } else if (state === 'failed') void this.reconnect();
      });
      listen(pc, 'connectionstatechange', () => { if (current() && pc.connectionState === 'failed') void this.reconnect(); });
      listen<{ track: RTC.MediaStreamTrack; streams: RTC.MediaStream[] }>(pc, 'track', event => {
        if (!current() || event.track.kind !== 'audio') return;
        const stream = event.streams[0];
        if (!stream) { event.track.enabled = false; return; }
        let raw = '';
        try { raw = decodeURIComponent(stream.id.replace(/\+/g, ' ')); } catch { event.track.enabled = false; return; }
        const colon = raw.lastIndexOf(':'), peer = colon < 0 ? raw : raw.slice(0, colon);
        if (peer === uid || raw.startsWith(`${uid}:`) || this.stream?.getTracks().some(t => t.id === event.track.id)) {
          event.track.enabled = false; return;
        }
        this.remote.set(event.track.id, { peer, track: event.track }); this.applyOutput();
        listen(event.track, 'ended', () => { if (current()) this.remote.delete(event.track.id); });
        // The native SDK removes receivers from the stream without ending the track.
        listen<{ track: RTC.MediaStreamTrack }>(stream, 'removetrack', removed => {
          if (current()) this.remote.delete(removed.track.id);
        });
      });
      this.step('原生 WebRTC：正在开启麦克风');
      // Native WebRTC supplies voice processing; browser audio constraints are unsupported by this SDK.
      const stream = await this.ports.rtc.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); stream.release(); return; }
      this.stream = stream;
      if (!stream.getAudioTracks().length) throw new Error('未获取到原生麦克风音轨');
      stream.getAudioTracks().forEach(track => {
        track.enabled = !this.muted;
        listen(track, 'ended', () => this.fail(epoch, '原生麦克风已停止，请重新连接'));
        pc.addTrack(track, stream);
      });
      this.step('原生 WebRTC：正在发布本地音轨');
      const offer = await pc.createOffer({}); if (!current()) return;
      await pc.setLocalDescription(offer); if (!current()) return;
      const published = await this.rpc(epoch, 'publish', [rname, uname, JSON.stringify(pc.localDescription?.toJSON())]);
      if (!current()) return;
      const jsep = published.data?.jsep && JSON.parse(published.data.jsep);
      if (!jsep || jsep.type !== 'answer' || typeof jsep.sdp !== 'string') throw new Error('SFU 未返回有效 Answer');
      await pc.setRemoteDescription(new this.ports.rtc.RTCSessionDescription(jsep)); if (!current()) return;
      ucid = published.data.track;
      if (!ucid) throw new Error('SFU 未返回语音发布标识');
      for (const candidate of pending) void this.rpc(epoch, 'trickle', [rname, uname, ucid, JSON.stringify(candidate)]).catch(() => {});
      pending = [];
      const subscribe = async () => {
        try {
          const reply = await this.rpc(epoch, 'subscribe', [rname, uname, ucid]); if (!current()) return;
          const remote = reply.data?.jsep && JSON.parse(reply.data.jsep);
          if (remote?.type === 'offer' && typeof remote.sdp === 'string') {
            const next = fingerprint(remote.sdp);
            if (next && next !== offerFingerprint) {
              await pc.setRemoteDescription(new this.ports.rtc.RTCSessionDescription(remote)); if (!current()) return;
              const answer = await pc.createAnswer(); if (!current()) return;
              await pc.setLocalDescription(answer); if (!current()) return;
              await this.rpc(epoch, 'answer', [rname, uname, ucid, JSON.stringify({ type: answer.type, sdp: answer.sdp })]);
              if (!current()) return; offerFingerprint = next;
            }
          }
        } catch (error) {
          if (current()) this.ports.log('SIGNAL_WARNING', { message: '原生订阅暂时失败，将重试',
            error: /^RPC /.test((error as Error).message) ? (error as Error).message : (error as Error).name,
            signalingState: pc.signalingState });
        }
        if (current()) this.later(() => { void subscribe(); }, 3000);
      };
      void subscribe(); void this.pollStats(epoch, pc);
      // publish/Answer only establishes signalling. ICE alone sets connected.
    } catch (error) {
      if (!current()) return;
      const name = (error as Error).name;
      this.fail(epoch, name === 'NotAllowedError' || name === 'SecurityError' ? '麦克风权限被拒绝，请在系统设置中允许' :
        (error as Error).message || '原生语音连接失败');
    }
  }
  private async reconnect() {
    if (!this.active || this.retrying !== null || !this.identity) return;
    const { room, uid, name } = this.identity;
    const pending = this.join(room, uid, name, true), epoch = this.epoch;
    this.retrying = epoch;
    try { await pending; } finally { if (this.retrying === epoch) this.retrying = null; }
  }
  private applyOutput() {
    this.remote.forEach(({ track }) => {
      track.enabled = !this.deafened;
      track._setVolume(this.deafened ? 0 : this.volume);
    });
  }
  setMuted(value: boolean) { this.muted = value; this.stream?.getAudioTracks().forEach(t => { t.enabled = !value; }); }
  setDeafened(value: boolean) { this.deafened = value; this.applyOutput(); }
  setVolume(value: number) { this.volume = Math.min(1, Math.max(0, value)); this.applyOutput(); }
  setDiagnosticsEnabled(value: boolean) { this.diagnosticsEnabled = value; }
  setInterrupted(value: boolean) { this.interrupted = value; if (value) this.ports.stats(emptyVoiceStats()); }
  async recoverAudioSession(retry: boolean) {
    if (!this.active || this.recovery) return;
    const epoch = this.epoch;
    const operation = (async () => {
      try {
        const state = await this.ports.recover(retry);
        if (!this.current(epoch)) return;
        if (state) { this.interrupted = state.interrupted; this.ports.log('NATIVE_SESSION', state); }
      } catch { if (this.current(epoch)) this.ports.log('RECOVERY_WARNING', { message: '原生音频恢复失败，保留真实中断状态' }); }
    })();
    this.recovery = operation;
    try { await operation; } finally { if (this.recovery === operation) this.recovery = null; }
  }
  private async restartSilentAudio(epoch: number) {
    if (this.audioRestartAttempted || this.recovery || !this.ports.restartAudio) return;
    // One attempt per requested call, including its ICE replacements. Silence,
    // intentional mute and lack of a stats report must not trigger restart loops.
    this.audioRestartAttempted = true;
    this.ports.log('AUDIO_DEVICE_RECOVERY', { reason: 'connected-with-zero-outbound-rtp', attempt: 1 });
    const operation = (async () => {
      try {
        const state = await this.ports.restartAudio!();
        if (this.current(epoch) && state) {
          this.interrupted = state.interrupted;
          this.ports.log('NATIVE_SESSION', state);
        }
      } catch { if (this.current(epoch)) this.ports.log('RECOVERY_WARNING', { message: '原生音频设备重启失败' }); }
    })();
    this.recovery = operation;
    try { await operation; } finally { if (this.recovery === operation) this.recovery = null; }
  }
  private async pollStats(epoch: number, pc: RTC.RTCPeerConnection) {
    try {
      const report: Map<string, AudioStats> = await pc.getStats(); if (!this.current(epoch)) return;
      const state = await this.ports.snapshot(); if (!this.current(epoch)) return;
      if (state) this.interrupted = state.interrupted;
      const stats = emptyVoiceStats(); let inbound: number | null = null, outbound: number | null = null, packets = 0, energy = 0, samples = 0;
      report.forEach(s => {
        if ((s.kind || s.mediaType) !== 'audio') return;
        if (s.type === 'outbound-rtp' && typeof s.bytesSent === 'number') outbound = (outbound ?? 0) + s.bytesSent;
        if (s.type === 'media-source' || s.type === 'outbound-rtp') stats.localVolume = Math.max(stats.localVolume, Number(s.audioLevel) || 0);
        if (s.type === 'inbound-rtp') {
          const identifier = s.trackIdentifier ?? (s.trackId ? report.get(s.trackId)?.trackIdentifier : undefined) ??
            (s.receiverId ? report.get(s.receiverId)?.trackIdentifier : undefined);
          const owned = identifier ? this.remote.get(identifier) : undefined;
          if (!owned) return;
          if (typeof s.bytesReceived === 'number') inbound = (inbound ?? 0) + s.bytesReceived;
          packets += Number(s.packetsReceived) || 0; energy += Number(s.totalAudioEnergy) || 0;
          samples += Number(s.totalSamplesReceived) || 0;
          const level = owned.track.muted || owned.track.readyState === 'ended' ? 0 : Number(s.audioLevel) || 0;
          stats.maxRemoteVolume = Math.max(stats.maxRemoteVolume, level);
          stats.remoteSpeakingByUserId[owned.peer] ||= level > 0.08;
        }
      });
      if (this.muted) stats.localVolume = 0;
      const microphoneEnabled = !!this.stream?.getAudioTracks().some(t => t.enabled && t.readyState !== 'ended');
      if (this.connected && !this.interrupted && !this.muted && microphoneEnabled && outbound === 0 &&
          state?.audioEnabled !== false && state?.inputAvailable !== false) this.emptySendSamples++;
      else this.emptySendSamples = 0;
      // A live microphone sends encoded silence too. A permanently zero sender
      // is different from a quiet participant or a stalled remote network.
      if (this.emptySendSamples >= 6) void this.restartSilentAudio(epoch);
      if (this.deafened) { stats.maxRemoteVolume = 0; stats.remoteSpeakingByUserId = {}; }
      stats.isLocalSpeaking = stats.localVolume > 0.08; stats.isRemoteSpeaking = stats.maxRemoteVolume > 0.08;
      this.ports.stats(this.connected && !this.interrupted && state?.nativeAudioRunning ? stats : emptyVoiceStats());
      if (this.diagnosticsEnabled) this.ports.diagnostics({ engine: 'native-webrtc', connectionEpoch: epoch,
        statsSupported: true, inboundBytes: inbound, outboundBytes: outbound, inboundPackets: packets, inboundAudioEnergy: energy,
        audioState: state?.nativeAudioRunning && !this.interrupted ? 'running' : 'stopped', audioCurrentTime: null,
        nativeAudioRunning: !!state?.nativeAudioRunning, systemInterrupted: this.interrupted,
        inboundSamples: samples, microphoneEnabled, audioUnitStartError: state?.audioUnitStartError,
        remoteStreams: this.remote.size, maxRemoteVolume: stats.maxRemoteVolume });
    } catch { if (this.current(epoch)) this.ports.stats(emptyVoiceStats()); }
    if (this.current(epoch)) this.later(() => { void this.pollStats(epoch, pc); }, 500);
  }
}
