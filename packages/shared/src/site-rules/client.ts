import { SITE_RULE_MAX_AGE_MS, SITE_RULE_MAX_BYTES, type SiteRulePlatform, type SiteRuleSnapshot } from './schema';
import { verifySiteRuleRelease, type VerifiedSiteRuleRelease } from './signature';

export interface SiteRuleClientOptions {
  enabled: boolean;
  trustedKeys: Readonly<Record<string, string>>;
  platform: SiteRulePlatform;
  clientVersion: string;
  storage: { getItem(): Promise<string | null>; setItem(value: string): Promise<void> };
  fetchText(): Promise<string | null>;
  now?: () => number;
  onChange?: () => void;
}
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL = 60 * 1000;
export class SiteRuleClient {
  private current: VerifiedSiteRuleRelease | null = null;
  private initialized: Promise<void> | null = null;
  private checking: Promise<void> | null = null;
  private nextCheck = 0;
  private now: () => number;
  constructor(private options: SiteRuleClientOptions) { this.now = options.now ?? Date.now; }
  private usable(value: VerifiedSiteRuleRelease): boolean {
    const { issuedAt, expiresAt } = value.release, now = this.now();
    return issuedAt <= now + 5 * 60 * 1000 && expiresAt > now && expiresAt - issuedAt <= SITE_RULE_MAX_AGE_MS;
  }
  initialize(): Promise<void> {
    if (!this.options.enabled) return Promise.resolve();
    if (!this.initialized) this.initialized = (async () => {
      try {
        const raw = await this.options.storage.getItem();
        const value = raw ? verifySiteRuleRelease(raw, this.options.trustedKeys) : null;
        // Retain expired, authentic sequence as a replay floor, never execute it.
        if (value) { this.current = value; this.changed(); }
      } catch { /* Storage failure must not block the player. */ }
    })();
    return this.initialized;
  }
  snapshot(): SiteRuleSnapshot | null {
    if (!this.options.enabled || !this.current || !this.usable(this.current) || !this.current.release.enabled) return null;
    // No caller may mutate the verifier's cached state or monotonic sequence.
    return { platform: this.options.platform, clientVersion: this.options.clientVersion, release: JSON.parse(JSON.stringify(this.current.release)) };
  }
  private changed(): void { try { this.options.onChange?.(); } catch { /* Observer isolation. */ } }
  refresh(): Promise<void> {
    if (!this.options.enabled) return Promise.resolve();
    if (this.checking) return this.checking;
    this.checking = (async () => {
      await this.initialize();
      if (this.now() < this.nextCheck) return;
      this.nextCheck = this.now() + RETRY_INTERVAL;
      try {
        const raw = await this.options.fetchText();
        if (!raw) return;
        const value = verifySiteRuleRelease(raw, this.options.trustedKeys);
        if (!value || !this.usable(value)) return;
        if (this.current && (value.release.sequence < this.current.release.sequence
          || (value.release.sequence === this.current.release.sequence && value.envelope.payload !== this.current.envelope.payload))) return;
        if (value.envelope.payload === this.current?.envelope.payload) { this.nextCheck = this.now() + CHECK_INTERVAL; return; }
        // Atomic persistence before activation. Failure retains the previous snapshot.
        await this.options.storage.setItem(raw);
        this.current = value;
        this.nextCheck = this.now() + CHECK_INTERVAL;
        this.changed();
      } catch { /* Network, validation and persistence failures retain the old snapshot. */ }
    })().finally(() => { this.checking = null; });
    return this.checking;
  }
}

// One bounded request to a configured official endpoint. No page URL or user
// browsing data is sent. Disallow redirects, including a trusted URL redirecting
// to a private host. Adapters must supply their own timeout/abort signal.
export async function fetchSiteRuleText(url: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(url, { signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
  if (!response.ok) return null;
  const length = Number(response.headers.get('content-length'));
  if (length > SITE_RULE_MAX_BYTES) return null;
  if (!response.body?.getReader) {
    // RN fetch cannot bound a streaming response. The official endpoint provides
    // Content-Length; abstain if absent rather than reading an unknown-size body.
    if (!Number.isSafeInteger(length) || length < 1) return null;
    const text = await response.text();
    return text.length <= SITE_RULE_MAX_BYTES ? text : null;
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SITE_RULE_MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    // Only browser/Node streaming fetch reaches this path. RN uses text().
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { reader.releaseLock(); }
}
