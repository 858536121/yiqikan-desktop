import type { PlayerEventPayload } from '@yiqikan/shared';

// Metadata is local to the mobile client; the existing wire protocol is unchanged.
export interface MobilePlayerEvent extends PlayerEventPayload {
  receivedAt?: number;
  sampledAt?: number;
  forceSync?: boolean;
}

export interface RealtimePlayback {
  currentTime: number;
  paused: boolean;
  playbackRate: number;
  duration?: number;
  sampledAt?: number;
}

export function wireTimestampMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // Web publishes seconds; older mobile responses published milliseconds.
  if (value > 1e12) return value;
  if (value > 1e9) return value * 1000;
  return null;
}

export function mobileSyncCommand(event: MobilePlayerEvent) {
  const action = event.action;
  return {
    ...(typeof event.currentTime === 'number' && action !== 'rate_change' ? { currentTime: event.currentTime } : {}),
    ...(action === 'play' ? { paused: false } : action === 'pause' ? { paused: true }
      : typeof event.paused === 'boolean' ? { paused: event.paused } : {}),
    ...(typeof event.playbackRate === 'number' ? { playbackRate: event.playbackRate } : {}),
    ...(event.forceSync || action === 'seek' || action === 'play' || action === 'pause'
      ? { controlId: `${action}:${event.syncId ?? event.receivedAt ?? event.sampledAt ?? Date.now()}` } : {}),
    remote: true,
    sampledAt: event.sampledAt ?? event.receivedAt ?? Date.now(),
    force: Boolean(event.forceSync || action === 'seek' || action === 'play' || action === 'pause'),
    allowRetry: Boolean(event.forceSync),
  };
}

export class MobileSyncReceiver {
  private context = '';
  private timestamp = 0;
  private sequences = new Map<string, number>();
  private epochSequence = 0;
  private minimumClockDifference: number | null = null;
  private lastPosition: number | null = null;
  private lastProgressAt = 0;

  reset(context = '') {
    this.context = context;
    this.timestamp = 0;
    this.sequences.clear();
    this.epochSequence = 0;
    this.minimumClockDifference = null;
    this.lastPosition = null;
    this.lastProgressAt = 0;
  }

  setContext(context: string) {
    if (context === this.context) return false;
    this.reset(context);
    return true;
  }

  accept(payload: PlayerEventPayload, source: 'event' | 'response', now = Date.now()): MobilePlayerEvent | null {
    if (payload.currentTime !== undefined && (!Number.isFinite(payload.currentTime) || payload.currentTime < 0)) return null;
    if (payload.playbackRate !== undefined && (!Number.isFinite(payload.playbackRate) || payload.playbackRate <= 0)) return null;
    const timestamp = wireTimestampMs(payload.localTimestamp);
    const sequence = typeof payload.syncId === 'number' && Number.isFinite(payload.syncId) ? payload.syncId : 0;
    // New mobile hosts use a shared epoch-based sequence for both streams.
    // Legacy event counters stay separate from their timestamp-based responses.
    const previousSequence = Math.max(this.sequences.get(source) ?? 0, sequence > 1e12 ? this.epochSequence : 0);
    if (timestamp && timestamp < this.timestamp) return null;
    if ((!timestamp || timestamp === this.timestamp) && sequence > 0 && sequence <= previousSequence) return null;
    // Estimate excess transit delay relative to the fastest observed sample.
    // This tolerates different device wall clocks without adding their clock skew
    // to video time. The unavoidable minimum one-way latency remains uncompensated.
    let extraDelay = 0;
    if (timestamp) {
      const difference = now - timestamp;
      this.minimumClockDifference = Math.min(this.minimumClockDifference ?? difference, difference);
      extraDelay = difference - this.minimumClockDifference;
      if (extraDelay > 3000) return null; // An old delayed sample must not provoke a seek.
    }
    if (timestamp) this.timestamp = timestamp;
    if (sequence > 0) this.sequences.set(source, sequence);
    if (sequence > 1e12) this.epochSequence = Math.max(this.epochSequence, sequence);
    // Adapters and legacy hosts may report paused=false while their media clock
    // is stalled. Require fresh, repeated observations before treating it as held.
    let held = false;
    if (typeof payload.currentTime === 'number') {
      const explicit = payload.action !== 'video_sync';
      if (this.lastPosition === null || Math.abs(payload.currentTime - this.lastPosition) > 0.05 || payload.paused || explicit) {
        this.lastProgressAt = now;
      } else if (now - this.lastProgressAt >= 2000) held = true;
      this.lastPosition = payload.currentTime;
    }
    return { ...payload, ...(held ? { paused: true } : {}), receivedAt: now, sampledAt: now - extraDelay };
  }
}
