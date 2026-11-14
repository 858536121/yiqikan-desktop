// Web-owned, declarative access policies. No scripts, cookie values or header programs.
export interface WebSiteAccessPolicy {
  id: string;
  name: string;
  hosts: string[];
  pathPrefixes: string[];
  cookieNames: string[];
  retryMode?: 'reload' | 'partitioned-cookie';
  cleanupLegacyAliases?: boolean;
  referrerPolicy: 'no-referrer' | 'strict-origin-when-cross-origin';
}
export interface WebSiteAccessConfig { version: 1; policies: WebSiteAccessPolicy[] }
export type SiteAccessResult = 'prepared' | 'verification-needed' | 'unsupported' | 'denied' | 'failed';
export const DEFAULT_WEB_SITE_ACCESS: WebSiteAccessConfig = { version: 1, policies: [{
  id: 'libvio', name: 'LIBVIO', hosts: ['libvio.host'], pathPrefixes: ['/'],
  cookieNames: ['__cdn_verified'], retryMode: 'partitioned-cookie', cleanupLegacyAliases: true, referrerPolicy: 'no-referrer',
}] };
export function validateWebSiteAccess(input: unknown): input is WebSiteAccessConfig {
  if (!input || typeof input !== 'object') return false;
  const config = input as WebSiteAccessConfig;
  const strings = (a: unknown, max: number, check: (s: string) => boolean): a is string[] =>
    Array.isArray(a) && a.length > 0 && a.length <= max && new Set(a).size === a.length && a.every(s => typeof s === 'string' && check(s));
  return Object.keys(config).every(k => ['version', 'policies'].includes(k)) && config.version === 1
    && Array.isArray(config.policies) && config.policies.length <= 32 && new Set(config.policies.map(p => p?.id)).size === config.policies.length
    && config.policies.every(p => p && Object.keys(p).every(k => ['id', 'name', 'hosts', 'pathPrefixes', 'cookieNames', 'referrerPolicy', 'retryMode', 'cleanupLegacyAliases'].includes(k))
      && typeof p.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(p.id)
      && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 60 && !/[<>\x00-\x1f]/.test(p.name)
      && strings(p.hosts, 8, h => h.length <= 253 && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(h) && !/^\d+(?:\.\d+)+$/.test(h) && !h.endsWith('.localhost'))
      && strings(p.pathPrefixes, 8, s => /^\/[a-zA-Z0-9/_-]*$/.test(s) && s.length <= 160 && !s.includes('//'))
      && (p.retryMode === undefined || ['reload', 'partitioned-cookie'].includes(p.retryMode))
      && (p.cleanupLegacyAliases === undefined || typeof p.cleanupLegacyAliases === 'boolean')
      && ((p.retryMode === 'reload' && Array.isArray(p.cookieNames) && p.cookieNames.length === 0)
        || strings(p.cookieNames, 4, s => /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(s)))
      && ['no-referrer', 'strict-origin-when-cross-origin'].includes(p.referrerPolicy))
    && config.policies.every((p, i) => !config.policies.slice(i + 1).some(other =>
      p.hosts.some(h => other.hosts.includes(h)) && p.pathPrefixes.some(a => other.pathPrefixes.some(b => a.startsWith(b) || b.startsWith(a)))));
}
export function matchWebSiteAccess(config: WebSiteAccessConfig, url: string | null): WebSiteAccessPolicy | null {
  try {
    const u = new URL(url || '');
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return config.policies.find(p => p.hosts.includes(u.hostname) && p.pathPrefixes.some(path => u.pathname.startsWith(path))) || null;
  } catch { return null; }
}
