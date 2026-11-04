import type { PlaybackClockReply, PlayerEventPayload } from '@yiqikan/shared';

// Executor metadata stays local; clock probes use optional directed reply fields.
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

export function playbackMonotonicNow(fallback = Date.now()): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : fallback;
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
  private probeSequence = 0;
  private probes = new Map<string, { wall: number; mono: number }>();
  private clockSamples: { offset: number; delay: number; at: number }[] = [];
  private clockEstimate: { offset: number; delay: number; at: number } | null = null;
  private localClock: { wall: number; mono: number } | null = null;

  reset(context = '') {
    this.context = context;
    this.timestamp = 0;
    this.sequences.clear();
    this.epochSequence = 0;
    this.minimumClockDifference = null;
    this.lastPosition = null;
    this.lastProgressAt = 0;
    this.probes.clear();
    this.clockSamples = [];
    this.clockEstimate = null;
    this.localClock = null;
  }

  setContext(context: string) {
    if (context === this.context) return false;
    this.reset(context);
    return true;
  }

  private observeLocalClock(wall: number, mono: number) {
    const previous = this.localClock;
    // Background suspension, a wall-clock adjustment or a monotonic reset must
    // not reuse pending probes or the historical fastest-path baseline.
    if (previous && (mono < previous.mono || mono - previous.mono > 10000
      || Math.abs(wall - previous.wall - (mono - previous.mono)) > 100)) this.reset(this.context);
    this.localClock = { wall, mono };
    if (this.clockEstimate && mono - this.clockEstimate.at > 30000) {
      this.clockEstimate = null;
      // Retain the legacy baseline while dropping precision. Relearning it on
      // a slow path would suddenly subtract that whole path from the target.
    }
  }

  beginClockProbe(now = Date.now(), mono?: number): string | undefined {
    if (mono === undefined) {
      if (typeof performance === 'undefined' || typeof performance.now !== 'function') return undefined;
      mono = performance.now();
    }
    this.observeLocalClock(now, mono);
    for (const [id, probe] of this.probes) if (mono - probe.mono > 3000) this.probes.delete(id);
    // The counter deliberately survives reset, so a previous host/connection's
    // delayed response cannot match a new request made in the same millisecond.
    const id = `${now.toString(36)}:${++this.probeSequence}`;
    this.probes.set(id, { wall: now, mono });
    if (this.probes.size > 4) this.probes.delete(this.probes.keys().next().value!);
    return id;
  }

  private measureClock(reply: PlaybackClockReply | undefined, now: number, mono: number) {
    if (!reply || typeof reply.id !== 'string') return;
    const probe = this.probes.get(reply.id);
    if (!probe) return;
    this.probes.delete(reply.id); // Each request may contribute at most one observation.
    const { receivedAt, sentAt, elapsedMs } = reply;
    const roundTrip = mono - probe.mono;
    if (![receivedAt, sentAt, elapsedMs].every(value => typeof value === 'number' && Number.isFinite(value))
      || receivedAt < 1e12 || sentAt < receivedAt || elapsedMs < 0 || roundTrip < 0 || roundTrip > 3000
      || Math.abs(now - probe.wall - roundTrip) > 20
      || Math.abs(sentAt - receivedAt - elapsedMs) > 20) return;
    // Four timestamps, with host processing removed from the round trip.
    // Symmetric paths give an exact estimate; path asymmetry remains bounded
    // by half the measured network round trip, not by timestamp precision.
    const delay = roundTrip - elapsedMs;
    if (delay < -2 || delay > 500) return;
    const sample = { offset: ((receivedAt - probe.wall) + (sentAt - now)) / 2,
      delay: Math.max(0, delay), at: mono };
    this.clockSamples = [...this.clockSamples.filter(value => mono - value.at <= 30000), sample].slice(-8);
    const recent = this.clockSamples.slice(-3);
    if (recent.length < 3) return;
    // Three independent, compatible exchanges are required, including after a
    // host clock jump. A single fast asymmetric packet cannot redefine time.
    const low = Math.max(...recent.map(value => value.offset - value.delay / 2 - 10));
    const high = Math.min(...recent.map(value => value.offset + value.delay / 2 + 10));
    if (low > high) return;
    const candidates = this.clockSamples.filter(value => value.offset + value.delay / 2 + 10 >= low
      && value.offset - value.delay / 2 - 10 <= high);
    const best = candidates.reduce((a, b) => b.delay <= a.delay ? b : a);
    const previous = this.clockEstimate;
    this.clockEstimate = best;
    const clockStepped = previous
      ? Math.abs(previous.offset - best.offset) > 100 + (previous.delay + best.delay) / 2
      : this.timestamp > now + best.offset + best.delay / 2 + 100;
    if (clockStepped) {
      // A confirmed host wall-clock change must not lock out all subsequent
      // samples through the old timestamp ordering watermark.
      this.timestamp = 0;
      this.sequences.clear();
      this.epochSequence = 0;
      this.minimumClockDifference = null;
      this.lastPosition = null;
      this.lastProgressAt = 0;
    }
  }

  accept(payload: PlayerEventPayload, source: 'event' | 'response', now = Date.now(),
    mono = playbackMonotonicNow(now), clockReply?: PlaybackClockReply): MobilePlayerEvent | null {
    if (payload.currentTime !== undefined && (!Number.isFinite(payload.currentTime) || payload.currentTime < 0)) return null;
    if (payload.playbackRate !== undefined && (!Number.isFinite(payload.playbackRate) || payload.playbackRate <= 0)) return null;
    this.observeLocalClock(now, mono);
    // Timing-capable replies belong to an exact outstanding request/context.
    // Ignoring only the timing would still let an old host's position through.
    if (source === 'response' && clockReply
      && (typeof clockReply.id !== 'string' || !this.probes.has(clockReply.id))) return null;
    if (source === 'response') this.measureClock(clockReply, now, mono);
    const timestamp = wireTimestampMs(payload.localTimestamp);
    const sequence = typeof payload.syncId === 'number' && Number.isFinite(payload.syncId) ? payload.syncId : 0;
    // New mobile hosts use a shared epoch-based sequence for both streams.
    // Legacy event counters stay separate from their timestamp-based responses.
    const previousSequence = Math.max(this.sequences.get(source) ?? 0, sequence > 1e12 ? this.epochSequence : 0);
    if (timestamp && timestamp < this.timestamp) return null;
    if ((!timestamp || timestamp === this.timestamp) && sequence > 0 && sequence <= previousSequence) return null;
    // Until direct clock measurement is established, preserve legacy fastest-
    // path compensation. Once calibrated, include baseline one-way latency too.
    let extraDelay = 0;
    if (timestamp) {
      const difference = now - timestamp;
      const minimumDifference = Math.min(this.minimumClockDifference ?? difference, difference);
      extraDelay = this.clockEstimate ? difference + this.clockEstimate.offset : difference - minimumDifference;
      if (this.clockEstimate && extraDelay < -this.clockEstimate.delay / 2 - 20) return null;
      extraDelay = Math.max(0, extraDelay);
      if (extraDelay > 3000) return null; // An old delayed sample must not provoke a seek.
      this.minimumClockDifference = minimumDifference;
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
