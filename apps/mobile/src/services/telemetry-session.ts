// Count observed playback only: gaps, seeks and background time are excluded.
export class TelemetrySession {
  foregroundSeconds = 0;
  playingSeconds = 0;
  pauseCount = 0;
  failureCount = 0;
  reconnectCount = 0;
  private foregroundAt: number | null = null;
  private sample: { at: number; position: number; paused: boolean } | null = null;
  foreground(active: boolean, now: number) {
    this.collectForeground(now);
    this.foregroundAt = active ? now : null;
    this.sample = null;
  }
  collectForeground(now: number) {
    if (this.foregroundAt !== null) {
      this.foregroundSeconds += Math.max(0, Math.min(600, (now - this.foregroundAt) / 1000));
      this.foregroundAt = now;
    }
  }
  playback(position: number, paused: boolean, now: number): boolean {
    if (this.foregroundAt === null || !Number.isFinite(position)) { this.sample = null; return false; }
    const previous = this.sample;
    this.sample = { at: now, position, paused };
    if (!previous) return false;
    if (!previous.paused && paused) this.pauseCount++;
    const elapsed = (now - previous.at) / 1000;
    const progress = position - previous.position;
    const playing = !paused && !previous.paused && elapsed > 0 && elapsed <= 5 && progress > 0 && progress <= elapsed * 4 + 1;
    if (playing) this.playingSeconds += elapsed;
    return playing;
  }
  resetPlayback() { this.sample = null; }
  drain(now: number) {
    this.collectForeground(now);
    const result = { foregroundSeconds: Math.floor(this.foregroundSeconds), playingSeconds: Math.floor(this.playingSeconds),
      pauseCount: this.pauseCount, failureCount: this.failureCount, reconnectCount: this.reconnectCount };
    this.foregroundSeconds = this.playingSeconds = this.pauseCount = this.failureCount = this.reconnectCount = 0;
    return result;
  }
}
