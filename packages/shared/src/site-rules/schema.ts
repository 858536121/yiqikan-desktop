// Version 1 is read-only, v2 adds public routes, v3 adds bounded numeric hosts,
// v4 supplies dated episode directory selectors, and v5 describes local room navigation.
// No version accepts executable code, arbitrary property paths or requests.
export const SITE_RULE_ENGINE_MAJOR = 5;
export const SITE_RULE_MAX_BYTES = 256 * 1024;
export const SITE_RULE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export type SiteRulePlatform = 'ios' | 'android' | 'extension';
export type SiteRuleMode = 'observe' | 'active';
export interface NumericSiteRuleHost {
  prefix: string;
  suffix: string;
  minDigits: number;
  maxDigits: number;
}
export interface SiteRuleEpisodeDirectory {
  expandSelector: string;
  dialogSelector: string;
  listSelector: string;
  closeSelector: string;
  episodeSelector: string;
  tabSelector: string;
  moreSelector: string;
  moreLabel: string;
}
const directorySelectors = ['expandSelector', 'dialogSelector', 'listSelector', 'closeSelector',
  'episodeSelector', 'tabSelector', 'moreSelector'];

export interface SiteRule {
  schemaVersion: 1 | 2 | 3 | 4 | 5;
  id: string;
  version: number;
  engineMajor: 1 | 2 | 3 | 4 | 5;
  platforms: SiteRulePlatform[];
  clientVersions: { min: string; max: string };
  priority: number;
  match: { hosts: string[]; pathPrefixes: string[]; numericHosts?: NumericSiteRuleHost[] };
  mode: SiteRuleMode;
  capabilities: {
    playbackPage?: { event: string; fields: { active: string; id: string; title: string; episode: string };
      episodeLabel: { prefix: string; suffix: string }; selectedEpisode?: { selectors: string[]; maxChars: number };
      episodeDirectory?: SiteRuleEpisodeDirectory;
      idPrefix: string; privatePathPrefixes: string[]; playerPathPrefix: string; episodeQuery: string };
    title?: { selectors: string[]; maxChars: number };
    mediaCandidates?: { selectors: string[]; excludeWithin: string[] };
    roomNavigation?: { entryHosts: string[]; localPaths: string[]; direct?: { host: string; readySelector: string } };
  };
}
export interface SiteRuleRelease {
  schemaVersion: 1;
  sequence: number;
  issuedAt: number;
  expiresAt: number;
  enabled: boolean;
  rules: SiteRule[];
}
export interface SignedSiteRuleRelease {
  format: 1;
  keyId: string;
  // Exact JSON bytes are signed, not a reserialized object.
  payload: string;
  signature: string;
}
export interface SiteRuleSnapshot {
  platform: SiteRulePlatform;
  clientVersion: string;
  release: SiteRuleRelease;
}

const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
function keys(v: unknown, required: string[], optional: string[] = []): v is Record<string, unknown> {
  return object(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
}
function integer(v: unknown, min: number, max: number): v is number {
  return Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
}
function strings(v: unknown, min: number, max: number, check: (s: string) => boolean): v is string[] {
  return Array.isArray(v) && v.length >= min && v.length <= max && v.every(s => typeof s === 'string' && check(s)) && new Set(v).size === v.length;
}
export function isSiteRuleVersion(v: unknown): v is string {
  return typeof v === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(v);
}
export function compareSiteRuleVersions(a: string, b: string): number {
  const av = a.split('.').map(Number), bv = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  return 0;
}
// A small CSS subset is sufficient for v1: no :has, pseudo programs, escapes,
// comma lists, universal selectors, attribute substring matches or URLs.
// More capable selectors require a reviewed engine release, not a rule trick.
function selector(v: string): boolean {
  if (v.length < 1 || v.length > 200 || v.trim() !== v) return false;
  const token = '(?:[a-zA-Z][a-zA-Z0-9-]*)?(?:[.#][a-zA-Z_][a-zA-Z0-9_-]*|\\[[a-zA-Z_][a-zA-Z0-9_-]*(?:="[a-zA-Z0-9_-]+")?\\])*';
  return new RegExp('^' + token + '(?:(?: +| *> *)' + token + ')*$').test(v) && !/(^|[ >])([ >]|$)/.test(v.replace(/ *> */g, '>'));
}
function episodeDirectory(v: unknown): v is SiteRuleEpisodeDirectory {
  return keys(v, [...directorySelectors, 'moreLabel'])
    && directorySelectors.every(key => typeof v[key] === 'string' && selector(v[key] as string))
    && typeof v.moreLabel === 'string' && v.moreLabel.length > 0 && v.moreLabel.length <= 40
    && v.moreLabel.trim() === v.moreLabel && !/[<>\u0000-\u001f]/.test(v.moreLabel);
}
function host(v: string): boolean {
  return v.length <= 253 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(v)
    && v.split('.').every(label => label.length <= 63);
}
function numericHost(v: unknown): v is NumericSiteRuleHost {
  return keys(v, ['prefix', 'suffix', 'minDigits', 'maxDigits'])
    && typeof v.prefix === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v.prefix)
    && typeof v.suffix === 'string' && v.suffix.length <= 200 && host('a.' + v.suffix)
    && integer(v.minDigits, 1, 6) && integer(v.maxDigits, v.minDigits, 6);
}
export function siteRuleHostMatches(match: SiteRule['match'], hostname: string): boolean {
  return match.hosts.includes(hostname) || Boolean(match.numericHosts?.some(pattern => {
    const suffix = '.' + pattern.suffix;
    if (!hostname.startsWith(pattern.prefix) || !hostname.endsWith(suffix)) return false;
    const digits = hostname.slice(pattern.prefix.length, -suffix.length);
    return digits.length >= pattern.minDigits && digits.length <= pattern.maxDigits && /^[0-9]+$/.test(digits);
  }));
}
// Numeric prefixes contain no dots, so different suffixes cannot intersect.
// If one prefix extends another, only extra digits can bridge the two families.
export function siteRuleHostsOverlap(a: SiteRule['match'], b: SiteRule['match']): boolean {
  if (a.hosts.some(h => siteRuleHostMatches(b, h)) || b.hosts.some(h => siteRuleHostMatches(a, h))) return true;
  return Boolean(a.numericHosts?.some(left => b.numericHosts?.some(right => {
    if (left.suffix !== right.suffix) return false;
    const [short, long] = left.prefix.length <= right.prefix.length ? [left, right] : [right, left];
    if (!long.prefix.startsWith(short.prefix)) return false;
    const extra = long.prefix.slice(short.prefix.length);
    return (!extra || /^[0-9]+$/.test(extra))
      && Math.max(short.minDigits, long.minDigits + extra.length) <= Math.min(short.maxDigits, long.maxDigits + extra.length);
  })));
}
export function validateSiteRule(v: unknown): v is SiteRule {
  if (!keys(v, ['schemaVersion', 'id', 'version', 'engineMajor', 'platforms', 'clientVersions', 'priority', 'match', 'mode', 'capabilities'])) return false;
  if (!integer(v.schemaVersion, 1, SITE_RULE_ENGINE_MAJOR) || v.engineMajor !== v.schemaVersion
    || typeof v.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(v.id)
    || !integer(v.version, 1, Number.MAX_SAFE_INTEGER) || !integer(v.priority, 0, 1000) || !['observe', 'active'].includes(v.mode as string)
    || !strings(v.platforms, 1, 3, s => ['ios', 'android', 'extension'].includes(s))) return false;
  if (!keys(v.clientVersions, ['min', 'max']) || !isSiteRuleVersion(v.clientVersions.min) || !isSiteRuleVersion(v.clientVersions.max)
    || compareSiteRuleVersions(v.clientVersions.min, v.clientVersions.max) > 0) return false;
  if (!keys(v.match, ['hosts', 'pathPrefixes'], v.schemaVersion >= 3 ? ['numericHosts'] : [])
    || !strings(v.match.hosts, 0, 8, host)
    || !strings(v.match.pathPrefixes, 1, 8, s => s.length <= 160 && /^\/[a-zA-Z0-9/_-]*$/.test(s) && !s.includes('//'))) return false;
  if (v.match.numericHosts !== undefined && (!Array.isArray(v.match.numericHosts)
    || v.match.numericHosts.length < 1 || v.match.numericHosts.length > 4 || !v.match.numericHosts.every(numericHost))) return false;
  if (!v.match.hosts.length && !(Array.isArray(v.match.numericHosts) && v.match.numericHosts.length)) return false;
  const capabilities = ['title', 'mediaCandidates'];
  if (v.schemaVersion >= 2) capabilities.push('playbackPage');
  if (v.schemaVersion >= 5) capabilities.push('roomNavigation');
  if (!keys(v.capabilities, [], capabilities) || !Object.keys(v.capabilities).length) return false;
  const { title, mediaCandidates, playbackPage, roomNavigation } = v.capabilities;
  if (roomNavigation !== undefined) {
    const match = v.match as SiteRule['match'];
    if (!keys(roomNavigation, ['entryHosts', 'localPaths'], ['direct'])
      || !strings(roomNavigation.entryHosts, 0, 8, s => host(s) && match.hosts.includes(s))
      || !strings(roomNavigation.localPaths, 1, 8, s => /^\/[a-zA-Z0-9_-]{1,80}(?:\.html)?$/.test(s))) return false;
    const direct = roomNavigation.direct;
    if (direct !== undefined && (!keys(direct, ['host', 'readySelector'])
      || typeof direct.host !== 'string' || !host(direct.host) || !siteRuleHostMatches(match, direct.host)
      || roomNavigation.entryHosts.includes(direct.host) || !roomNavigation.entryHosts.length
      || typeof direct.readySelector !== 'string' || !selector(direct.readySelector))) return false;
  }
  if (playbackPage !== undefined) {
    const c = playbackPage;
    const field = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(s) && !['constructor','prototype','__proto__'].includes(s);
    const prefix = (s: string) => s.length <= 160 && /^\/[a-zA-Z0-9/_-]+\/$/.test(s) && !s.includes('//');
    const optional = v.schemaVersion >= 4 ? ['selectedEpisode', 'episodeDirectory'] : ['selectedEpisode'];
    if (!keys(c, ['event','fields','idPrefix','privatePathPrefixes','playerPathPrefix','episodeQuery','episodeLabel'], optional)
      || typeof c.event !== 'string' || !/^[a-zA-Z][a-zA-Z0-9:_-]{0,79}$/.test(c.event)
      || !keys(c.fields, ['active','id','title','episode']) || !Object.values(c.fields).every(field)
      || typeof c.idPrefix !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,15}$/.test(c.idPrefix)
      || !strings(c.privatePathPrefixes,1,8,prefix) || typeof c.playerPathPrefix !== 'string' || !prefix(c.playerPathPrefix)
      || !field(c.episodeQuery) || !keys(c.episodeLabel,['prefix','suffix'])
      || !Object.values(c.episodeLabel).every(s=>typeof s==='string'&&s.length<=20&&!/[<>\u0000-\u001f]/.test(s))) return false;
    if (c.selectedEpisode !== undefined && (!keys(c.selectedEpisode, ['selectors','maxChars'])
      || !strings(c.selectedEpisode.selectors,1,8,selector) || !integer(c.selectedEpisode.maxChars,1,120))) return false;
    if (c.episodeDirectory !== undefined && (!v.platforms.includes('extension') || !episodeDirectory(c.episodeDirectory))) return false;
  }
  if (title !== undefined && (!keys(title, ['selectors', 'maxChars']) || !strings(title.selectors, 1, 8, selector) || !integer(title.maxChars, 1, 300))) return false;
  if (mediaCandidates !== undefined && (!keys(mediaCandidates, ['selectors', 'excludeWithin'])
    || !strings(mediaCandidates.selectors, 1, 8, selector) || !strings(mediaCandidates.excludeWithin, 0, 8, selector))) return false;
  return true;
}
export function validateSiteRuleRelease(v: unknown): v is SiteRuleRelease {
  if (!keys(v, ['schemaVersion', 'sequence', 'issuedAt', 'expiresAt', 'enabled', 'rules']) || v.schemaVersion !== 1
    || !integer(v.sequence, 1, Number.MAX_SAFE_INTEGER) || !integer(v.issuedAt, 1, Number.MAX_SAFE_INTEGER)
    || !integer(v.expiresAt, 1, Number.MAX_SAFE_INTEGER) || typeof v.enabled !== 'boolean'
    || v.expiresAt <= v.issuedAt || v.expiresAt - v.issuedAt > SITE_RULE_MAX_AGE_MS
    || !Array.isArray(v.rules) || v.rules.length > 32 || !v.rules.every(validateSiteRule)) return false;
  return new Set(v.rules.map(r => r.id)).size === v.rules.length;
}
export function siteRuleMatches(rule: SiteRule, url: string, platform: SiteRulePlatform, clientVersion: string): boolean {
  if (!isSiteRuleVersion(clientVersion) || !rule.platforms.includes(platform)
    || compareSiteRuleVersions(clientVersion, rule.clientVersions.min) < 0 || compareSiteRuleVersions(clientVersion, rule.clientVersions.max) > 0) return false;
  try {
    const u = new URL(url);
    // Full host matching only: numeric families cannot admit extra subdomains.
    return (u.protocol === 'https:' || u.protocol === 'http:') && siteRuleHostMatches(rule.match, u.hostname)
      && rule.match.pathPrefixes.some(p => u.pathname.startsWith(p));
  } catch { return false; }
}
