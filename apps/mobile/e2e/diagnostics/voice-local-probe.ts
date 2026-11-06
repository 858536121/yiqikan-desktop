import type { AudioSessionState } from '../../src/services/ios-audio-session';
import type { DemoVideoSample } from './voice-coexistence-monitor';

export type LocalProbeKind = 'native-session' | 'same-page-mic';
export interface LocalProbeState {
  id: number;
  kind: LocalProbeKind | null;
  status: 'idle' | 'starting' | 'active' | 'error';
  message: string;
}
interface Ports {
  getVideo: () => { value: DemoVideoSample | null; at: number };
  activateNative: () => Promise<AudioSessionState | undefined>;
  releaseNative: () => Promise<void> | undefined;
  startPage: (id: number) => void;
  stopPage: (id: number) => void;
  onChange: (state: LocalProbeState) => void;
  record: (type: string, payload: unknown) => void;
}
export const idleLocalProbe = (): LocalProbeState => ({ id: 0, kind: null, status: 'idle', message: '尚未开始单机定位' });

// These probes never join the SFU, create a PeerConnection or play microphone audio.
export function createLocalAudioProbe(ports: Ports) {
  let sequence = 0, disposed = false;
  let current: { id: number; kind: LocalProbeKind } | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function clearDeadline() { if (deadline) clearTimeout(deadline); deadline = undefined; }
  function update(state: LocalProbeState) {
    ports.record('LOCAL_PROBE', state);
    if (!disposed) ports.onChange(state);
  }
  function release() {
    clearDeadline();
    const old = current; current = null;
    if (!old) return;
    if (old.kind === 'same-page-mic') ports.stopPage(old.id);
    else void ports.releaseNative()?.catch(() => {});
  }
  function fail(id: number, message: string) {
    if (current?.id !== id) return;
    const kind = current.kind; release();
    update({ id, kind, status: 'error', message });
  }
  return {
    async start(kind: LocalProbeKind) {
      if (disposed || current) return;
      const video = ports.getVideo(), id = ++sequence;
      if (!video.value || Date.now() - video.at > 1500 || video.value.paused || video.value.ended ||
          video.value.muted || video.value.volume <= 0 || video.value.readyState < 2) {
        update({ id, kind, status: 'error', message: '先播放有声 MP4，再开始单机定位' }); return;
      }
      current = { id, kind };
      ports.record('LOCAL_PROBE_BASELINE', { id, kind, video: video.value });
      update({ id, kind, status: 'starting', message: kind === 'native-session' ? '正在切换原生音频会话（不开麦）' : '正在视频页申请麦克风（不连服务器）' });
      deadline = setTimeout(() => fail(id, '单机定位启动超时，已取消并释放资源'), 15000);
      if (kind === 'same-page-mic') { ports.startPage(id); return; }
      try {
        const state = await ports.activateNative();
        if (current?.id !== id) return; // stop already queued native deactivation; do not release a newer call.
        if (!state) { fail(id, '当前安装包缺少原生音频模块，此项不能验证'); return; }
        if (state.interrupted) { fail(id, '原生音频会话处于中断状态，此项不能验证'); return; }
        clearDeadline(); ports.record('LOCAL_PROBE_NATIVE_SESSION', { id, state });
        update({ id, kind, status: 'active', message: '原生会话已切换，未采集麦克风；观察视频是否暂停，再点停止' });
      } catch {
        fail(id, '原生音频会话初始化失败，此项不能验证');
      }
    },
    handlePageMessage(payload: unknown) {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as { id?: number; state?: string; error?: string };
      if (current?.kind !== 'same-page-mic' || current.id !== p.id) return;
      if (p.state === 'active') {
        clearDeadline();
        update({ id: current.id, kind: current.kind, status: 'active', message: '视频页麦克风已开启；观察视频是否暂停，再点停止。此项没有语音输出' });
      } else if (p.state === 'error') {
        fail(current.id, `视频页麦克风失败：${typeof p.error === 'string' ? p.error.slice(0, 80) : '未知错误'}`);
      }
    },
    stop() { release(); update(idleLocalProbe()); },
    dispose() { disposed = true; release(); },
  };
}
