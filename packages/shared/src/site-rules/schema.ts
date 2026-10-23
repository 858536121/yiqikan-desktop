// Deliberately finite: v1 cannot change identity, navigate, click, or execute code.
export const SITE_RULE_ENGINE_MAJOR = 1;
export const SITE_RULE_MAX_BYTES = 256 * 1024;
export const SITE_RULE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export type SiteRulePlatform = 'ios' | 'android' | 'extension';
export type SiteRuleMode = 'observe' | 'active';
export interface SiteRule {
  schemaVersion: 1;
  id: string;
  version: number;
  engineMajor: 1;
  platforms: SiteRulePlatform[];
  clientVersions: { min: string; max: string };
  priority: number;
  match: { hosts: string[]; pathPrefixes: string[] };
  mode: SiteRuleMode;
  capabilities: {
    title?: { selectors: string[]; maxChars: number };
    mediaCandidates?: { selectors: string[]; excludeWithin: string[] };
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
function host(v: string): boolean {
  return v.length <= 253 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(v)
    && v.split('.').every(label => label.length <= 63);
}
export function validateSiteRule(v: unknown): v is SiteRule {
  if (!keys(v, ['schemaVersion', 'id', 'version', 'engineMajor', 'platforms', 'clientVersions', 'priority', 'match', 'mode', 'capabilities'])) return false;
  if (v.schemaVersion !== 1 || v.engineMajor !== 1 || typeof v.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(v.id)
    || !integer(v.version, 1, Number.MAX_SAFE_INTEGER) || !integer(v.priority, 0, 1000) || !['observe', 'active'].includes(v.mode as string)
    || !strings(v.platforms, 1, 3, s => ['ios', 'android', 'extension'].includes(s))) return false;
  if (!keys(v.clientVersions, ['min', 'max']) || !isSiteRuleVersion(v.clientVersions.min) || !isSiteRuleVersion(v.clientVersions.max)
    || compareSiteRuleVersions(v.clientVersions.min, v.clientVersions.max) > 0) return false;
  if (!keys(v.match, ['hosts', 'pathPrefixes']) || !strings(v.match.hosts, 1, 8, host)
    || !strings(v.match.pathPrefixes, 1, 8, s => s.length <= 160 && /^\/[a-zA-Z0-9/_-]*$/.test(s) && !s.includes('//'))) return false;
  if (!keys(v.capabilities, [], ['title', 'mediaCandidates']) || !Object.keys(v.capabilities).length) return false;
  const { title, mediaCandidates } = v.capabilities;
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
    // Exact hosts; subdomains must be explicitly listed. Never suffix-match.
    return (u.protocol === 'https:' || u.protocol === 'http:') && rule.match.hosts.includes(u.hostname)
      && rule.match.pathPrefixes.some(p => u.pathname.startsWith(p));
  } catch { return false; }
}
