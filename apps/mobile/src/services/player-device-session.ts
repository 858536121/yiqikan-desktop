export type DeviceSetting = 'brightness' | 'volume';
export interface PlayerDeviceState {
  brightness: number; volume: number; canBrightness: boolean; canVolume: boolean; route: string; active: boolean;
  // New iOS binaries order events and promise replies on the native main queue.
  revision?: number;
}
export interface PlayerDeviceBridge {
  begin(token: number): Promise<PlayerDeviceState>;
  read(token: number): Promise<PlayerDeviceState>;
  setBrightness(token: number, value: number): Promise<PlayerDeviceState>;
  setVolume(token: number, value: number, route: string): Promise<PlayerDeviceState>;
  end(token: number): void;
}

let sequence = Date.now();

// Only the newest value is retained while the native bridge is busy. Session
// tokens also protect the native side from commands arriving after cleanup.
export class PlayerDeviceSession {
  readonly token = ++sequence;
  private alive = true;
  private ready = false;
  private writing = false;
  private reading = false;
  private writeRevision = 0;
  private pending: Partial<Record<DeviceSetting, { value: number; route: string }>> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: PlayerDeviceState | null = null;
  constructor(private bridge: PlayerDeviceBridge, private receive: (state: PlayerDeviceState | null) => void,
    private failed: (setting: DeviceSetting) => void) {}

  async start() {
    try {
      const state = await this.bridge.begin(this.token);
      if (!this.alive) return;
      this.ready = true; this.accept(state);
    } catch { if (this.alive) this.receive(null); }
  }
  private accept(state: PlayerDeviceState) {
    if (!this.alive) return;
    if (state.revision !== undefined && this.state?.revision !== undefined && state.revision <= this.state.revision) return;
    if (this.state && state.route !== this.state.route) delete this.pending.volume;
    this.state = state;
    this.receive(state);
  }
  observe(token: number, state: PlayerDeviceState) {
    if (!this.alive || token !== this.token) return;
    // Events can arrive before begin's promise reply, or while a write is busy.
    // Their native revision keeps older replies from rolling the UI back.
    this.accept(state);
  }
  async poll() {
    const ordered = this.state?.revision !== undefined;
    if (!this.alive || !this.ready || this.reading || (!ordered && (this.writing || Object.keys(this.pending).length))) return;
    this.reading = true;
    const revision = this.writeRevision;
    try {
      const state = await this.bridge.read(this.token);
      if (ordered || (revision === this.writeRevision && !this.writing && !Object.keys(this.pending).length)) this.accept(state);
    }
    catch { if (this.alive) { this.ready = false; this.receive(null); } }
    finally { this.reading = false; }
  }
  set(setting: DeviceSetting, value: number) {
    if (!this.alive || !this.ready || !Number.isFinite(value) || !this.state?.[setting === 'brightness' ? 'canBrightness' : 'canVolume']) return;
    this.writeRevision++;
    this.pending[setting] = { value: Math.max(setting === 'brightness' ? .05 : 0, Math.min(1, value)), route: this.state.route };
    if (!this.timer && !this.writing) this.timer = setTimeout(() => { this.timer = null; void this.drain(); }, 40);
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.drain();
  }
  private async drain() {
    if (!this.alive || !this.ready || this.writing) return;
    this.writing = true;
    try {
      while (this.alive && Object.keys(this.pending).length) {
        const setting = Object.keys(this.pending)[0] as DeviceSetting, { value, route } = this.pending[setting]!;
        delete this.pending[setting];
        try {
          this.accept(await (setting === 'brightness' ? this.bridge.setBrightness(this.token, value) : this.bridge.setVolume(this.token, value, route)));
        } catch {
          if (this.alive) {
            if (setting === 'volume' && route !== this.state?.route) continue;
            delete this.pending[setting];
            if (this.state) {
              // Local failure does not advance the native snapshot revision.
              this.state = { ...this.state, [setting === 'brightness' ? 'canBrightness' : 'canVolume']: false };
              this.receive(this.state);
            }
            this.failed(setting);
          }
        }
      }
    } finally { this.writing = false; }
  }
  end() {
    if (!this.alive) return;
    this.alive = false; this.ready = false; this.pending = {};
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.bridge.end(this.token);
  }
}
