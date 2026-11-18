import { useEffect, useState } from 'react';

type Scrub = { context: string; anchor: number; preview: number; origin: number; pending: boolean; surface?: boolean };

export function usePlaybackScrub({ currentTime, duration, enabled, mediaKey = '', onSeek }: {
  currentTime: number; duration: number; enabled: boolean; mediaKey?: string; onSeek: (time: number) => void;
}) {
  const canSeek = enabled && Number.isFinite(duration) && duration > 0;
  const clamp = (value: number) => Math.max(0, Math.min(Number.isFinite(duration) && duration > 0 ? duration : 0, Number.isFinite(value) ? value : 0));
  const context = JSON.stringify([mediaKey, canSeek, duration]);
  const [state, setState] = useState<Scrub | null>(null);
  const [seekFailed, setSeekFailed] = useState(false);
  const scrub = state?.context === context ? state : null;

  useEffect(() => {
    if (!state) return;
    if (state.context !== context) { setState(null); setSeekFailed(false); return; }
    if (state.pending && Math.abs(currentTime - state.preview) <= 1
      && (currentTime !== state.origin || Math.abs(state.preview - state.origin) < 0.05)) setState(null);
  }, [context, currentTime, state]);

  useEffect(() => {
    if (!scrub?.pending) return;
    // If a source rejects the seek, eventually display its actual position.
    const timer = setTimeout(() => { setState(value => value === scrub ? null : value); setSeekFailed(true); }, 10000);
    return () => clearTimeout(timer);
  }, [scrub]);

  return {
    canSeek,
    isScrubbing: Boolean(scrub && !scrub.pending),
    isSeeking: Boolean(scrub?.pending),
    seekFailed,
    dismissSeekFailure() { setSeekFailed(false); },
    maximumValue: Number.isFinite(duration) && duration > 0 ? duration : 1,
    displayTime: scrub?.preview ?? currentTime,
    // Native Slider owns the thumb during a gesture. Feeding every JS preview
    // back into its write-only value can move it behind the user's finger.
    sliderValue: scrub ? scrub.pending || scrub.surface ? scrub.preview : scrub.anchor : clamp(currentTime),
    cancel() { setState(null); setSeekFailed(false); },
    beginSurface() {
      if (canSeek) {
        setSeekFailed(false);
        const value = scrub?.preview ?? clamp(currentTime);
        setState({ context, anchor: value, preview: value, origin: currentTime, pending: false, surface: true });
      }
    },
    previewSurface(value: number) {
      if (!canSeek) return;
      setState(previous => previous?.context === context && previous.surface && !previous.pending
        ? { ...previous, preview: clamp(value) } : previous);
    },
    onSlidingStart(value: number) {
      setSeekFailed(false);
      if (canSeek) setState({ context, anchor: clamp(value), preview: clamp(value), origin: currentTime, pending: false });
    },
    onValueChange(value: number) {
      if (!canSeek) return;
      setState(previous => ({ context, anchor: previous?.context === context && !previous.pending ? previous.anchor : clamp(currentTime),
        preview: clamp(value), origin: currentTime, pending: false }));
    },
    onSlidingComplete(value: number, commit: (time: number) => void = onSeek) {
      if (!canSeek) return;
      setSeekFailed(false);
      const target = clamp(value);
      setState({ context, anchor: target, preview: target, origin: currentTime, pending: true });
      commit(target);
    },
  };
}
