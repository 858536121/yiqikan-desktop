import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { SiteRuleClient, SITE_RULES_ENABLED, SITE_RULE_TRUSTED_KEYS, createSiteRulePageScript, fetchSiteRuleText, bundledSiteRuleSnapshot, privatePlaybackPage, publicPlaybackUrl } from '@yiqikan/shared/site-rules';
import { resolveWebUrl } from './environment';

const listeners = new Set<() => void>();
const storageKey = '@yiqikan/site-rules/engine-1';
// Remote delivery stays disabled until a reviewed release provisions its public key.
// Packaged JSON rules still run through the same finite engine.
// No new native dependencies; verification uses the shared pure-JS verifier.
const client = new SiteRuleClient({
  enabled: SITE_RULES_ENABLED && (Platform.OS === 'ios' || Platform.OS === 'android'),
  trustedKeys: SITE_RULE_TRUSTED_KEYS,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  clientVersion: Constants.nativeAppVersion || Constants.expoConfig?.version || '0.0.0',
  storage: {
    getItem: () => AsyncStorage.getItem(storageKey),
    setItem: value => AsyncStorage.setItem(storageKey, value),
  },
  fetchText: async () => {
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 8000);
    try { return await fetchSiteRuleText(`${resolveWebUrl()}/api/site-rules/manifest`, abort.signal); }
    finally { clearTimeout(timeout); }
  },
  onChange: () => { for (const listener of listeners) listener(); },
});

const pageSnapshot = () => SITE_RULES_ENABLED ? client.snapshot() : bundledSiteRuleSnapshot(
  Platform.OS === 'ios' ? 'ios' : 'android', Constants.expoConfig?.version || Constants.nativeAppVersion || '0.0.0');
export const siteRuleService = {
  async start() { await client.initialize(); void client.refresh(); },
  refresh: () => client.refresh(),
  pageScript: () => createSiteRulePageScript(pageSnapshot()),
  privatePlaybackPage: (url: string) => privatePlaybackPage(pageSnapshot(), url),
  publicPlaybackUrl: (url: string, candidate: unknown) => publicPlaybackUrl(pageSnapshot(), url, candidate),
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
