/**
 * Webview preload — thin relay layer (shell-stable).
 *
 * Responsibilities:
 *   - Scan for video elements and report status to renderer via ipcRenderer.sendToHost
 *   - Execute sync commands received from renderer (seek / play / pause / rate)
 *   - Relay fullscreen state changes to main process
 *   - Forward popup/URL open requests to renderer
 *   - Apply volume commands to video elements
 *   - Forward play/pause attempts by the user to renderer for decision
 *
 * NO decision logic lives here. All policy (member blocking, host mode,
 * local-pause gating, sync-intent windows) lives in the renderer hooks
 * so it can be hot-updated without a shell release.
 */
import { ipcRenderer } from "electron";

// Patch browser fingerprint to avoid bot detection
try {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
} catch { /* ignore */ }
try {
  if (!(window as any).chrome) {
    (window as any).chrome = { runtime: {} };
  }
} catch { /* ignore */ }

const IS_TOP = window.self === window.top;
const VIDEO_TAGS = ["video", "bwp-video"];
const MSG_SOURCE_CHILD = "yiqikan-child-video";
const MSG_SOURCE_SYNC = "yiqikan-sync-cmd";
const MSG_SOURCE_FULLSCREEN = "yiqikan-fullscreen-change";
const MSG_SOURCE_EXIT_FULLSCREEN = "yiqikan-exit-fullscreen";
const MSG_SOURCE_HOST_MODE_REQUEST = "yiqikan-request-host-mode";
const VIDEO_SCAN_INTERVAL_PLAYING_MS = 2500;
const VIDEO_SCAN_INTERVAL_PAUSED_MS = 5000;
const VIDEO_SCAN_INTERVAL_RECENT_IDLE_MS = 5000;
const VIDEO_SCAN_INTERVAL_IDLE_MS = 8000;
const VIDEO_SCAN_INTERVAL_HIDDEN_MS = 12000;
const CHILD_FORWARD_INTERVAL_ACTIVE_MS = 4000;
const CHILD_FORWARD_INTERVAL_IDLE_MS = 7000;
const CHILD_FORWARD_INTERVAL_HIDDEN_MS = 10000;
const FULLSCREEN_TRANSITION_SUPPRESS_MS = 1200;
const MAX_VIDEO_BOOST_GAIN = 8;
const VOLUME_TAGS = ["video", "audio", "bwp-video"];

type MediaBoostState = {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};

const mediaBoostStates = new WeakMap<HTMLMediaElement, MediaBoostState>();
let currentVolumeLevel = 1;

function volumeLevelToGain(level: number): number {
  const clamped = Math.max(0, Math.min(MAX_VIDEO_BOOST_GAIN, level));
  if (clamped <= 1) return clamped;
  const normalized = (clamped - 1) / (MAX_VIDEO_BOOST_GAIN - 1);
  return Math.pow(MAX_VIDEO_BOOST_GAIN, normalized);
}

/* ------------------------------------------------------------------ */
/*  Popup / URL interception                                            */
/* ------------------------------------------------------------------ */

function forwardUrl(url: string): void {
  if (!url || url.startsWith("about:blank") || url.startsWith("javascript:")) return;
  const resolved = url.startsWith("//") ? `https:${url}` : url;
  if (IS_TOP) { ipcRenderer.sendToHost("yiqikan:open-url", { url: resolved }); return; }
  try { window.top!.postMessage({ source: "yiqikan-open-url", payload: { url: resolved } }, "*"); } catch {
    try { window.parent.postMessage({ source: "yiqikan-open-url", payload: { url: resolved } }, "*"); } catch { /* ignore */ }
  }
}

function handlePotentialBlankClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return;
  const blankLike = anchor.target === "_blank" || anchor.rel.includes("noopener") || anchor.rel.includes("noreferrer");
  if (!anchor.href || !blankLike) return;
  event.preventDefault();
  event.stopPropagation();
  forwardUrl(anchor.href);
}
try { document.addEventListener("click", handlePotentialBlankClick, true); } catch { /* ignore */ }

/* ------------------------------------------------------------------ */
/*  Platform Adapters & Universal Player Interface                      */
/* ------------------------------------------------------------------ */

interface UniversalPlayer {
  readonly element?: HTMLVideoElement;
  readonly isPlatformAdapter?: boolean;
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  readyState: number;
  play(): Promise<void> | void;
  pause(): void;
  seek(time: number): void;
}

function getCleanVideoTitle(): string {
  try {
    let title = document.title || "";
    title = title
      .replace(/_哔哩哔哩_bilibili.*$/i, "")
      .replace(/- 腾讯视频.*$/i, "")
      .replace(/- 优酷.*$/i, "")
      .replace(/- 爱奇艺.*$/i, "")
      .replace(/_芒果TV.*$/i, "")
      .replace(/- YouTube.*$/i, "")
      .replace(/【[^】]*】/g, "")
      .trim();
    if (title.length > 40) {
      title = title.slice(0, 40) + "...";
    }
    return title || "当前视频";
  } catch {
    return "当前视频";
  }
}

function getTencentPlayerWrapper(): UniversalPlayer | null {
  try {
    const playerObj = (window as any).__PLAYER__;
    if (playerObj && playerObj.corePlayer && playerObj.currentVideoInfo) {
      return {
        isPlatformAdapter: true,
        get currentTime() { return Number(playerObj.currentVideoInfo?.playtime || 0); },
        set currentTime(val: number) { playerObj.seek?.(val); },
        get duration() { return Number(playerObj.currentVideoInfo?.duration || 0); },
        get paused() { return Boolean(playerObj.paused ?? playerObj.corePlayer?.paused); },
        get playbackRate() { return Number(playerObj.playbackRate || 1); },
        set playbackRate(r: number) { if (playerObj.setPlaybackRate) playerObj.setPlaybackRate(r); else playerObj.playbackRate = r; },
        get readyState() { return 4; },
        play: () => playerObj.corePlayer.play(),
        pause: () => playerObj.corePlayer.pause(),
        seek: (time: number) => playerObj.seek?.(time),
      };
    }
  } catch { /* ignore */ }
  return null;
}

function getBaiduPanPlayerWrapper(): UniversalPlayer | null {
  try {
    if (window.location.host.includes("pan.baidu.com")) {
      const vjs = (document.querySelector(".vjs-controls-enabled") as any)?.player;
      if (vjs && typeof vjs.currentTime === "function") {
        return {
          isPlatformAdapter: true,
          get currentTime() { return Number(vjs.currentTime() || 0); },
          set currentTime(val: number) { vjs.currentTime(val); },
          get duration() { return Number(vjs.duration() || 0); },
          get paused() { return Boolean(vjs.paused()); },
          get playbackRate() { return Number(vjs.playbackRate() || 1); },
          set playbackRate(r: number) { vjs.playbackRate(r); },
          get readyState() { return vjs.readyState ? vjs.readyState() : 4; },
          play: () => vjs.play(),
          pause: () => vjs.pause(),
          seek: (time: number) => vjs.currentTime(time),
        };
      }
    }
  } catch { /* ignore */ }
  return null;
}

function wrapVideoElement(v: HTMLVideoElement): UniversalPlayer {
  return {
    element: v,
    isPlatformAdapter: false,
    get currentTime() { return v.currentTime || 0; },
    set currentTime(val: number) { v.currentTime = val; },
    get duration() { return v.duration || 0; },
    get paused() { return v.paused; },
    get playbackRate() { return v.playbackRate || 1; },
    set playbackRate(r: number) { try { v.playbackRate = r; } catch {} },
    get readyState() { return v.readyState || 0; },
    play: () => v.play(),
    pause: () => v.pause(),
    seek: (time: number) => { v.currentTime = time; },
  };
}

function isAdOrThumbnailVideo(v: HTMLVideoElement): boolean {
  try {
    if ((v as any).VideoTogetherDisabled) return true;

    const hostname = window.location.hostname.toLowerCase();

    // 1. Bilibili feed cards & sidebar thumbnails
    if (hostname.endsWith("bilibili.com")) {
      if (v.closest("div.video-page-card-small") || v.closest("div.feed-card") || v.closest(".bili-video-card__stats")) {
        return true;
      }
    }

    // 2. iQiyi ad countdown layer
    if (hostname.endsWith("iqiyi.com")) {
      const cdTimes = document.querySelectorAll(".cd-time");
      for (let i = 0; i < cdTimes.length; i++) {
        if ((cdTimes[i] as HTMLElement).offsetParent !== null) {
          if (v.duration && v.duration < 120 && !v.closest(".iqp-player-videolayer-inner")) {
            return true;
          }
        }
      }
    }

    // 3. Tencent Video creative ad control layer
    if (hostname.endsWith("v.qq.com")) {
      const adCtrls = document.querySelectorAll('.txp_ad_control:not(.txp_none)[data-role="creative-player-video-ad-control"]');
      if (adCtrls.length > 0 && v.duration && v.duration < 120) {
        return true;
      }
    }

    // 4. Youku ad layer
    if (hostname.endsWith("youku.com")) {
      if (document.querySelector(".advertise-layer div") && v.duration && v.duration < 120) {
        return true;
      }
    }

    // 5. Very short video or tiny background loops (< 5s and small area)
    if (v.duration && v.duration < 5 && (v.offsetWidth < 60 || v.offsetHeight < 60)) {
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

function calculateVideoScore(v: HTMLVideoElement): number {
  if (isAdOrThumbnailVideo(v)) return -1000;

  let score = 0;
  const duration = v.duration || 0;

  // Duration weighting: prioritize full-length videos (> 10 min)
  if (isFinite(duration) && duration > 0) {
    score += Math.min(duration, 7200) / 10;
  }

  // Visual area weighting
  const width = v.offsetWidth || 0;
  const height = v.offsetHeight || 0;
  if (width >= 100 && height >= 60) {
    score += (width * height) / 2000;
  }

  // Active status weighting
  if (!v.paused && v.currentTime > 0.3) score += 300;
  if (v.readyState >= 2) score += 200;

  // Site-specific priority element boost
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.endsWith("iqiyi.com") && v.closest(".iqp-player-videolayer-inner")) {
    score += 2000;
  }

  return score;
}

function findBestPlayerInFrame(): UniversalPlayer | null {
  // 1. Check specialized platform player wrappers
  const tencent = getTencentPlayerWrapper();
  if (tencent) return tencent;

  const baidu = getBaiduPanPlayerWrapper();
  if (baidu) return baidu;

  // 2. Scan standard HTMLVideoElement in DOM
  let best: HTMLVideoElement | null = null;
  let bestScore = -1;

  for (const tag of VIDEO_TAGS) {
    const elements = document.getElementsByTagName(tag);
    for (let i = 0; i < elements.length; i++) {
      const v = elements[i] as HTMLVideoElement;
      const score = calculateVideoScore(v);
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
  }

  return best ? wrapVideoElement(best) : null;
}

function findBestVideoInFrame(): HTMLVideoElement | null {
  const p = findBestPlayerInFrame();
  return p?.element || null;
}

try {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i] as HTMLElement;
        if (!node.tagName) continue;
        const tag = node.tagName.toUpperCase();
        if (tag === "VIDEO" || tag === "AUDIO" || tag === "BWP-VIDEO") {
          applyVolumeToVideos(currentVolumeLevel);
          forceReport();
          scheduleNextReport(800);
          return;
        }
        try {
          if (node.querySelectorAll?.("video, audio, bwp-video")?.length) {
            applyVolumeToVideos(currentVolumeLevel);
            forceReport();
            scheduleNextReport(800);
            return;
          }
        } catch { /* ignore */ }
      }
    }
  });
  const target = document.documentElement || document.body;
  if (target) { observer.observe(target, { childList: true, subtree: true }); }
  else { document.addEventListener("DOMContentLoaded", () => { observer.observe(document.documentElement, { childList: true, subtree: true }); }, { once: true }); }
} catch { /* ignore */ }

/* ------------------------------------------------------------------ */
/*  Reporting                                                           */
/* ------------------------------------------------------------------ */

function buildStatus(p: UniversalPlayer) {
  return {
    found: true,
    currentTime: p.currentTime || 0,
    duration: p.duration || 0,
    paused: p.paused,
    playbackRate: p.playbackRate || 1,
    readyState: p.readyState || 0,
    videoTitle: getCleanVideoTitle(),
    localTimestamp: Date.now() / 1000,
  };
}

let lastReportKey = "";
let lastReportTs = 0;
let lastVideoFoundAt = 0;
let reportTimer: number | null = null;
let fullscreenTransitionUntil = 0;

function postMessageToChildFrames(message: unknown): void {
  const iframes = document.getElementsByTagName("iframe");
  for (let i = 0; i < iframes.length; i++) {
    try { iframes[i].contentWindow!.postMessage(message, "*"); } catch { /* ignore */ }
  }
}

function exitFullscreenInThisFrame(): void {
  try { if (document.fullscreenElement) void document.exitFullscreen(); } catch { /* ignore */ }
}

function relayFullscreenState(active: boolean): void {
  if (IS_TOP) { ipcRenderer.send("yiqikan:html-full-screen-request", { active }); return; }
  try { window.top!.postMessage({ source: MSG_SOURCE_FULLSCREEN, active }, "*"); } catch {
    try { window.parent.postMessage({ source: MSG_SOURCE_FULLSCREEN, active }, "*"); } catch { /* ignore */ }
  }
}

function requestHostModeFromTop(): void {
  if (IS_TOP) return;
  try { window.top!.postMessage({ source: MSG_SOURCE_HOST_MODE_REQUEST }, "*"); } catch {
    try { window.parent.postMessage({ source: MSG_SOURCE_HOST_MODE_REQUEST }, "*"); } catch { /* ignore */ }
  }
}

function reportFromThisFrame(force = false): void {
  const now = Date.now();
  if (now < fullscreenTransitionUntil) return;
  const player = findBestPlayerInFrame();
  if (!player) return;
  lastVideoFoundAt = now;
  const status = buildStatus(player);
  const key = `${status.paused}|${status.playbackRate}|${Math.floor(status.currentTime)}`;
  const heartbeatInterval = status.paused ? 4000 : 2000;
  if (!force && key === lastReportKey && now - lastReportTs < heartbeatInterval) return;
  lastReportKey = key;
  lastReportTs = now;
  if (IS_TOP) { ipcRenderer.sendToHost("yiqikan:video-status", status); return; }
  try { window.top!.postMessage({ source: MSG_SOURCE_CHILD, status }, "*"); } catch {
    try { window.parent.postMessage({ source: MSG_SOURCE_CHILD, status }, "*"); } catch { /* ignore */ }
  }
}

function forceReport(): void { lastReportKey = ""; lastReportTs = 0; reportFromThisFrame(true); }

function getNextReportDelay(): number {
  if (document.hidden) return VIDEO_SCAN_INTERVAL_HIDDEN_MS;
  const p = findBestPlayerInFrame();
  if (p) return p.paused ? VIDEO_SCAN_INTERVAL_PAUSED_MS : VIDEO_SCAN_INTERVAL_PLAYING_MS;
  const idleFor = Date.now() - lastVideoFoundAt;
  return idleFor < 15000 ? VIDEO_SCAN_INTERVAL_RECENT_IDLE_MS : VIDEO_SCAN_INTERVAL_IDLE_MS;
}

function scheduleNextReport(delay = getNextReportDelay()): void {
  if (reportTimer) window.clearTimeout(reportTimer);
  reportTimer = window.setTimeout(() => { reportFromThisFrame(); scheduleNextReport(); }, delay);
}

scheduleNextReport(1200);
document.addEventListener("visibilitychange", () => { scheduleNextReport(document.hidden ? VIDEO_SCAN_INTERVAL_HIDDEN_MS : 500); });
document.addEventListener("fullscreenchange", () => {
  fullscreenTransitionUntil = Date.now() + FULLSCREEN_TRANSITION_SUPPRESS_MS;
  relayFullscreenState(!!document.fullscreenElement);
  scheduleNextReport(600);
}, true);

for (const evt of ["play", "pause", "seeked", "ratechange"]) {
  document.addEventListener(evt, (e) => {
    const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
    if (tag === "VIDEO" || tag === "BWP-VIDEO") { forceReport(); scheduleNextReport(800); }
  }, true);
}
for (const evt of ["loadeddata", "canplay"]) {
  document.addEventListener(evt, (e) => {
    const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
    if (tag === "VIDEO" || tag === "BWP-VIDEO") { reportFromThisFrame(true); scheduleNextReport(1000); }
  }, true);
}
setTimeout(forceReport, 500);
setTimeout(forceReport, 2000);
setTimeout(forceReport, 5000);
setTimeout(forceReport, 10000);

/* ------------------------------------------------------------------ */
/*  User play/pause intent forwarding (top frame only)                  */
/*                                                                      */
/*  Preload does NOT decide whether to allow/block — it just reports    */
/*  the intent to the renderer via sendToHost, then waits for a         */
/*  yiqikan:force-pause command back if the renderer wants to block.    */
/* ------------------------------------------------------------------ */

// Track whether a play/pause was initiated by a sync command so we
// don't re-report it as a user intent.
let syncInProgressUntil = 0;

document.addEventListener("play", (e) => {
  if (!IS_TOP) return;
  if (Date.now() < fullscreenTransitionUntil) return;
  if (Date.now() < syncInProgressUntil) return;
  const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
  if (tag !== "VIDEO" && tag !== "BWP-VIDEO") return;
  ipcRenderer.sendToHost("yiqikan:play-attempt");
}, true);

document.addEventListener("pause", (e) => {
  if (!IS_TOP) return;
  if (Date.now() < fullscreenTransitionUntil) return;
  if (Date.now() < syncInProgressUntil) return;
  const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
  if (tag !== "VIDEO" && tag !== "BWP-VIDEO") return;
  ipcRenderer.sendToHost("yiqikan:pause-attempt");
}, true);

// Intercept click/keydown only to forward navigation-block to renderer
// (no play/pause blocking here — that's renderer's job via force-pause)
document.addEventListener("click", (e) => {
  if (!IS_TOP) return;
  const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return;
  const href = anchor.href?.trim();
  if (!href || href.startsWith("javascript:") || href.startsWith("about:blank")) return;
  // Forward to renderer to decide whether to block
  ipcRenderer.sendToHost("yiqikan:navigation-attempt", { url: href });
}, true);

/* ------------------------------------------------------------------ */
/*  Commands from renderer                                              */
/* ------------------------------------------------------------------ */

ipcRenderer.on("yiqikan:exit-html-full-screen", () => {
  if (!IS_TOP) return;
  fullscreenTransitionUntil = Date.now() + FULLSCREEN_TRANSITION_SUPPRESS_MS;
  exitFullscreenInThisFrame();
  postMessageToChildFrames({ source: MSG_SOURCE_EXIT_FULLSCREEN });
});

ipcRenderer.on("yiqikan:force-pause", () => {
  if (!IS_TOP) return;
  const player = findBestPlayerInFrame();
  try { player?.pause(); } catch { /* ignore */ }
  postMessageToChildFrames({ source: "yiqikan-force-pause" });
});

ipcRenderer.on("yiqikan:video-sync", (_event, cmd) => {
  if (!IS_TOP) return;
  syncInProgressUntil = Date.now() + 800;
  applySyncToVideo(cmd);
});

ipcRenderer.on("yiqikan:set-volume", (_event, data) => {
  if (!IS_TOP) return;
  const vol = data?.volume ?? 1;
  applyVolumeToVideos(vol);
  const iframes = document.getElementsByTagName("iframe");
  for (let i = 0; i < iframes.length; i++) {
    try { iframes[i].contentWindow!.postMessage({ source: "yiqikan-set-volume", volume: vol }, "*"); } catch { /* cross-origin */ }
  }
});

/* ------------------------------------------------------------------ */
/*  Top frame: aggregate child reports + handle sync cmds              */
/* ------------------------------------------------------------------ */

let childVideoStatus: any = null;
let childVideoTimestamp = 0;
let childForwardTimer: number | null = null;

function getNextChildForwardDelay(): number {
  if (document.hidden) return CHILD_FORWARD_INTERVAL_HIDDEN_MS;
  return childVideoStatus && Date.now() - childVideoTimestamp < 5000
    ? CHILD_FORWARD_INTERVAL_ACTIVE_MS
    : CHILD_FORWARD_INTERVAL_IDLE_MS;
}

function scheduleChildForward(delay = getNextChildForwardDelay()): void {
  if (childForwardTimer) window.clearTimeout(childForwardTimer);
  childForwardTimer = window.setTimeout(() => {
    const topPlayer = findBestPlayerInFrame();
    if (!topPlayer && childVideoStatus && Date.now() - childVideoTimestamp < 5000) {
      const key = `child|${childVideoStatus.paused}|${childVideoStatus.playbackRate}|${Math.floor(childVideoStatus.currentTime)}`;
      if (key !== lastReportKey) { lastReportKey = key; ipcRenderer.sendToHost("yiqikan:video-status", childVideoStatus); }
    }
    if (!topPlayer && (!childVideoStatus || Date.now() - childVideoTimestamp > 8000)) {
      if (lastReportKey !== "none") { lastReportKey = "none"; ipcRenderer.sendToHost("yiqikan:video-status", { found: false }); }
    }
    scheduleChildForward();
  }, delay);
}

window.addEventListener("message", (event) => {
  if (!IS_TOP) return;

  const src = event.data?.source;

  if (src === MSG_SOURCE_CHILD) {
    const s = event.data.status;
    if (!s?.found) return;
    childVideoStatus = s;
    childVideoTimestamp = Date.now();
    const topPlayer = findBestPlayerInFrame();
    if (!topPlayer || (topPlayer.duration || 0) < (s.duration || 0)) ipcRenderer.sendToHost("yiqikan:video-status", s);
    scheduleChildForward(1200);
    return;
  }
  if (src === "yiqikan-open-url") { forwardUrl(event.data?.payload?.url); return; }
  if (src === MSG_SOURCE_FULLSCREEN) {
    fullscreenTransitionUntil = Date.now() + FULLSCREEN_TRANSITION_SUPPRESS_MS;
    ipcRenderer.send("yiqikan:html-full-screen-request", { active: !!event.data.active });
    return;
  }
  if (src === MSG_SOURCE_HOST_MODE_REQUEST) {
    // Subframes ask for host mode — relay back what renderer told us
    try { (event.source as WindowProxy | null)?.postMessage({ source: "yiqikan-set-host-mode", isHost: currentHostMode }, "*"); } catch { /* ignore */ }
    return;
  }
  if (src === "yiqikan-member-blocked") {
    ipcRenderer.sendToHost("yiqikan:member-blocked-action");
    return;
  }
});

scheduleChildForward(CHILD_FORWARD_INTERVAL_IDLE_MS);
document.addEventListener("visibilitychange", () => { scheduleChildForward(document.hidden ? CHILD_FORWARD_INTERVAL_HIDDEN_MS : 1000); });
setTimeout(requestHostModeFromTop, 0);
setTimeout(requestHostModeFromTop, 800);

/* ------------------------------------------------------------------ */
/*  Apply sync command                                                  */
/* ------------------------------------------------------------------ */

// Host mode is still tracked here so subframes can be informed,
// but the DECISION of whether to block/allow is made in the renderer.
let currentHostMode = true;

ipcRenderer.on("yiqikan:set-host-mode", (_event, val: boolean) => {
  if (!IS_TOP) return;
  currentHostMode = val;
  postMessageToChildFrames({ source: "yiqikan-set-host-mode", isHost: val });
});

let smoothRateTimer: number | null = null;

function applySyncToVideo(cmd: any): void {
  const player = findBestPlayerInFrame();
  if (!player) {
    postMessageToChildFrames({ source: MSG_SOURCE_SYNC, cmd });
    return;
  }

  const nextSyncId = typeof cmd.syncId === "number" ? cmd.syncId : 0;
  const nextTimestamp = typeof cmd.localTimestamp === "number" ? cmd.localTimestamp : 0;
  const lastSyncId = typeof (window as any).__yiqikan_last_sync_id === "number" ? (window as any).__yiqikan_last_sync_id : 0;
  const lastSyncTimestamp = typeof (window as any).__yiqikan_last_sync_ts === "number" ? (window as any).__yiqikan_last_sync_ts : 0;

  if (nextSyncId > 0 && nextSyncId < lastSyncId) return;
  if (nextSyncId === lastSyncId && nextTimestamp > 0 && nextTimestamp <= lastSyncTimestamp) return;
  if (nextSyncId === 0 && lastSyncId > 0 && nextTimestamp > 0 && nextTimestamp <= lastSyncTimestamp) return;
  (window as any).__yiqikan_last_sync_id = Math.max(lastSyncId, nextSyncId);
  (window as any).__yiqikan_last_sync_ts = Math.max(lastSyncTimestamp, nextTimestamp);

  const baseRate = typeof cmd.playbackRate === "number" ? cmd.playbackRate : 1;

  if (typeof cmd.currentTime === "number") {
    let target = cmd.currentTime;
    if (!cmd.paused && typeof cmd.localTimestamp === "number") {
      const elapsed = Date.now() / 1000 - cmd.localTimestamp;
      if (elapsed > 0 && elapsed < 10) {
        target += elapsed * baseRate;
      }
    }

    const current = player.currentTime;
    const diff = target - current;
    const absDiff = Math.abs(diff);

    if (cmd.paused || absDiff > 1.8) {
      // Hard seek for large time gaps or when paused
      if (absDiff > 0.05) {
        player.seek(target);
      }
      if (smoothRateTimer) {
        window.clearTimeout(smoothRateTimer);
        smoothRateTimer = null;
      }
      player.playbackRate = baseRate;
    } else if (absDiff > 0.35 && !player.paused) {
      // Smooth catchup via micro-rate adjustment (e.g. 1.06x / 0.94x) without audio/video stutter
      const rateMultiplier = diff > 0 ? 1.06 : 0.94;
      const temporaryRate = Math.max(0.25, Math.min(4, baseRate * rateMultiplier));
      player.playbackRate = temporaryRate;

      if (smoothRateTimer) window.clearTimeout(smoothRateTimer);
      // Restore normal base rate after catchup duration (~1.5s)
      smoothRateTimer = window.setTimeout(() => {
        const p = findBestPlayerInFrame();
        if (p) p.playbackRate = baseRate;
        smoothRateTimer = null;
      }, 1500);
    } else if (absDiff <= 0.35) {
      // Already in sync! Restore base rate if temporary rate was active
      if (smoothRateTimer) {
        window.clearTimeout(smoothRateTimer);
        smoothRateTimer = null;
      }
      if (player.playbackRate !== baseRate) {
        player.playbackRate = baseRate;
      }
    }
  }

  if (typeof cmd.paused === "boolean") {
    if (cmd.paused && !player.paused) {
      player.pause();
    } else if (!cmd.paused && cmd.allowResume) {
      const p = player.play();
      if (p && typeof (p as any).catch === "function") {
        (p as any).catch(() => {});
      }
    }
  }

  if (typeof cmd.playbackRate === "number" && !smoothRateTimer) {
    if (player.playbackRate !== cmd.playbackRate) {
      player.playbackRate = cmd.playbackRate;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Volume control                                                      */
/* ------------------------------------------------------------------ */

function applyVolumeToVideos(vol: number): void {
  currentVolumeLevel = Math.max(0, Math.min(MAX_VIDEO_BOOST_GAIN, vol));
  for (const tag of VOLUME_TAGS) {
    const elements = document.getElementsByTagName(tag);
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as HTMLMediaElement;
      if (!(el instanceof HTMLMediaElement)) {
        try { (el as HTMLMediaElement).volume = Math.max(0, Math.min(1, vol)); } catch { /* ignore */ }
        continue;
      }

      if (currentVolumeLevel <= 1) {
        const boost = mediaBoostStates.get(el);
        if (boost) {
          try { boost.gain.gain.setTargetAtTime(1, boost.ctx.currentTime, 0.03); } catch { /* ignore */ }
        }
        try { el.volume = currentVolumeLevel; } catch { /* ignore */ }
        continue;
      }

      try { el.volume = 1; } catch { /* ignore */ }

      let boost = mediaBoostStates.get(el);
      if (!boost) {
        try {
          const ctx = new AudioContext();
          const source = ctx.createMediaElementSource(el);
          const gain = ctx.createGain();
          gain.gain.value = volumeLevelToGain(currentVolumeLevel);
          source.connect(gain);
          gain.connect(ctx.destination);
          boost = { ctx, source, gain };
          mediaBoostStates.set(el, boost);
        } catch {
          try { el.volume = 1; } catch { /* ignore */ }
          continue;
        }
      } else {
        try { boost.gain.gain.setTargetAtTime(volumeLevelToGain(currentVolumeLevel), boost.ctx.currentTime, 0.03); } catch { /* ignore */ }
      }

      if (boost.ctx.state === "suspended") {
        void boost.ctx.resume().catch(() => {});
      }
    }
  }
}

window.addEventListener("message", (event) => {
  if (event.data?.source !== "yiqikan-set-volume") return;
  const vol = Math.max(0, Math.min(1, event.data.volume || 1));
  applyVolumeToVideos(vol);
  postMessageToChildFrames({ source: "yiqikan-set-volume", volume: vol });
});
