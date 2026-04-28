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
  return {
    found: true,
    currentTime: v.currentTime || 0,
    duration: v.duration || 0,
    paused: v.paused,
    playbackRate: v.playbackRate || 1,
    readyState: v.readyState || 0,
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
  const v = findBestVideoInFrame();
  try { v?.pause(); } catch { /* ignore */ }
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
  if (!IS_TOP) return;

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

function applySyncToVideo(cmd: any): void {
  const v = findBestVideoInFrame();
  if (!v) {
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
    else if (!cmd.paused && cmd.allowResume) { v.play().catch(() => {}); }
  }

  if (typeof cmd.playbackRate === "number" && v.playbackRate !== cmd.playbackRate) {
    try { v.playbackRate = cmd.playbackRate; } catch { /* blocked */ }
  }
}

/* ------------------------------------------------------------------ */
/*  Volume control                                                      */
/* ------------------------------------------------------------------ */

function applyVolumeToVideos(vol: number): void {
  const clamped = Math.max(0, Math.min(1, vol));
  for (const tag of VIDEO_TAGS) {
    const elements = document.getElementsByTagName(tag);
    for (let i = 0; i < elements.length; i++) {
      try { (elements[i] as HTMLVideoElement).volume = clamped; } catch { /* ignore */ }
    }
  }
}

window.addEventListener("message", (event) => {
  if (event.data?.source !== "yiqikan-set-volume") return;
  const vol = Math.max(0, Math.min(1, event.data.volume || 1));
  applyVolumeToVideos(vol);
  postMessageToChildFrames({ source: "yiqikan-set-volume", volume: vol });
});
