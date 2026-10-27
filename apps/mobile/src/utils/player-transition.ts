import type { PlaybackMedia } from '@yiqikan/shared';

export type PlayerMode = 'page' | 'floating' | 'fullscreen';
export interface LocalMedia {
  key: string;
  documentId: string;
  pageUrl?: string;
  title?: string;
  contentId?: string;
  episode?: { label: string; url?: string };
  ready: boolean;
}
const titleText = (value?: string) => (value || '').replace(/\s+/g, '').toLowerCase();
export const episodeLabel = (value?: string) => {
  const text = titleText(value), match = text.match(/^(?:第)?(\d+)(?:集)?$/) || text.match(/^ep(\d+)$/);
  return match ? match[1].replace(/^0+/, '') || '0' : text;
};

// Keeps the desired presentation while the old document/media is invalidated.
// No clock command may cross this boundary until media is confirmed or the
// member explicitly confirms that their alternate source matches the host.
export class PlayerTransition {
  host: { room: string; url: string; media?: PlaybackMedia | null } | null = null;
  private beforeNavigation: { room: string; contentId: string } | null = null;
  private following = false;
  pending: {
    phase: 'loading' | 'choose'; mode: PlayerMode; documentId: string; key: string;
    newDocument: boolean; media?: PlaybackMedia | null; targetUrl?: string; originUrl?: string;
  } | null = null;

  observe(room: string, url: string, media: PlaybackMedia | null | undefined,
    following: boolean, mode: PlayerMode, local: LocalMedia | null) {
    const previous = this.host, resumedFollowing = following && !this.following;
    this.following = following;
    this.host = { room, url, media };
    if (!previous) {
      this.pending = null;
      if (following && media?.episode && local && episodeLabel(local.episode?.label) !== episodeLabel(media.episode.label)) {
        this.pending = { phase: 'loading', mode, documentId: local.documentId, key: local.key, newDocument: false, media, targetUrl: url };
        return true;
      }
      return false;
    }
    if (previous.room !== room && previous.url === url && previous.media?.id === media?.id) {
      this.pending = null;
      return false;
    }
    const newDocument = previous.url !== url;
    if (previous.room !== room) this.beforeNavigation = null;
    if (newDocument && previous.room === room && previous.media?.contentId && !media) {
      this.beforeNavigation = { room, contentId: previous.media.contentId };
    }
    // load_url clears media before discovery. Keep the alternate source paused
    // until the host identifies its new page, then resume only on positive proof
    // that it is the same content. Following-page members still await that page.
    if (media && this.beforeNavigation) {
      const same = this.beforeNavigation.room === room && this.beforeNavigation.contentId === media.contentId;
      this.beforeNavigation = null;
      if (same && !following) { this.pending = null; return false; }
    }
    if (previous.room === room && !newDocument && (previous.media?.id || '') === (media?.id || '')) {
      // Free browsing retained the old source while the room changed episode.
      // Returning to follow must retry that target even without another host event.
      // The original ready checks still require the matching episode/new document.
      if (resumedFollowing && this.pending?.phase === 'choose' && (this.pending.newDocument || media?.episode)) {
        this.pending.phase = 'loading';
        return true;
      }
      return false;
    }
    // Reloading or changing the line of a known episode is still the same
    // content. Alternate-source members can keep following without a prompt.
    if (previous.room === room && !this.pending && previous.media?.contentId && previous.media.contentId === media?.contentId) return false;
    if (previous.room === room && !newDocument && !this.pending && previous.media?.title && media?.title
      && previous.media.title === media.title && previous.media.pageUrl === media.pageUrl
      && previous.media.episode && media.episode
      && episodeLabel(previous.media.episode.label) === episodeLabel(media.episode.label)) return false;
    if (previous.room === room && !newDocument && !previous.media && !this.pending
      && (!following || !media?.episode || episodeLabel(local?.episode?.label) === episodeLabel(media.episode.label))) return false;
    // Navigation first clears the generation; discovery subsequently supplies
    // one. Keep the same transaction instead of treating discovery as a second switch.
    const prior = this.pending;
    this.pending = {
      phase: following && (newDocument || prior?.newDocument || media?.episode) ? 'loading' : 'choose',
      mode: prior?.mode || mode, documentId: prior?.documentId || local?.documentId || '',
      key: prior?.key || local?.key || '', newDocument: newDocument || Boolean(prior?.newDocument), media, targetUrl: url,
    };
    return true;
  }

  loading(mode: PlayerMode, local: LocalMedia | null, targetUrl?: string) {
    if (this.pending) return;
    this.pending = { phase: 'loading', mode, documentId: local?.documentId || '', key: local?.key || '', newDocument: true,
      originUrl: local?.pageUrl, targetUrl };
  }

  replacement(mode: PlayerMode, local: LocalMedia | null) {
    if (this.pending) return;
    this.pending = { phase: 'loading', mode, documentId: local?.documentId || '', key: local?.key || '', newDocument: false };
  }

  ready(local: LocalMedia, isHost = false): PlayerMode | null {
    const p = this.pending;
    if (!p || !local.ready || (!isHost && p.phase !== 'loading')) return null;
    const identified = Boolean(p.media?.contentId && local.contentId);
    const sameIdentity = identified && p.media?.contentId === local.contentId;
    // Display headings can hydrate after the host discovers the new source.
    // Prefer the observer's stable identity; equal text cannot override an
    // explicit identity conflict. Source/document and episode gates still apply.
    if (!isHost && identified && !sameIdentity) return null;
    const sameContent = Boolean((sameIdentity || (p.media?.title && local.title
      && titleText(local.title) === titleText(p.media.title))) && p.media?.episode && local.episode
      && episodeLabel(local.episode.label) === episodeLabel(p.media.episode.label));
    if (p.newDocument && local.documentId === p.documentId) {
      // Android reports load-start for SPA history too. The same document can
      // recover only after it positively reports readiness at the new target
      // URL. Old-page reports and same-URL reloads still require a new document.
      if (!isHost) {
        // Android also emits load-start for a member's SPA episode selection.
        // A fresh source plus the requested named film/part can prove that
        // transaction without accepting a late old-document readiness report.
        const samePage = Boolean(p.targetUrl && local.pageUrl
          && p.targetUrl.split(/[?#]/)[0] === local.pageUrl.split(/[?#]/)[0]);
        if (!samePage || !sameContent || !p.key || p.key === local.key
          || (p.media?.contentId && p.media.contentId !== local.contentId)) return null;
      } else if (!p.originUrl || !p.targetUrl || p.originUrl === p.targetUrl || local.pageUrl !== p.targetUrl) return null;
    }
    // The host chooses the room's content. A current-document ready report
    // also recovers a brief buffer gap without requiring a new source/key.
    if (isHost) { this.pending = null; return p.mode; }
    if (!sameIdentity && p.media?.title && titleText(local.title) !== titleText(p.media.title)) return null;

    // Per-visitor redirects may change page parameters. A named matching film
    // and episode is stronger evidence than copying another visitor's URL.
    if (p.targetUrl && local.pageUrl && local.pageUrl.split('#')[0] !== p.targetUrl.split('#')[0] && !sameContent) return null;
    if (!p.newDocument && local.key === p.key) return null;
    if (p.media?.episode && episodeLabel(local.episode?.label) !== episodeLabel(p.media.episode.label)) return null;
    this.pending = null;
    return p.mode;
  }

  confirm(): PlayerMode {
    const mode = this.pending?.mode || 'page';
    this.pending = null;
    return mode;
  }

  fail() {
    if (this.pending) { this.pending.phase = 'choose'; this.pending.mode = 'page'; }
  }
}
