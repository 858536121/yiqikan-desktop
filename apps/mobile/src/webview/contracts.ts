/** Shared RN ↔ page contracts. No React Native or browser runtime imports here. */
export interface SeekRange { start: number; end: number }
export interface PlayerControl { key: string; ranges: SeekRange[]; ready: boolean }
export interface PlaybackSample {
  paused: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  sampledAt: number;
}
export interface PlayerReport extends PlaybackSample {
  eventName: string;
  videoTitle: string;
  buffering: boolean;
  seeking: boolean;
  ended: boolean;
  control: PlayerControl | null;
}
export type NativeMessage =
  | { type: 'SYNC_EVENT'; payload: PlayerReport }
  | { type: 'MEDIA_REALTIME_STATUS'; queryId?: number; payload: PlaybackSample | null }
  | { type: 'VIDEO_FOUND'; title: string; platformAdapter: boolean }
  | { type: 'FOUND_IFRAME'; url: string; parentHost: string }
  | { type: 'HOST_ONLY_WARNING'; message: string }
  | { type: 'LOG'; msg: string }
  | { type: 'SYNC_RECOVERY'; phase: 'aligned' }
  | { type: 'SYNC_RECOVERY'; phase: 'limited'; gap: number }
  | { type: 'REQUEST_FULLSCREEN' | 'EXIT_FULLSCREEN' | 'TOGGLE_CONTROLS' | 'REQUEST_RESYNC' };

export interface SyncCommand {
  currentTime?: number;
  paused?: boolean;
  playbackRate?: number;
  sampledAt?: number;
  remote?: boolean;
  force?: boolean;
  allowRetry?: boolean;
  fullscreen?: boolean;
  controlKey?: string;
  controlId?: string;
}


// Older local/frame scripts omit some metadata. Validate the fields actually
// consumed by RN, while keeping this compatibility surface explicit.
export type ReceivedSample = Partial<PlaybackSample>;
export type ReceivedReport = ReceivedSample & Pick<PlaybackSample, 'currentTime' | 'paused'> & Partial<Omit<PlayerReport, keyof PlaybackSample | 'control'>> & { control?: unknown };
export type PageMessage =
  | Exclude<NativeMessage, { type: 'SYNC_EVENT' | 'MEDIA_REALTIME_STATUS' | 'VIDEO_FOUND' | 'SYNC_RECOVERY' }>
  | { type: 'SYNC_RECOVERY'; phase: string; gap?: number }
  | { type: 'VIDEO_FOUND'; title?: string; platformAdapter?: boolean }
  | { type: 'SYNC_EVENT'; payload: ReceivedReport }
  | { type: 'MEDIA_REALTIME_STATUS'; queryId?: number; payload: ReceivedSample | null }
  | { type: 'PLAYER_DOCUMENT' | 'TOUCH_INTERACT' | 'TOGGLE_FULLSCREEN' }
  | { type: 'PAGE_SITE_ICON'; session: string; pageUrl: string; siteIcon: string }
  | { type: 'MEDIA_CONTEXT'; key: string; pageUrl?: string; title?: string; contentId?: string;
      contentKey?: string; ready: boolean; privatePage?: boolean; shareUrl?: unknown;
      episode?: { label: string; url?: string } }
  | { type: 'PLAYER_EPISODE_NAVIGATION'; url: string }
  | { type: 'PLAYER_IFRAME_SELECTED' | 'PLAYER_SELECTED'; title?: string }
  | { type: 'PLAYER_CONTROL'; action: 'pause' | 'resume' }
  | { type: 'PLAYER_RELEASED' | 'PLAYER_EXPIRED'; reason?: string; message?: string;
      previousMode?: 'page' | 'floating' | 'fullscreen' }
  | { type: 'LOCAL_VIDEO_SELECTED'; fileName?: string }
  | { type: 'TOAST'; message: string };
export interface PlayerEnvelope {
  type: 'WEB_PLAYER_MESSAGE'; session: string; documentId: string; payload: PageMessage;
}
