import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { SiteRuleClient, SITE_RULES_ENABLED, SITE_RULE_TRUSTED_KEYS, createSiteRulePageScript, fetchSiteRuleText } from '@yiqikan/shared/site-rules';
import { resolveWebUrl } from './environment';

const listeners = new Set<() => void>();
const storageKey = '@yiqikan/site-rules/engine-1';
// Engine disabled until the first reviewed release provisions its public key.
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

export const siteRuleService = {
  async start() { await client.initialize(); void client.refresh(); },
  refresh: () => client.refresh(),
  pageScript: () => SITE_RULES_ENABLED ? createSiteRulePageScript(client.snapshot()) : '',
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
