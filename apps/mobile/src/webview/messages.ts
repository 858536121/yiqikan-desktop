import type { PageMessage, PlayerEnvelope } from './contracts';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => value === undefined || typeof value === 'string';
const flag = (value: unknown) => value === undefined || typeof value === 'boolean';
function sample(value: unknown): boolean {
  return record(value) && ['currentTime', 'duration', 'playbackRate', 'sampledAt'].every(key => value[key] === undefined || typeof value[key] === 'number')
    && flag(value.paused);
}
function message(value: unknown): value is PageMessage {
  if (!record(value)) return false;
  switch (value.type) {
    case 'REQUEST_FULLSCREEN': case 'EXIT_FULLSCREEN': case 'TOGGLE_FULLSCREEN':
    case 'TOGGLE_CONTROLS': case 'REQUEST_RESYNC': case 'TOUCH_INTERACT': case 'PLAYER_DOCUMENT': return true;
    case 'LOG': return typeof value.msg === 'string';
    case 'HOST_ONLY_WARNING': case 'TOAST': return typeof value.message === 'string';
    case 'VIDEO_FOUND': return text(value.title) && flag(value.platformAdapter);
    case 'FOUND_IFRAME': return typeof value.url === 'string' && typeof value.parentHost === 'string';
    case 'PAGE_SITE_ICON': return typeof value.session === 'string' && typeof value.pageUrl === 'string' && typeof value.siteIcon === 'string';
    case 'PLAYER_EPISODE_NAVIGATION': return typeof value.url === 'string';
    case 'PLAYER_IFRAME_SELECTED': case 'PLAYER_SELECTED': return text(value.title);
    case 'PLAYER_CONTROL': return value.action === 'pause' || value.action === 'resume';
    case 'PLAYER_RELEASED': case 'PLAYER_EXPIRED': return text(value.reason) && text(value.message)
      && (value.previousMode === undefined || (typeof value.previousMode === 'string' && ['page', 'floating', 'fullscreen'].includes(value.previousMode)));
    case 'LOCAL_VIDEO_SELECTED': return text(value.fileName);
    case 'SYNC_RECOVERY': return typeof value.phase === 'string' && (value.gap === undefined || typeof value.gap === 'number');
    case 'MEDIA_REALTIME_STATUS': return (value.queryId === undefined || typeof value.queryId === 'number')
      && (value.payload === null || sample(value.payload));
    case 'SYNC_EVENT': return sample(value.payload) && record(value.payload)
      && typeof value.payload.currentTime === 'number' && typeof value.payload.paused === 'boolean' && text(value.payload.eventName)
      && text(value.payload.videoTitle) && flag(value.payload.buffering) && flag(value.payload.seeking) && flag(value.payload.ended);
    case 'MEDIA_CONTEXT': return typeof value.key === 'string' && typeof value.ready === 'boolean'
      && text(value.pageUrl) && text(value.title) && text(value.contentId) && text(value.contentKey) && flag(value.privatePage)
      && (value.episode === undefined || (record(value.episode) && typeof value.episode.label === 'string' && text(value.episode.url)));
    default: return false;
  }
}
// HTMLMediaElement.duration is Infinity for live media. JSON.stringify encodes
// that as null; old frame/local scripts still send this shape. Keep the sample
// usable for play/pause and clocks, while exposing no finite seek duration.
function normalizeDuration(value: Record<string, unknown>) {
  if ((value.type === 'SYNC_EVENT' || value.type === 'MEDIA_REALTIME_STATUS')
    && record(value.payload) && value.payload.duration === null) value.payload.duration = 0;
}
/** The JSON bridge is a runtime boundary; a TypeScript assertion cannot validate it. */
export function parsePageMessage(raw: string): PageMessage | PlayerEnvelope | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!record(value)) return null;
  if (value.type === 'WEB_PLAYER_MESSAGE') {
    if (record(value.payload)) normalizeDuration(value.payload);
    if (typeof value.session !== 'string' || typeof value.documentId !== 'string' || !message(value.payload)) return null;
    return value as unknown as PlayerEnvelope;
  }
  normalizeDuration(value);
  return message(value) ? value : null;
}
