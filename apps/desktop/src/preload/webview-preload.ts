/**
 * Webview preload — runs in the webview's top frame.
 *
 * All sync decision logic lives here (top frame only).
 * Subframes only execute commands and report video status upward.
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
const MSG_SOURCE_OPEN_URL = "yiqikan-open-url";
const MSG_SOURCE_FULLSCREEN = "yiqikan-fullscreen-change";
const MSG_SOURCE_EXIT_FULLSCREEN = "yiqikan-exit-fullscreen";
const MSG_SOURCE_HOST_MODE_REQUEST = "yiqikan-request-host-mode";
const MSG_SOURCE_PLAY_EVENT = "yiqikan-play-event";
const VIDEO_SCAN_INTERVAL_PLAYING_MS = 2500;
const VIDEO_SCAN_INTERVAL_PAUSED_MS = 5000;
const VIDEO_SCAN_INTERVAL_RECENT_IDLE_MS = 5000;
const VIDEO_SCAN_INTERVAL_IDLE_MS = 8000;
const VIDEO_SCAN_INTERVAL_HIDDEN_MS = 12000;
const CHILD_FORWARD_INTERVAL_ACTIVE_MS = 4000;
const CHILD_FORWARD_INTERVAL_IDLE_MS = 7000;
const CHILD_FORWARD_INTERVAL_HIDDEN_MS = 10000;
const FULLSCREEN_TRANSITION_SUPPRESS_MS = 1200;
const MEMBER_SYNC_INTENT_PAUSE_MS = 1500;
const MEMBER_SYNC_INTENT_RESUME_MS = 6000;
const AUTHORITATIVE_SYNC_EVENT_WINDOW_MS = 5000;

/* ------------------------------------------------------------------ */
/*  Popup interception                                                  */
/* ------------------------------------------------------------------ */

function forwardOpenUrl(payload: { url: string; source: string; target?: string | null }): void {
  if (!payload.url || payload.url.startsWith("about:blank") || payload.url.startsWith("javascript:")) return;
  // Only forward genuine popup windows (target="_blank" or window.open with explicit target)
  // Don't forward same-page navigations that sites use internally
  if (payload.source === "window.open" && (!payload.target || payload.target === "_self" || payload.target === "_top" || payload.target === "_parent")) return;
  if (IS_TOP) { ipcRenderer.sendToHost("yiqikan:open-url", payload); return; }
  try { window.top!.postMessage({ source: MSG_SOURCE_OPEN_URL, payload }, "*"); } catch {
    try { window.parent.postMessage({ source: MSG_SOURCE_OPEN_URL, payload }, "*"); } catch { /* ignore */ }
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
  forwardOpenUrl({ url: anchor.href, source: "anchor-click", target: anchor.target });
}
try { document.addEventListener("click", handlePotentialBlankClick, true); } catch { /* ignore */ }

try {
  const nativeWindowOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const nextUrl = typeof url === "string" ? url : url?.toString?.() ?? "";
    // Only intercept genuine popup windows (new tab/window), not same-frame navigations
    const isPopup = target && target !== "_self" && target !== "_top" && target !== "_parent";
    if (nextUrl && !nextUrl.startsWith("about:blank") && isPopup) {
      forwardOpenUrl({ url: nextUrl, source: "window.open", target: target ?? null });
      return null;
    }
    return nativeWindowOpen(url as string | undefined, target, features);
  }) as typeof window.open;
} catch { /* ignore */ }

/* ------------------------------------------------------------------ */
/*  Video scanning                                                      */
/* ------------------------------------------------------------------ */

function findBestVideoInFrame(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestScore = -1;
  for (const tag of VIDEO_TAGS) {
    const elements = document.getElementsByTagName(tag);
    for (let i = 0; i < elements.length; i++) {
      const v = elements[i] as HTMLVideoElement;
      try {
        if ((v as any).VideoTogetherDisabled) continue;
        if (window.location.hostname.endsWith("bilibili.com")) {
          if (v.closest("div.video-page-card-small") || v.closest("div.feed-card")) continue;
        }
      } catch { /* ignore */ }
      let score = (v.duration || 0);
      if (v.offsetWidth >= 100 && v.offsetHeight >= 60) score += (v.offsetWidth * v.offsetHeight) / 1e4;
      if (v.readyState >= 2) score += 500;
      if (score > bestScore) { bestScore = score; best = v; }
    }
  }
  return best;
}

try {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i] as HTMLElement;
        if (!node.tagName) continue;
        const tag = node.tagName.toUpperCase();
        if (tag === "VIDEO" || tag === "BWP-VIDEO") { forceReport(); scheduleNextReport(800); return; }
        try { if (node.querySelectorAll?.("video, bwp-video")?.length) { forceReport(); scheduleNextReport(800); return; } } catch { /* ignore */ }
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

function buildStatus(v: HTMLVideoElement) {
  return { found: true, currentTime: v.currentTime || 0, duration: v.duration || 0, paused: v.paused, playbackRate: v.playbackRate || 1, readyState: v.readyState || 0, localTimestamp: Date.now() / 1000 };
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
  const v = findBestVideoInFrame();
  if (!v) return;
  lastVideoFoundAt = now;
  const status = buildStatus(v);
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
  const v = findBestVideoInFrame();
  if (v) return v.paused ? VIDEO_SCAN_INTERVAL_PAUSED_MS : VIDEO_SCAN_INTERVAL_PLAYING_MS;
  const idleFor = Date.now() - lastVideoFoundAt;
  return idleFor < 15000 ? VIDEO_SCAN_INTERVAL_RECENT_IDLE_MS : VIDEO_SCAN_INTERVAL_IDLE_MS;
}

function scheduleNextReport(delay = getNextReportDelay()): void {
  if (reportTimer) window.clearTimeout(reportTimer);
  reportTimer = window.setTimeout(() => { reportFromThisFrame(); scheduleNextReport(); }, delay);
}

scheduleNextReport(1200);
document.addEventListener("visibilitychange", () => { scheduleNextReport(document.hidden ? VIDEO_SCAN_INTERVAL_HIDDEN_MS : 500); });
document.addEventListener("fullscreenchange", () => { fullscreenTransitionUntil = Date.now() + FULLSCREEN_TRANSITION_SUPPRESS_MS; relayFullscreenState(!!document.fullscreenElement); scheduleNextReport(600); }, true);

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
/*  Top-frame state & decision logic                                    */
/* ------------------------------------------------------------------ */

let isHostMode = true;
let memberLocalPause = false;
let memberSyncIntent: { paused: boolean; until: number } | null = null;
let authoritativePlaybackPaused: boolean | null = null;
let authoritativeSyncEvent: { paused: boolean; until: number } | null = null;
let memberManualPauseUntil = 0;
let memberManualResumeUntil = 0;

function markMemberSyncIntent(paused: boolean): void {
  if (isHostMode) return;
  memberSyncIntent = { paused, until: Date.now() + (paused ? MEMBER_SYNC_INTENT_PAUSE_MS : MEMBER_SYNC_INTENT_RESUME_MS) };
}

function hasMemberSyncIntent(paused: boolean): boolean {
  if (!memberSyncIntent) return false;
  if (memberSyncIntent.paused !== paused) return false;
  if (Date.now() > memberSyncIntent.until) { memberSyncIntent = null; return false; }
  return true;
}

function markAuthoritativeSyncEvent(paused: boolean): void {
  authoritativeSyncEvent = { paused, until: Date.now() + AUTHORITATIVE_SYNC_EVENT_WINDOW_MS };
}

function hasAuthoritativeSyncEvent(paused: boolean): boolean {
  if (!authoritativeSyncEvent) return false;
  if (authoritativeSyncEvent.paused !== paused) return false;
  if (Date.now() > authoritativeSyncEvent.until) { authoritativeSyncEvent = null; return false; }
  return true;
}

function shouldBlockLocalResumeFromAuthoritativeState(): boolean {
  // If we haven't received any authoritative state yet, default to blocking resume
  // until the first sync command arrives. This prevents auto-play before sync.
  const effectivePaused = authoritativePlaybackPaused === null ? true : authoritativePlaybackPaused;
  return !isHostMode && effectivePaused === true && !hasAuthoritativeSyncEvent(false) && !hasMemberSyncIntent(false);
}

function markMemberManualPause(): void { memberManualPauseUntil = Date.now() + 1500; }
function markMemberManualResume(): void { memberManualResumeUntil = Date.now() + 1500; }
function consumeMemberManualPause(): boolean {
  if (Date.now() > memberManualPauseUntil) return false;
  memberManualPauseUntil = 0; return true;
}
function consumeMemberManualResume(): boolean {
  if (Date.now() > memberManualResumeUntil) return false;
  memberManualResumeUntil = 0; return true;
}

function shouldBlockMemberNavigation(target: EventTarget | null): boolean {
  if (isHostMode) return false;
  const anchor = (target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return false;
  const href = anchor.href?.trim();
  if (!href || href.startsWith("javascript:") || href.startsWith("about:blank")) return false;
  return true;
}

ipcRenderer.on("yiqikan:set-host-mode", (_event, val: boolean) => {
  if (!IS_TOP) return;
  isHostMode = val;
  postMessageToChildFrames({ source: "yiqikan-set-host-mode", isHost: val });
});

ipcRenderer.on("yiqikan:set-member-local-pause", (_event, val: boolean) => {
  if (!IS_TOP) return;
  memberLocalPause = !!val;
});

ipcRenderer.on("yiqikan:exit-html-full-screen", () => {
  if (!IS_TOP) return;
  fullscreenTransitionUntil = Date.now() + FULLSCREEN_TRANSITION_SUPPRESS_MS;
  exitFullscreenInThisFrame();
  postMessageToChildFrames({ source: MSG_SOURCE_EXIT_FULLSCREEN });
});

ipcRenderer.on("yiqikan:set-authoritative-playback-state", (_event, payload: { paused?: boolean | null } | undefined) => {
  if (!IS_TOP) return;
  authoritativePlaybackPaused = typeof payload?.paused === "boolean" ? payload.paused : null;
});

/* ------------------------------------------------------------------ */
/*  Member play/pause interception (top frame only)                    */
/* ------------------------------------------------------------------ */

// Handles play/pause events from both top frame AND subframes (via MSG_SOURCE_PLAY_EVENT)
function handleMemberPlayEvent(isPlayEvent: boolean, fromSubframe = false): void {
  if (isHostMode) return;

  if (isPlayEvent) {
    // If member has locally paused, block all play attempts from the page
    if (memberLocalPause) {
      if (!fromSubframe) {
        const v = findBestVideoInFrame();
        try { v?.pause(); } catch { /* ignore */ }
      } else {
        postMessageToChildFrames({ source: "yiqikan-force-pause" });
      }
      return;
    }
    if (hasAuthoritativeSyncEvent(false)) {
      return;
    }
    if (hasMemberSyncIntent(false)) {
      return;
    }
    if (consumeMemberManualResume()) {
      return;
    }
    if (shouldBlockLocalResumeFromAuthoritativeState()) {
      if (!fromSubframe) {
        const v = findBestVideoInFrame();
        try { v?.pause(); } catch { /* ignore */ }
      } else {
        // tell subframe to pause its video
        postMessageToChildFrames({ source: "yiqikan-force-pause" });
      }
    }
    ipcRenderer.sendToHost("yiqikan:member-resume-request");
    return;
  }

  // pause event
  if (hasAuthoritativeSyncEvent(true)) {
    return;
  }
  if (hasMemberSyncIntent(true)) {
    return;
  }
  if (hasMemberSyncIntent(false)) {
    return;
  }
  if (!consumeMemberManualPause()) {
    return;
  }
  ipcRenderer.sendToHost("yiqikan:member-local-pause-change", { paused: true });
}

// Top-frame play/pause events
for (const evt of ["play", "pause"]) {
  document.addEventListener(evt, (e) => {
    if (isHostMode) return;
    if (Date.now() < fullscreenTransitionUntil) return;
    const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
    if (tag !== "VIDEO" && tag !== "BWP-VIDEO") return;
    handleMemberPlayEvent(evt === "play", false);
  }, true);
}

// Top-frame click/keydown interception
document.addEventListener("click", (e) => {
  if (isHostMode) return;
  const target = e.target as HTMLElement;
  const tag = target?.tagName?.toUpperCase();
  if (tag === "VIDEO" || tag === "BWP-VIDEO") {
    const bestVideo = (target as HTMLElement | null)?.closest?.("video, bwp-video") as HTMLVideoElement | null ?? findBestVideoInFrame();
    if (!bestVideo) return;
    if (!bestVideo.paused) { markMemberManualPause(); return; }
    if (bestVideo.paused) {
      if (memberLocalPause) {
        // member has locally paused — block page-level resume, don't send resume request
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      markMemberManualResume();
      if (shouldBlockLocalResumeFromAuthoritativeState()) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
      ipcRenderer.sendToHost("yiqikan:member-resume-request");
    }
  }
}, true);

document.addEventListener("keydown", (e) => {
  if (isHostMode) return;
  if (e.code !== "Space" && e.code !== "KeyK") return;
  const active = document.activeElement?.tagName?.toUpperCase();
  if (active !== "VIDEO" && active !== "BWP-VIDEO" && active !== "BODY") return;
  const bestVideo = findBestVideoInFrame();
  if (!bestVideo) return;
  if (!bestVideo.paused) { markMemberManualPause(); return; }
  if (memberLocalPause) {
    e.stopImmediatePropagation();
    e.preventDefault();
    return;
  }
  markMemberManualResume();
  if (shouldBlockLocalResumeFromAuthoritativeState()) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
  ipcRenderer.sendToHost("yiqikan:member-resume-request");
}, true);
document.addEventListener("click", (e) => {
  if (!shouldBlockMemberNavigation(e.target)) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  ipcRenderer.sendToHost("yiqikan:member-blocked-action");
}, true);

/* ------------------------------------------------------------------ */
/*  Top frame: aggregate child reports + handle sync cmds              */
/* ------------------------------------------------------------------ */

let childVideoStatus: any = null;
let childVideoTimestamp = 0;
let childForwardTimer: number | null = null;

function getNextChildForwardDelay(): number {
  if (document.hidden) return CHILD_FORWARD_INTERVAL_HIDDEN_MS;
  return childVideoStatus && Date.now() - childVideoTimestamp < 5000 ? CHILD_FORWARD_INTERVAL_ACTIVE_MS : CHILD_FORWARD_INTERVAL_IDLE_MS;
}

function scheduleChildForward(delay = getNextChildForwardDelay()): void {
  if (childForwardTimer) window.clearTimeout(childForwardTimer);
  childForwardTimer = window.setTimeout(() => {
    const topVideo = findBestVideoInFrame();
    if (!topVideo && childVideoStatus && Date.now() - childVideoTimestamp < 5000) {
      const key = `child|${childVideoStatus.paused}|${childVideoStatus.playbackRate}|${Math.floor(childVideoStatus.currentTime)}`;
      if (key !== lastReportKey) { lastReportKey = key; ipcRenderer.sendToHost("yiqikan:video-status", childVideoStatus); }
    }
    if (!topVideo && (!childVideoStatus || Date.now() - childVideoTimestamp > 8000)) {
      if (lastReportKey !== "none") { lastReportKey = "none"; ipcRenderer.sendToHost("yiqikan:video-status", { found: false }); }
    }
    scheduleChildForward();
  }, delay);
}

window.addEventListener("message", (event) => {
  if (!IS_TOP) {
    if (event.data?.source === "yiqikan-set-host-mode") { isHostMode = !!event.data.isHost; }
    return;
  }

  const src = event.data?.source;

  if (src === MSG_SOURCE_CHILD) {
    const s = event.data.status;
    if (!s?.found) return;
    childVideoStatus = s;
    childVideoTimestamp = Date.now();
    const topVideo = findBestVideoInFrame();
    if (!topVideo || (topVideo.duration || 0) < (s.duration || 0)) ipcRenderer.sendToHost("yiqikan:video-status", s);
    scheduleChildForward(1200);
    return;
  }
  if (src === MSG_SOURCE_OPEN_URL) { forwardOpenUrl(event.data.payload); return; }
  if (src === "yiqikan-member-blocked") { ipcRenderer.sendToHost("yiqikan:member-blocked-action"); return; }
  if (src === MSG_SOURCE_PLAY_EVENT) {
    handleMemberPlayEvent(!!event.data.isPlay, true);
    return;
  }
  if (src === MSG_SOURCE_FULLSCREEN) {
    fullscreenTransitionUntil = Date.now() + FULLSCREEN_TRANSITION_SUPPRESS_MS;
    ipcRenderer.send("yiqikan:html-full-screen-request", { active: !!event.data.active });
    return;
  }
  if (src === MSG_SOURCE_HOST_MODE_REQUEST) {
    try { (event.source as WindowProxy | null)?.postMessage({ source: "yiqikan-set-host-mode", isHost: isHostMode }, "*"); } catch { /* ignore */ }
    return;
  }
});

scheduleChildForward(CHILD_FORWARD_INTERVAL_IDLE_MS);
document.addEventListener("visibilitychange", () => { scheduleChildForward(document.hidden ? CHILD_FORWARD_INTERVAL_HIDDEN_MS : 1000); });
setTimeout(requestHostModeFromTop, 0);
setTimeout(requestHostModeFromTop, 800);

/* ------------------------------------------------------------------ */
/*  Apply sync command (top frame)                                     */
/* ------------------------------------------------------------------ */

ipcRenderer.on("yiqikan:video-sync", (_event, cmd) => {
  if (!IS_TOP) return;

  // Update state before any play/pause so event handlers see correct values
  if (!isHostMode && typeof cmd.paused === "boolean") {
    authoritativePlaybackPaused = cmd.paused;
    markAuthoritativeSyncEvent(cmd.paused);
    if (cmd.paused || cmd.allowResume) markMemberSyncIntent(cmd.paused);
  }

  const v = findBestVideoInFrame();
  if (v) {
    applySyncToVideo(v, cmd);
  } else {
    // Forward decided command to subframes — they execute directly
    postMessageToChildFrames({ source: MSG_SOURCE_SYNC, cmd: { ...cmd, _memberLocalPause: memberLocalPause } });
  }
});

function applySyncToVideo(v: HTMLVideoElement, cmd: any): void {

  const nextSyncId = typeof cmd.syncId === "number" ? cmd.syncId : 0;
  const nextTimestamp = typeof cmd.localTimestamp === "number" ? cmd.localTimestamp : 0;
  const lastSyncId = typeof (window as any).__yiqikan_last_sync_id === "number" ? (window as any).__yiqikan_last_sync_id : 0;
  const lastSyncTimestamp = typeof (window as any).__yiqikan_last_sync_ts === "number" ? (window as any).__yiqikan_last_sync_ts : 0;

  if (nextSyncId > 0 && nextSyncId < lastSyncId) return;
  if (nextSyncId === lastSyncId && nextTimestamp > 0 && nextTimestamp <= lastSyncTimestamp) return;
  if (nextSyncId === 0 && lastSyncId > 0 && nextTimestamp > 0 && nextTimestamp <= lastSyncTimestamp) return;
  (window as any).__yiqikan_last_sync_id = Math.max(lastSyncId, nextSyncId);
  (window as any).__yiqikan_last_sync_ts = Math.max(lastSyncTimestamp, nextTimestamp);

  if (typeof cmd.currentTime === "number") {
    let target = cmd.currentTime;
    if (!cmd.paused && typeof cmd.localTimestamp === "number") {
      const elapsed = Date.now() / 1000 - cmd.localTimestamp;
      if (elapsed > 0 && elapsed < 10) target += elapsed * (cmd.playbackRate || 1);
    }
    if (Math.abs(v.currentTime - target) > 1) v.currentTime = target;
  }

  if (typeof cmd.paused === "boolean") {
    if (cmd.paused && !v.paused) { v.pause(); }
    else if (!cmd.paused && cmd.allowResume && !memberLocalPause) { v.play().catch(() => {}); }
  }

  if (typeof cmd.playbackRate === "number" && v.playbackRate !== cmd.playbackRate) {
    try { v.playbackRate = cmd.playbackRate; } catch { /* blocked */ }
  }

}

/* ------------------------------------------------------------------ */
/*  Volume control                                                      */
/* ------------------------------------------------------------------ */

const MSG_SOURCE_VOLUME = "yiqikan-set-volume";

function applyVolumeToVideos(vol: number): void {
  const clamped = Math.max(0, Math.min(1, vol));
  for (const tag of VIDEO_TAGS) {
    const elements = document.getElementsByTagName(tag);
    for (let i = 0; i < elements.length; i++) {
      try { (elements[i] as HTMLVideoElement).volume = clamped; } catch { /* ignore */ }
    }
  }
}

ipcRenderer.on("yiqikan:set-volume", (_event, data) => {
  if (!IS_TOP) return;
  const vol = data?.volume ?? 1;
  applyVolumeToVideos(vol);
  const iframes = document.getElementsByTagName("iframe");
  for (let i = 0; i < iframes.length; i++) {
    try { iframes[i].contentWindow!.postMessage({ source: MSG_SOURCE_VOLUME, volume: vol }, "*"); } catch { /* cross-origin */ }
  }
});
