import type { PlaybackClockReply } from './index';

export interface PlaybackClockReading {
  wallMs: number;
  monotonicMs: number;
}

// A missing monotonic clock disables the optional measurement, not playback.
export function readPlaybackClock(): PlaybackClockReading | undefined {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') return undefined;
  return { wallMs: Date.now(), monotonicMs: performance.now() };
}

export function playbackClockReply(
  id: unknown,
  received: PlaybackClockReading | undefined,
  sent = readPlaybackClock(),
): PlaybackClockReply | undefined {
  if (typeof id !== 'string' || !id.length || id.length > 96 || !received || !sent) return undefined;
  if (![received.wallMs, received.monotonicMs, sent.wallMs, sent.monotonicMs].every(Number.isFinite)) return undefined;
  const elapsedMs = sent.monotonicMs - received.monotonicMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 3000
    || Math.abs(sent.wallMs - received.wallMs - elapsedMs) > 20) return undefined;
  return { id, receivedAt: received.wallMs, sentAt: sent.wallMs, elapsedMs };
}
