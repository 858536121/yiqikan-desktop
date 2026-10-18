import { useEffect, useState } from 'react';

type Scrub = { context: string; anchor: number; preview: number; origin: number; pending: boolean };

export function usePlaybackScrub({ currentTime, duration, enabled, mediaKey = '', onSeek }: {
  currentTime: number; duration: number; enabled: boolean; mediaKey?: string; onSeek: (time: number) => void;
}) {
  const canSeek = enabled && Number.isFinite(duration) && duration > 0;
  const clamp = (value: number) => Math.max(0, Math.min(Number.isFinite(duration) && duration > 0 ? duration : 0, Number.isFinite(value) ? value : 0));
  const context = JSON.stringify([mediaKey, canSeek, duration]);
  const [state, setState] = useState<Scrub | null>(null);
  const scrub = state?.context === context ? state : null;

  useEffect(() => {
    if (!state) return;
    if (state.context !== context) { setState(null); return; }
    if (state.pending && Math.abs(currentTime - state.preview) <= 1
      && (currentTime !== state.origin || Math.abs(state.preview - state.origin) < 0.05)) setState(null);
  }, [context, currentTime, state]);

  useEffect(() => {
    if (!scrub?.pending) return;
    // If a source rejects the seek, eventually display its actual position.
    const timer = setTimeout(() => setState(value => value === scrub ? null : value), 10000);
    return () => clearTimeout(timer);
  }, [scrub]);

  return {
    canSeek,
    maximumValue: Number.isFinite(duration) && duration > 0 ? duration : 1,
    displayTime: scrub?.preview ?? currentTime,
    // Native Slider owns the thumb during a gesture. Feeding every JS preview
    // back into its write-only value can move it behind the user's finger.
    sliderValue: scrub ? scrub.pending ? scrub.preview : scrub.anchor : clamp(currentTime),
    onSlidingStart(value: number) {
      if (canSeek) setState({ context, anchor: clamp(value), preview: clamp(value), origin: currentTime, pending: false });
    },
    onValueChange(value: number) {
      if (!canSeek) return;
      setState(previous => ({ context, anchor: previous?.context === context && !previous.pending ? previous.anchor : clamp(currentTime),
        preview: clamp(value), origin: currentTime, pending: false }));
    },
    onSlidingComplete(value: number) {
      if (!canSeek) return;
      const target = clamp(value);
      setState({ context, anchor: target, preview: target, origin: currentTime, pending: true });
      onSeek(target);
    },
  };
}
