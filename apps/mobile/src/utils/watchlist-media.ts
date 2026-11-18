import { episodeLabel, type LocalMedia } from './player-transition';

export interface WatchlistLocation {
  url: string;
  episodeUrl?: string;
  episode?: string;
  contentId?: string;
}

export interface WatchlistSample {
  location: WatchlistLocation;
  title?: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  ended?: boolean;
}

export function watchlistUrl(value?: string): string | undefined {
  const text = value?.trim();
  if (!text || text.length > 4096 || !/^https?:\/\//i.test(text) || /\s/.test(text)) return;
  try {
    const url = new URL(text);
    if (url.hostname && !url.username && !url.password) return url.href;
  } catch { /* The original page remains usable outside the watchlist. */ }
}

const text = (value: string | undefined) => value?.trim().slice(0, 180) || undefined;

export function readWatchlistLocation(page: string, media: LocalMedia): WatchlistLocation | null {
  const url = watchlistUrl(page);
  if (!url || !media.ready || url !== watchlistUrl(media.pageUrl)) return null;
  const episode = text(media.episode?.label);
  const link = episode && watchlistUrl(media.episode?.url);
  const episodeUrl = link && link !== url && new URL(link).origin === new URL(url).origin ? link : undefined;
  return { url, episodeUrl, episode, contentId: text(media.contentId) };
}

export function watchlistOpenUrl(location: WatchlistLocation) {
  return location.episodeUrl || location.url;
}

// A part number or a hash route can identify another video at the same site.
export function sameWatchlistMedia(saved: WatchlistLocation, live: WatchlistLocation) {
  if (saved.url !== live.url && watchlistOpenUrl(saved) !== live.url && saved.url !== watchlistOpenUrl(live)
    && watchlistOpenUrl(saved) !== watchlistOpenUrl(live)) return false;
  if (episodeLabel(saved.episode) !== episodeLabel(live.episode)) return false;
  if (saved.episodeUrl && live.episodeUrl && saved.episodeUrl !== live.episodeUrl && !saved.contentId) return false;
  return !saved.contentId || saved.contentId === live.contentId;
}

export function isWatchlistLinkForMedia(saved: WatchlistLocation, live: WatchlistLocation) {
  return !saved.episode && !saved.contentId && !saved.episodeUrl
    && (saved.url === live.url || saved.url === watchlistOpenUrl(live));
}

type SavedPlayback = WatchlistLocation & { currentTime: number; duration: number; finished: boolean };

export function matchesWatchlistLaunch(saved: SavedPlayback, live: WatchlistLocation) {
  return sameWatchlistMedia(saved, live) || (!saved.currentTime && !saved.finished && isWatchlistLinkForMedia(saved, live));
}

export function watchlistResumeTarget(saved: SavedPlayback,
  sample: WatchlistSample, ranges: { start: number; end: number }[]) {
  if (!matchesWatchlistLaunch(saved, sample.location)) return null;
  const target = saved.finished ? 0 : saved.currentTime || sample.currentTime;
  if (!sample.duration || (saved.duration > 0 && Math.abs(saved.duration - sample.duration) > Math.max(5, saved.duration * .04)) ||
    !ranges.some(range => target >= range.start && target <= range.end)) return null;
  return { target };
}
