import { SiteRuleClient, fetchSiteRuleText } from '../../packages/shared/src/site-rules/client';
import { bundledSiteRuleSnapshot } from '../../packages/shared/src/site-rules/playback-page';
import { SITE_RULES_ENABLED, SITE_RULE_TRUSTED_KEYS } from '../../packages/shared/src/site-rules/trust';

// IndexedDB needs no additional extension permission. One record is atomically
// replaced only after the complete signed release has passed validation.
async function storage(write?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('yiqikan-site-rules', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('snapshots', write === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('snapshots');
      const request = write === undefined ? store.get('engine-1') : store.put(write, 'engine-1');
      tx.oncomplete = () => { db.close(); resolve(write === undefined && typeof request.result === 'string' ? request.result : null); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
declare const chrome: { runtime: { getManifest(): { version: string } } };
const client = new SiteRuleClient({
  enabled: SITE_RULES_ENABLED,
  trustedKeys: SITE_RULE_TRUSTED_KEYS,
  platform: 'extension',
  clientVersion: chrome.runtime.getManifest().version,
  storage: { getItem: () => storage(), setItem: async value => { await storage(value); } },
  fetchText: async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    try { return await fetchSiteRuleText('https://yiqikan.club/api/site-rules/manifest', controller.signal); }
    finally { clearTimeout(timer); }
  },
});
Object.assign(globalThis, { __yiqikanSiteRuleLoader: {
  async snapshot() {
    await client.initialize();
    // Respond from cache first. New downloads apply to later documents only.
    void client.refresh();
    return SITE_RULES_ENABLED ? client.snapshot() : bundledSiteRuleSnapshot('extension', chrome.runtime.getManifest().version);
  },
} });
