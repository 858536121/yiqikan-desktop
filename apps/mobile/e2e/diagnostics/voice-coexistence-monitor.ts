import type { VoiceDiagnostics } from '../../src/services/voice-types';

export interface DemoVideoSample {
  id: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
  readyState: number;
  frames: number | null;
  event: string;
}

export function isDemoVideoSample(value: unknown): value is DemoVideoSample {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && v.id.length < 256 && typeof v.event === 'string' &&
    ['currentTime', 'duration', 'volume', 'playbackRate', 'readyState'].every(key => typeof v[key] === 'number' && Number.isFinite(v[key])) &&
    ['paused', 'ended', 'muted'].every(key => typeof v[key] === 'boolean') &&
    (v.frames === null || (typeof v.frames === 'number' && Number.isFinite(v.frames)));
}

export interface DemoObservation {
  now: number;
  active: boolean;
  voiceStatus: string;
  muted: boolean;
  deafened: boolean;
  callVolume: number;
  video: DemoVideoSample | null;
  videoAt: number;
  audio: VoiceDiagnostics | null;
  audioAt: number;
}

export interface CoexistenceRun {
  phase: 'waiting-remote' | 'running' | 'observed' | 'failed';
  reason: string;
  startedAt: number;
  checkedAt: number;
  durationMs: number;
  videoId: string;
  connectionEpoch: number;
  firstTime: number;
  lastTime: number;
  lastProgressAt: number;
  firstFrames: number | null;
  lastAudioClock: number;
  lastAudioAt: number;
  lastAudioProgressAt: number;
  lastInbound: number;
  lastOutbound: number;
  receivedBytes: number;
  sentBytes: number;
  lastInboundGrowthAt: number;
  lastOutboundGrowthAt: number;
  remoteSignalSeen: boolean;
}

function prerequisite(o: DemoObservation, requireRemote = true): string {
  if (!o.active) return 'App 已离开前台';
  if (o.voiceStatus !== 'connected') return '语音尚未连接或已断线';
  if (o.muted || o.deafened || o.callVolume <= 0) return '请开启麦克风和收听，通话音量需大于零';
  if (!o.video || o.now - o.videoAt > 1500) return '没有新鲜的视频观测，不能判断通过';
  if (o.video.paused || o.video.ended) return '观察到视频暂停或结束；暂停来源需要查看时间线';
  if (o.video.muted || o.video.volume <= 0) return '视频静音，无法验证视频声音与语音共存';
  if (o.video.playbackRate !== 1) return '请使用 1 倍速做对照';
  if (!o.audio || o.now - o.audioAt > 2500 || !o.audio.statsSupported) return '没有新鲜的 RTP 统计，不能判断通过';
  if (o.audio.systemInterrupted || o.audio.audioState !== 'running' ||
      (o.audio.engine === 'native-webrtc' ? !o.audio.nativeAudioRunning : o.audio.audioCurrentTime === null)) return '语音输出中断或尚未运行';
  if (o.audio.outboundBytes === null) return '没有本地 RTP 发布统计，不能判断通过';
  if (requireRemote && (o.audio.inboundBytes === null || !o.audio.remoteStreams)) return '请让另一台设备进入同一房间并开启语音';
  return '';
}

export function beginCoexistenceRun(o: DemoObservation, durationMs = 60000): CoexistenceRun {
  const reason = prerequisite(o, false);
  return {
    phase: reason ? 'failed' : !o.audio?.remoteStreams || o.audio.inboundBytes === null ? 'waiting-remote' : 'running', reason,
    startedAt: o.now, checkedAt: o.now, durationMs,
    videoId: o.video?.id ?? '', connectionEpoch: o.audio?.connectionEpoch ?? -1,
    firstTime: o.video?.currentTime ?? 0, lastTime: o.video?.currentTime ?? 0,
    lastProgressAt: o.now, firstFrames: o.video?.frames ?? null,
    lastAudioClock: o.audio?.audioCurrentTime ?? 0, lastAudioAt: o.audioAt,
    lastAudioProgressAt: o.now, lastInbound: o.audio?.inboundBytes ?? 0,
    lastOutbound: o.audio?.outboundBytes ?? 0, receivedBytes: 0, sentBytes: 0,
    lastInboundGrowthAt: o.now, lastOutboundGrowthAt: o.now, remoteSignalSeen: false,
  };
}

export function observeCoexistenceRun(run: CoexistenceRun, o: DemoObservation): CoexistenceRun {
  if (run.phase !== 'running' && run.phase !== 'waiting-remote') return run;
  const next = { ...run, checkedAt: o.now };
  const fail = (reason: string): CoexistenceRun => ({ ...next, phase: 'failed', reason });
  const invalid = prerequisite(o, run.phase !== 'waiting-remote');
  if (invalid) return fail(invalid);
  const video = o.video!, audio = o.audio!;
  if (o.now < run.checkedAt) return fail('设备时钟倒退，请重新开始');
  if (o.now - run.checkedAt > 2500) return fail('观测中断，不能把缺失时间计入连续通过');
  if (video.id !== run.videoId || audio.connectionEpoch !== run.connectionEpoch) return fail('视频或语音连接已切换，请重新开始一轮');
  if (run.phase === 'waiting-remote' && o.now - run.startedAt > 30000) return fail('30 秒内没有成员进入语音，请重新开始');
  const delta = video.currentTime - run.lastTime;
  if (delta < -0.1 || delta > (o.now - run.checkedAt) / 1000 + 1) return fail('视频进度发生跳转，不能作为连续播放证据');
  if (delta > 0.02) next.lastProgressAt = o.now;
  next.lastTime = video.currentTime;
  if (o.now - next.lastProgressAt > 2500) return fail('视频进度停住超过 2.5 秒');
  if (o.audioAt !== run.lastAudioAt) {
    next.lastAudioAt = o.audioAt;
    if (audio.engine !== 'native-webrtc') {
      if (audio.audioCurrentTime! > run.lastAudioClock) next.lastAudioProgressAt = o.now;
      next.lastAudioClock = audio.audioCurrentTime!;
    }
    if ((audio.inboundBytes ?? 0) < run.lastInbound || audio.outboundBytes! < run.lastOutbound) return fail('RTP 计数已重置，请重新开始一轮');
    const received = (audio.inboundBytes ?? 0) - run.lastInbound, sent = audio.outboundBytes! - run.lastOutbound;
    next.receivedBytes += received; next.sentBytes += sent;
    if (received > 0) next.lastInboundGrowthAt = o.now;
    if (sent > 0) next.lastOutboundGrowthAt = o.now;
    next.lastInbound = audio.inboundBytes ?? 0; next.lastOutbound = audio.outboundBytes!;
    next.remoteSignalSeen ||= received > 0 && audio.maxRemoteVolume > 0.08;
  }
  if (audio.engine !== 'native-webrtc' && o.now - next.lastAudioProgressAt > 3500) return fail('语音输出时钟停住');
  if ((run.phase !== 'waiting-remote' && o.now - next.lastInboundGrowthAt > 5000) || o.now - next.lastOutboundGrowthAt > 5000) return fail('RTP 收发持续停住超过 5 秒');
  if (run.phase === 'waiting-remote') {
    // Validate the transition sample before starting a fresh simultaneous window:
    // a video jump or stall at the instant the member joins must not be hidden.
    return audio.remoteStreams && audio.inboundBytes !== null ? beginCoexistenceRun(o, run.durationMs) : next;
  }
  if (o.now - run.startedAt >= run.durationMs) {
    if (video.currentTime - run.firstTime < run.durationMs / 1000 * 0.8) return fail('视频累计进度不足');
    if (run.firstFrames !== null && video.frames !== null && video.frames <= run.firstFrames) return fail('没有观察到新视频帧');
    if (!next.receivedBytes || !next.sentBytes || !next.remoteSignalSeen) return fail('缺少双向 RTP 或远端发声证据，请双方轮流讲话');
    next.phase = 'observed'; next.reason = '技术观测通过，仍需双方确认实际听音和回声';
  }
  return next;
}

export function coexistenceVerdict(run: CoexistenceRun | null, heardRemoteAndVideo: boolean, partnerHeard: boolean, noEcho: boolean): string {
  if (!run) return '尚未开始';
  if (run.phase === 'failed') return `未通过：${run.reason}`;
  if (run.phase === 'waiting-remote') return '正在观测视频，请另一台设备在 30 秒内进入语音';
  if (run.phase === 'running') return '正在连续观测';
  return heardRemoteAndVideo && partnerHeard && noEcho ? '本轮共存测试通过（仅限此设备、来源与测试时段）' : run.reason;
}

export function reportSource(url: string): string {
  try { const value = new URL(url); return `${value.protocol}//${value.host}${value.pathname}`; }
  catch { return 'invalid'; }
}
