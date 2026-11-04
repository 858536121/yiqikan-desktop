export const TELEMETRY_CONSENT_KEY = '@yiqikan_telemetry_consent';

/** Wait for the saved preference; unset preferences enable statistics by default. A newer choice wins. */
export class TelemetryConsent {
  enabled = false;
  revision = 0;
  private loading: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
  }) {}

  load() {
    if (!this.loading) {
      const revision = this.revision;
      this.loading = this.storage.getItem(TELEMETRY_CONSENT_KEY).then(value => {
        if (this.revision === revision) this.enabled = value === null || value === 'true';
      }).catch(() => { /* Storage failures keep the default denial. */ });
    }
    return this.loading;
  }

  async set(enabled: boolean) {
    this.enabled = false;
    const revision = ++this.revision;
    const write = this.writing.catch(() => {}).then(() => this.storage.setItem(TELEMETRY_CONSENT_KEY, String(enabled)));
    this.writing = write;
    await write;
    if (this.revision === revision) this.enabled = enabled;
  }

  permits(revision: number) {
    return this.enabled && this.revision === revision;
  }
}
