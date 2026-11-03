import { siteRuleMatches, validateSiteRule, type SiteRule, type SiteRuleSnapshot } from './schema';
import { BUNDLED_SITE_RULES } from './bundled-rules';

// Packaged, reviewed JSON is separate from the remote trust gate. An unsigned
// network response can never become a bundled rule.
export function bundledSiteRuleSnapshot(platform: SiteRuleSnapshot['platform'], clientVersion: string): SiteRuleSnapshot {
  if (!BUNDLED_SITE_RULES.every(validateSiteRule)) throw Error('Invalid bundled site rule');
  const now = Date.now();
  return { platform, clientVersion, release: {
    schemaVersion: 1, sequence: 1, issuedAt: now, expiresAt: now + 86400000, enabled: true,
    rules: JSON.parse(JSON.stringify(BUNDLED_SITE_RULES)),
  } };
}

function profile(snapshot: SiteRuleSnapshot | null, url: string): SiteRule | null {
  if (!snapshot?.release.enabled || snapshot.release.expiresAt <= Date.now()) return null;
  const matches = snapshot.release.rules.filter(rule => siteRuleMatches(rule, url, snapshot.platform, snapshot.clientVersion))
    .sort((a, b) => b.priority - a.priority);
  const selected = matches.length && (matches.length === 1 || matches[0].priority !== matches[1].priority) ? matches[0] : null;
  return selected?.mode === 'active' && selected.capabilities.playbackPage ? selected : null;
}

export function privatePlaybackPage(snapshot: SiteRuleSnapshot | null, value: string): boolean {
  try {
    const url = new URL(value), rule = profile(snapshot, value);
    return url.protocol === 'https:' && !url.username && !url.password
      && Boolean(rule?.capabilities.playbackPage?.privatePathPrefixes.some(path => url.pathname.startsWith(path)));
  } catch { return false; }
}

// Revalidate the observed route at the native navigation boundary. Reconstruct
// it from allowed fields so private search/auth query data cannot be forwarded.
export function publicPlaybackUrl(snapshot: SiteRuleSnapshot | null, page: string, value: unknown): string | null {
  if (!privatePlaybackPage(snapshot, page) || typeof value !== 'string') return null;
  try {
    const config = profile(snapshot, page)!.capabilities.playbackPage!, source = new URL(page), target = new URL(value);
    if (target.origin !== source.origin || target.username || target.password || !target.pathname.startsWith(config.playerPathPrefix)) return null;
    const id = target.pathname.slice(config.playerPathPrefix.length), token = id.slice(config.idPrefix.length);
    if (!id.startsWith(config.idPrefix) || !/^[A-Za-z0-9_-]{8,240}$/.test(token)) return null;
    const episode = target.searchParams.get(config.episodeQuery);
    if (episode !== null && !/^[1-9]\d{0,5}$/.test(episode)) return null;
    const result = new URL(config.playerPathPrefix + id, source.origin);
    if (episode) result.searchParams.set(config.episodeQuery, episode);
    return result.href;
  } catch { return null; }
}
