import type { SyncCommand } from '../contracts';

/** bwp-video and site adapters expose the same media operations as native video. */

/** DOM and site adapters share this intentionally small control surface. */
export interface Player {
  element?: HTMLVideoElement;
  isPlatformAdapter: boolean;
  controlOwner?: ControlOwner | VideoJsPlayer;
  controlSource?: string;
  canSeek?: boolean;
  currentTime: number;
  duration: number;
  paused: boolean;
  readyState?: number;
  seeking?: boolean;
  playbackRate: number;
  play(): Promise<void> | void;
  pause(): void;
  seek(time: number): void;
}
export interface ControlOwner {
  __ykControlId?: string;
  __ykControlEpoch?: number;
  currentSrc?: string;
  src?: string;
  seekable?: TimeRanges;
  readyState?: number;
  error?: MediaError | null;
  addEventListener?: (type: string, listener: () => void) => void;
}

/** Observed third-party APIs: these declarations do not assert their presence. */
interface TencentPlayer extends ControlOwner {
  corePlayer?: { play(): Promise<void> | void; pause(): void; paused?: boolean };
  currentVideoInfo?: { vid?: string; title?: string; playtime?: number; duration?: number };
  paused?: boolean;
  playbackRate?: number;
  seek?: (time: number) => void;
  setPlaybackRate?: (rate: number) => void;
}
interface VideoJsPlayer extends Omit<ControlOwner, 'currentSrc' | 'readyState'> {
  currentTime(time?: number): number;
  currentSrc?(): string;
  duration(): number;
  paused(): boolean;
  readyState?(): number;
  seeking?(): boolean;
  playbackRate(rate?: number): number;
  play(): Promise<void> | void;
  pause(): void;
}
interface RuleResult<T> { status: string; value?: T }

declare global {
  interface Window {
    ReactNativeWebView: { postMessage(message: string): void };
    __YIQIKAN_EARLY_INJECTED?: boolean;
    __YIQIKAN_INJECTED?: boolean;
    __canNavigate?: boolean;
    __isHost?: boolean;
    __followSyncEnabled?: boolean;
    __lastUserTouchTime?: number;
    __lastFoundIframe?: string;
    _lastUpdate?: number;
    __yiqikanInactiveFrame?: boolean;
    __yiqikanScanSameOriginFrames?: boolean;
    __yiqikanSelectedVideo?: HTMLVideoElement;
    __yiqikanCurrentVideo?: () => HTMLVideoElement | null | undefined;
    __yiqikanIsVideoCandidate?: (video: HTMLVideoElement) => boolean;
    __yiqikanResumeInGesture?: () => void;
    __resetVideoSync: (preserveHostSeek?: boolean) => void;
    __syncCmd: (command: SyncCommand) => void;
    __queryRealtimeStatus: (queryId?: number) => void;
    __yiqikanPlayer?: { fullscreen(enabled: boolean): boolean; nativeControls?(enabled: boolean): void };
    __yiqikanSiteRules?: {
      playbackPage(): RuleResult<{ title?: string }>;
      title(): RuleResult<string>;
      mediaCandidates(): RuleResult<HTMLVideoElement>;
    };
    __PLAYER__?: TencentPlayer;
    Element: typeof Element;
    HTMLMediaElement: typeof HTMLMediaElement;
    HTMLVideoElement: typeof HTMLVideoElement;
  }
  interface HTMLVideoElement extends ControlOwner {
    __inlineSet?: boolean;
    __yiqikan_hooked?: boolean;
    __yiqikanBuffering?: boolean;
    VideoTogetherDisabled?: boolean;
    webkitPlaysInline?: boolean;
    webkitEnterFullscreen?: () => void | Promise<void>;
    webkitExitFullscreen?: () => void | Promise<void>;
  }
  interface Element { webkitRequestFullscreen?: () => Promise<void>; player?: VideoJsPlayer }
  interface Document { webkitExitFullscreen?: () => Promise<void> }
}
