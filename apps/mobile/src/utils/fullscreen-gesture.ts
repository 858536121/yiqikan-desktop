export type GestureAxis = 'seek' | 'brightness' | 'volume';
export type SeekRange = { start: number; end: number };
export type PlayerControl = { key: string; ready: boolean; ranges: SeekRange[] };
export function readPlayerControl(value: unknown): PlayerControl | null {
  if (!value || typeof value !== 'object') return null;
  const control = value as PlayerControl;
  if (typeof control.key !== 'string' || control.key.length > 180 || !Array.isArray(control.ranges)) return null;
  return { key: control.key, ready: control.ready === true,
    ranges: control.ranges.slice(0, 32).filter(range => range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end > range.start) };
}
export const GESTURE_SLOP = 12;

export function gestureAxis(dx: number, dy: number, startX: number, width: number): GestureAxis | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < GESTURE_SLOP) return null;
  if (Math.abs(dx) > Math.abs(dy) * 1.3) return 'seek';
  if (Math.abs(dy) > Math.abs(dx) * 1.3) return startX < width / 2 ? 'brightness' : 'volume';
  return null;
}

export function gestureDelta(value: number) {
  return Math.sign(value) * Math.max(0, Math.abs(value) - GESTURE_SLOP);
}

export function seekGestureTime(origin: number, dx: number, width: number, duration: number) {
  const span = Math.min(duration, Math.max(30, Math.min(180, duration * 0.1)));
  return Math.max(0, Math.min(duration, origin + gestureDelta(dx) / Math.max(1, width) * span));
}

export function verticalGestureValue(origin: number, dy: number, height: number, minimum: number) {
  return Math.max(minimum, Math.min(1, origin - gestureDelta(dy) / Math.max(1, height * 0.6)));
}

// Do not map an unavailable gap to an unseekable timestamp.
export function clampSeekTime(time: number, ranges: SeekRange[]) {
  let nearest: number | null = null, distance = Infinity;
  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start) continue;
    const candidate = Math.max(range.start, Math.min(range.end, time));
    if (Math.abs(candidate - time) < distance) { nearest = candidate; distance = Math.abs(candidate - time); }
  }
  return nearest;
}

export interface FullscreenGestureConfig {
  context: string; enabled: boolean; width: number; height: number;
  currentTime: number; duration: number; canSeek: boolean; isHost: boolean; ranges: SeekRange[];
  brightness: number | null; volume: number | null;
  beginSeek(): void; previewSeek(value: number): void; commitSeek(value: number): void; cancelSeek(): void;
  setDevice(kind: 'brightness' | 'volume', value: number): void;
  feedback(kind: GestureAxis, value: number, origin: number): void;
  unavailable(kind: GestureAxis): void; activity(active: boolean, kind: GestureAxis): void;
  tap(): void; finishDevice(): void;
}

// Capture origin/context once; consult current permissions/capabilities again
// on every move and release. This also makes cancellation deterministic.
export class FullscreenGesture {
  private drag: { config: FullscreenGestureConfig; x: number; axis: GestureAxis | null; moved: boolean;
    allowed: boolean; target: number; origin: number } | null = null;
  constructor(private latest: () => FullscreenGestureConfig) {}
  start(x: number, touches = 1) {
    this.cancel();
    const config = { ...this.latest() };
    if (!config.enabled || touches !== 1) return;
    this.drag = { config, x, axis: null, moved: false, allowed: false, target: config.currentTime, origin: config.currentTime };
  }
  move(dx: number, dy: number, touches = 1) {
    const drag = this.drag, now = this.latest();
    if (!drag) return;
    if (!now.enabled || now.context !== drag.config.context || touches !== 1) { this.cancel(); return; }
    if (Math.hypot(dx, dy) >= GESTURE_SLOP) drag.moved = true;
    if (!drag.axis) {
      drag.axis = gestureAxis(dx, dy, drag.x, drag.config.width);
      if (!drag.axis) return;
      const kind = drag.axis;
      drag.allowed = kind === 'seek' ? now.canSeek : now[kind] !== null;
      this.latest().activity(true, kind);
      if (!drag.allowed) { now.unavailable(kind); return; }
      drag.origin = kind === 'seek' ? drag.config.currentTime : drag.config[kind]!;
      if (kind === 'seek') now.beginSeek();
    }
    if (!drag.allowed) return;
    if (drag.axis === 'seek') {
      if (!now.canSeek) { this.cancel(); return; }
      const target = clampSeekTime(seekGestureTime(drag.origin, dx, drag.config.width, drag.config.duration), now.ranges);
      if (target === null) { this.cancel(); return; }
      drag.target = target;
      now.previewSeek(target); now.feedback('seek', target, drag.origin);
    } else {
      if (now[drag.axis] === null) { this.cancel(); return; }
      drag.target = verticalGestureValue(drag.origin, dy, drag.config.height, drag.axis === 'brightness' ? .05 : 0);
      now.setDevice(drag.axis, drag.target);
      // The UI can preview this target independently of confirmed device state.
      now.feedback(drag.axis, drag.target, drag.origin);
    }
  }
  end(dx: number, dy: number, touches = 0) {
    if (!this.drag) return;
    if (touches > 0) { this.cancel(); return; }
    // A final move can arrive together with release on a busy JS thread.
    this.move(dx, dy);
    const drag = this.drag, now = this.latest();
    this.drag = null;
    if (!drag) return;
    if (now.enabled && now.context === drag.config.context) {
      if (!drag.moved) now.tap();
      else if (drag.allowed && drag.axis === 'seek') {
        const target = now.canSeek ? clampSeekTime(drag.target, now.ranges) : null;
        if (target !== null && Math.abs(target - drag.origin) >= .1) now.commitSeek(target);
        else now.cancelSeek();
      } else if (drag.allowed && drag.axis) now.finishDevice();
    } else if (drag.axis === 'seek' && drag.allowed) now.cancelSeek();
    if (drag.axis) now.activity(false, drag.axis);
  }
  cancel() {
    const drag = this.drag;
    this.drag = null;
    if (drag?.axis === 'seek' && drag.allowed) this.latest().cancelSeek();
    if (drag?.axis) this.latest().activity(false, drag.axis);
  }
}
