import type { OtaCheckResult } from './ota-service';

export interface NativeUpdateSnapshot {
  startupRunning: boolean;
  checking: boolean;
  downloading: boolean;
  pending: boolean;
  restartCount: number;
  checkedAt?: number;
  manifest?: unknown;
}

export interface AutomaticUpdatePort {
  check(nativeCheck?: { isAvailable: boolean; manifest?: unknown }): Promise<OtaCheckResult | null>;
  download(result: OtaCheckResult): Promise<unknown>;
  reload(): Promise<void>;
  allowed(): boolean;
  safe(): boolean;
  nativeUpgrade(result: OtaCheckResult): void;
  warn(error: unknown): void;
  now(): number;
}

/** One owner for automatic checks. Downloads never block rendering or user input. */
export class AutomaticUpdateCoordinator {
  private native: NativeUpdateSnapshot | null = null;
  private running = false;
  private active = true;
  private interacted = false;
  private busy = false;
  private checked = false;
  private ready = false;
  private approved = false;
  private attempted = false;
  private lastCheck = -Infinity;
  private backgroundAt = 0;

  constructor(private readonly port: AutomaticUpdatePort) {}

  start() { this.running = true; this.pump(); }
  stop() { this.running = false; }
  interaction() { this.interacted = true; }
  updateNative(snapshot: NativeUpdateSnapshot) {
    this.native = snapshot;
    if (snapshot.restartCount > 0 && !this.checked) {
      // The new JS instance is part of the same launch, not another automatic check window.
      this.checked = true;
      this.lastCheck = this.port.now();
    }
    this.pump();
  }
  safetyChanged() { this.pump(); }

  appState(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.backgroundAt = this.port.now();
    else {
      // Only a truly idle home can open a new application window after a long absence.
      if (this.port.now() - this.backgroundAt >= 600_000 && this.port.safe()) this.interacted = false;
      this.pump();
    }
  }

  private pump() {
    const native = this.native;
    if (!this.running || !this.active || !native || native.startupRunning || native.checking || native.downloading || this.busy) return;
    if (!this.checked || this.port.now() - this.lastCheck >= 180_000) {
      void this.check();
      return;
    }
    if (this.approved && (this.ready || native.pending) && this.port.allowed() && !this.interacted && !this.attempted &&
        native.restartCount === 0 && this.port.safe()) {
      // No await between the final safety check and committing to the native reload.
      this.attempted = true;
      void this.port.reload().catch(error => this.port.warn(error));
    }
  }

  private async check() {
    this.busy = true;
    const first = !this.checked;
    this.checked = true;
    this.lastCheck = this.port.now();
    this.approved = false;
    try {
      // Reuse the cold-start native check, including "no update", instead of checking twice.
      const nativeCheck = first && this.native?.checkedAt !== undefined ? {
        isAvailable: Boolean(this.native.manifest), manifest: this.native.manifest,
      } : undefined;
      const result = await this.port.check(nativeCheck);
      if (!result) return;
      if (result.status === 'APP_UPDATE_REQUIRED') {
        if (result.forceAppUpdate && this.running) this.port.nativeUpgrade(result);
        return;
      }
      if (result.status === 'ERROR') return;
      this.approved = true;
      if (result.status === 'OTA_UPDATE_AVAILABLE' && !this.native?.pending) {
        await this.port.download(result);
        this.ready = true;
      }
    } catch (error) { this.port.warn(error); }
    finally { this.busy = false; this.pump(); }
  }
}
