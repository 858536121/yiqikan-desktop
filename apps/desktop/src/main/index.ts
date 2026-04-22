import { app, BrowserWindow, ipcMain, session, webFrameMain, Menu } from "electron";
import { join } from "node:path";
import { initializeAppUpdater, registerUpdaterIpc } from "./updater.js";

declare const __DEV__: boolean;

// Dev-only inspector — tree-shaken out in production builds
let startDevInspector: ((s: any) => void) | null = null;
let captureRequest: ((id: string, url: string, method: string, headers: Record<string, string>) => void) | null = null;
let setInspectorGuest: ((wc: any) => void) | null = null;

if (__DEV__) {
  const inspector = await import("./dev-inspector.js");
  startDevInspector = inspector.startDevInspector;
  captureRequest = inspector.captureRequest;
  setInspectorGuest = inspector.setInspectorGuest;
}

const webviewPreloadPath = join(__dirname, "../preload/webview-preload.js");
const WEBVIEW_PARTITION = "persist:yiqikan";
const ALLOWED_WEBVIEW_PROTOCOLS = new Set(["http:", "https:", "about:"]);
let currentMainWindow: BrowserWindow | null = null;
let currentGuestWebContents: Electron.WebContents | null = null;
let htmlFullscreenActive = false;

function isSafeWebviewUrl(value: string) {
  try {
    return ALLOWED_WEBVIEW_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isTrustedPermissionOrigin(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ALLOWED_WEBVIEW_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function emitHtmlFullscreenChange(active: boolean) {
  htmlFullscreenActive = active;
  if (!currentMainWindow || currentMainWindow.isDestroyed()) return;
  currentMainWindow.webContents.send("yiqikan:html-full-screen-change", { active });
}

function syncHtmlFullscreenState(mainWindow: BrowserWindow, active: boolean) {
  if (!mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(active);
  }
  emitHtmlFullscreenChange(active);
}

async function exitHtmlFullscreen() {
  const tasks: Promise<unknown>[] = [];

  if (currentMainWindow && !currentMainWindow.isDestroyed()) {
    currentMainWindow.setFullScreen(false);
    tasks.push(
      currentMainWindow.webContents.executeJavaScript(
        "try { if (document.fullscreenElement) { void document.exitFullscreen(); } } catch {}",
      ).catch(() => {}),
    );
  }

  if (currentGuestWebContents && !currentGuestWebContents.isDestroyed()) {
    currentGuestWebContents.send("yiqikan:exit-html-full-screen");
    tasks.push(
      currentGuestWebContents.executeJavaScript(
        "try { if (document.fullscreenElement) { void document.exitFullscreen(); } } catch {}",
      ).catch(() => {}),
    );
  }

  emitHtmlFullscreenChange(false);
  await Promise.all(tasks);
}

// Pure-JS injection script for sub-frames (no Node/Electron APIs needed)
// Subframes only: find video, execute commands, report status upward.
// All decision logic lives in the top-frame preload.
const subframeInjectionScript = `
(function() {
  if (window.__yiqikan_subframe_injected) return;
  window.__yiqikan_subframe_injected = true;

  var VIDEO_TAGS = ["video", "bwp-video"];
  var MSG_SOURCE_CHILD = "yiqikan-child-video";
  var MSG_SOURCE_SYNC = "yiqikan-sync-cmd";
  var MSG_SOURCE_OPEN_URL = "yiqikan-open-url";
  var MSG_SOURCE_FULLSCREEN = "yiqikan-fullscreen-change";
  var MSG_SOURCE_EXIT_FULLSCREEN = "yiqikan-exit-fullscreen";
  var MSG_SOURCE_HOST_MODE_REQUEST = "yiqikan-request-host-mode";
  var MSG_SOURCE_PLAY_EVENT = "yiqikan-play-event";
  var VIDEO_SCAN_INTERVAL_PLAYING_MS = 2500;
  var VIDEO_SCAN_INTERVAL_PAUSED_MS = 5000;
  var VIDEO_SCAN_INTERVAL_RECENT_IDLE_MS = 5000;
  var VIDEO_SCAN_INTERVAL_IDLE_MS = 8000;
  var VIDEO_SCAN_INTERVAL_HIDDEN_MS = 12000;
  var FULLSCREEN_TRANSITION_SUPPRESS_MS = 1200;
  var isHostMode = true;
  var fullscreenTransitionUntil = 0;
  var lastKey = "", lastTs = 0, lastVideoFoundAt = 0, reportTimer = null;

  function postToAncestor(message) {
    try { window.top.postMessage(message, "*"); } catch(e) {
      try { window.parent.postMessage(message, "*"); } catch(e2) {}
    }
  }

  function postToChildFrames(message) {
    var iframes = document.getElementsByTagName("iframe");
    for (var i = 0; i < iframes.length; i++) {
      try { iframes[i].contentWindow.postMessage(message, "*"); } catch(e) {}
    }
  }

  function findBestVideo() {    var best = null, bestScore = -1;
    for (var t = 0; t < VIDEO_TAGS.length; t++) {
      var els = document.getElementsByTagName(VIDEO_TAGS[t]);
      for (var i = 0; i < els.length; i++) {
        var v = els[i];
        try { if (v.VideoTogetherDisabled) continue; } catch(e) {}
        var score = (v.duration || 0);
        if (v.offsetWidth >= 100 && v.offsetHeight >= 60) score += (v.offsetWidth * v.offsetHeight) / 1e4;
        if (v.readyState >= 2) score += 500;
        if (score > bestScore) { bestScore = score; best = v; }
      }
    }
    return best;
  }

  function report(force) {
    var now = Date.now();
    if (now < fullscreenTransitionUntil) return;
    var v = findBestVideo();
    if (!v) return;
    lastVideoFoundAt = now;
    var s = { found: true, currentTime: v.currentTime || 0, duration: v.duration || 0, paused: v.paused, playbackRate: v.playbackRate || 1, readyState: v.readyState || 0, localTimestamp: Date.now() / 1000 };
    var key = s.paused + "|" + s.playbackRate + "|" + Math.floor(s.currentTime);
    var heartbeatInterval = s.paused ? 4000 : 2000;
    if (!force && key === lastKey && now - lastTs < heartbeatInterval) return;
    lastKey = key; lastTs = now;
    postToAncestor({ source: MSG_SOURCE_CHILD, status: s });
  }

  function forceReport() { lastKey = ""; lastTs = 0; report(true); }

  function getNextReportDelay() {
    if (document.hidden) return VIDEO_SCAN_INTERVAL_HIDDEN_MS;
    var v = findBestVideo();
    if (v) return v.paused ? VIDEO_SCAN_INTERVAL_PAUSED_MS : VIDEO_SCAN_INTERVAL_PLAYING_MS;
    return (Date.now() - lastVideoFoundAt) < 15000 ? VIDEO_SCAN_INTERVAL_RECENT_IDLE_MS : VIDEO_SCAN_INTERVAL_IDLE_MS;
  }

  function scheduleNextReport(delay) {
    if (typeof delay !== "number") delay = getNextReportDelay();
    if (reportTimer) clearTimeout(reportTimer);
    reportTimer = setTimeout(function() { report(false); scheduleNextReport(); }, delay);
  }

  scheduleNextReport(1200);
  document.addEventListener("visibilitychange", function() { scheduleNextReport(document.hidden ? VIDEO_SCAN_INTERVAL_HIDDEN_MS : 500); });
  document.addEventListener("fullscreenchange", function() {
    fullscreenTransitionUntil = Date.now() + FULLSCREEN_TRANSITION_SUPPRESS_MS;
    postToAncestor({ source: MSG_SOURCE_FULLSCREEN, active: !!document.fullscreenElement });
    scheduleNextReport(600);
  }, true);

  ["play","pause","seeked","ratechange"].forEach(function(evt) {
    document.addEventListener(evt, function(e) {
      var tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : "";
      if (tag !== "VIDEO" && tag !== "BWP-VIDEO") return;
      forceReport(); scheduleNextReport(800);
      // Notify top frame of play/pause so it can run decision logic
      if (evt === "play" || evt === "pause") {
        if (Date.now() < fullscreenTransitionUntil) return;
        postToAncestor({ source: MSG_SOURCE_PLAY_EVENT, isPlay: evt === "play" });
      }
    }, true);
  });

  ["loadeddata","canplay"].forEach(function(evt) {
    document.addEventListener(evt, function(e) {
      var tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : "";
      if (tag === "VIDEO" || tag === "BWP-VIDEO") { report(true); scheduleNextReport(1000); }
    }, true);
  });

  // Block member navigation
  document.addEventListener("click", function(e) {
    if (isHostMode) return;
    var anchor = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!anchor) return;
    var href = anchor.href ? anchor.href.trim() : "";
    if (!href || href.indexOf("javascript:") === 0 || href.indexOf("about:blank") === 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    postToAncestor({ source: "yiqikan-member-blocked" });
  }, true);

  // Popup interception — anchor clicks with _blank target forwarded to top frame
  // window.open is handled by Electron's setWindowOpenHandler / did-create-window in the main process
  try {
    document.addEventListener("click", function(event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!anchor) return;
      var rel = anchor.rel || "";
      var blankLike = anchor.target === "_blank" || rel.indexOf("noopener") !== -1 || rel.indexOf("noreferrer") !== -1;
      if (!anchor.href || !blankLike) return;
      event.preventDefault(); event.stopPropagation();
      var href = anchor.href;
      var resolved = href.indexOf("//") === 0 ? "https:" + href : href;
      postToAncestor({ source: "yiqikan-open-url", payload: { url: resolved } });
    }, true);
  } catch(e) {}

  try {
    var obs = new MutationObserver(function(mutations) {
      for (var m = 0; m < mutations.length; m++) {
        for (var n = 0; n < mutations[m].addedNodes.length; n++) {
          var node = mutations[m].addedNodes[n];
          if (!node.tagName) continue;
          var tag = node.tagName.toUpperCase();
          if (tag === "VIDEO" || tag === "BWP-VIDEO") { forceReport(); scheduleNextReport(800); return; }
          try { if (node.querySelectorAll && node.querySelectorAll("video, bwp-video").length > 0) { forceReport(); scheduleNextReport(800); return; } } catch(e) {}
        }
      }
    });
    var obsTarget = document.documentElement || document.body;
    if (obsTarget) obs.observe(obsTarget, { childList: true, subtree: true });
  } catch(e) {}

  setTimeout(forceReport, 500);
  setTimeout(forceReport, 2000);
  setTimeout(forceReport, 5000);

  function requestHostModeFromTop() {
    postToAncestor({ source: MSG_SOURCE_HOST_MODE_REQUEST });
  }
  setTimeout(requestHostModeFromTop, 0);
  setTimeout(requestHostModeFromTop, 800);

  window.addEventListener("message", function(event) {
    var src = event.data && event.data.source;

    if (src === "yiqikan-set-host-mode") { isHostMode = !!event.data.isHost; return; }

    if (src === MSG_SOURCE_HOST_MODE_REQUEST) {
      try { if (event.source && event.source.postMessage) event.source.postMessage({ source: "yiqikan-set-host-mode", isHost: !!isHostMode }, "*"); } catch(e) {}
      return;
    }

    if (src === MSG_SOURCE_EXIT_FULLSCREEN) {
      fullscreenTransitionUntil = Date.now() + FULLSCREEN_TRANSITION_SUPPRESS_MS;
      try { if (document.fullscreenElement) void document.exitFullscreen(); } catch(e) {}
      postToChildFrames({ source: MSG_SOURCE_EXIT_FULLSCREEN });
      return;
    }

    if (src === "yiqikan-force-pause") {
      // top frame decided to block this resume
      var v = findBestVideo();
      if (v) try { v.pause(); } catch(e) {}
      postToChildFrames({ source: "yiqikan-force-pause" });
      return;
    }

    if (src !== MSG_SOURCE_SYNC) return;

    // Execute sync command directly — all decisions already made by top frame
    var v = findBestVideo();
    if (!v) { postToChildFrames(event.data); return; }
    var cmd = event.data.cmd;
    var memberLocalPause = !!cmd._memberLocalPause;

    var nextSyncId = typeof cmd.syncId === "number" ? cmd.syncId : 0;
    var nextTimestamp = typeof cmd.localTimestamp === "number" ? cmd.localTimestamp : 0;
    var lastSyncId = typeof window.__yiqikan_last_sync_id === "number" ? window.__yiqikan_last_sync_id : 0;
    var lastSyncTimestamp = typeof window.__yiqikan_last_sync_ts === "number" ? window.__yiqikan_last_sync_ts : 0;
    if (nextSyncId > 0 && nextSyncId < lastSyncId) return;
    if (nextSyncId === lastSyncId && nextTimestamp > 0 && nextTimestamp <= lastSyncTimestamp) return;
    if (nextSyncId === 0 && lastSyncId > 0 && nextTimestamp > 0 && nextTimestamp <= lastSyncTimestamp) return;
    window.__yiqikan_last_sync_id = Math.max(lastSyncId, nextSyncId);
    window.__yiqikan_last_sync_ts = Math.max(lastSyncTimestamp, nextTimestamp);

    if (typeof cmd.currentTime === "number") {
      var target = cmd.currentTime;
      if (!cmd.paused && typeof cmd.localTimestamp === "number") {
        var elapsed = Date.now() / 1000 - cmd.localTimestamp;
        if (elapsed > 0 && elapsed < 10) target += elapsed * (cmd.playbackRate || 1);
      }
      if (Math.abs(v.currentTime - target) > 1) v.currentTime = target;
    }
    if (typeof cmd.paused === "boolean") {
      if (cmd.paused && !v.paused) v.pause();
      else if (!cmd.paused && cmd.allowResume && !memberLocalPause) v.play().catch(function(){});
    }
    if (typeof cmd.playbackRate === "number" && v.playbackRate !== cmd.playbackRate) {
      try { v.playbackRate = cmd.playbackRate; } catch(e) {}
    }
    postToChildFrames(event.data);
  });

  // Volume control
  window.addEventListener("message", function(event) {
    if (!event.data || event.data.source !== "yiqikan-set-volume") return;
    var vol = Math.max(0, Math.min(1, event.data.volume || 1));
    for (var t = 0; t < VIDEO_TAGS.length; t++) {
      var els = document.getElementsByTagName(VIDEO_TAGS[t]);
      for (var i = 0; i < els.length; i++) { try { els[i].volume = vol; } catch(e) {} }
    }
    postToChildFrames({ source: "yiqikan-set-volume", volume: vol });
  });
})();
`;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: process.env.ELECTRON_RENDERER_URL ? 800 : 1280,
    height: process.env.ELECTRON_RENDERER_URL ? 420 : 840,
    minWidth: process.env.ELECTRON_RENDERER_URL ? 700 : 1100,
    minHeight: process.env.ELECTRON_RENDERER_URL ? 360 : 720,
    show: false, // hide until ready-to-show
    backgroundColor: "#111113", // match app background to avoid flash
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: join(__dirname, "../preload/index.js"),
    },
  });
  currentMainWindow = mainWindow;

  // Show window as soon as the HTML is parsed — the inline loading screen
  // provides immediate visual feedback while React finishes mounting.
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    if (currentMainWindow === mainWindow) {
      currentMainWindow = null;
      currentGuestWebContents = null;
      htmlFullscreenActive = false;
    }
  });

  mainWindow.webContents.on("enter-html-full-screen", () => {
    syncHtmlFullscreenState(mainWindow, true);
  });

  mainWindow.webContents.on("leave-html-full-screen", () => {
    syncHtmlFullscreenState(mainWindow, false);
  });

  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.key === "Escape" && htmlFullscreenActive) {
      void exitHtmlFullscreen();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.on("did-attach-webview", (_event, guestWebContents) => {
    currentGuestWebContents = guestWebContents;
    if (process.env.ELECTRON_RENDERER_URL) setInspectorGuest?.(guestWebContents);

    guestWebContents.setWindowOpenHandler((details) => {
      const url = details.url;
      if (!url || url.startsWith("about:blank") || url.startsWith("javascript:")) {
        return { action: "deny" };
      }
      const resolvedUrl = url.startsWith("//") ? `https:${url}` : url;
      if (!isSafeWebviewUrl(resolvedUrl)) {
        return { action: "deny" };
      }
      mainWindow.webContents.send("yiqikan:webview-window-open", {
        url: resolvedUrl,
        frameName: details.frameName,
        disposition: details.disposition,
      });
      return { action: "deny" };
    });

    guestWebContents.on("will-navigate", (event, url) => {
      if (!isSafeWebviewUrl(url)) {
        event.preventDefault();
      }
    });

    guestWebContents.on("will-redirect", (event, url) => {
      if (!isSafeWebviewUrl(url)) {
        event.preventDefault();
      }
    });

    guestWebContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
      // ERR_ABORTED (-3) is expected when navigation is interrupted by redirects or new navigation — ignore it
      if (errorCode === -3) return;
      if (!isMainFrame) return;
    });

    // Inject into sub-frames when they finish loading
    guestWebContents.on("did-frame-finish-load", (_e, isMainFrame, frameProcessId, frameRoutingId) => {
      if (!isMainFrame) {
        try {
          const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
          if (frame && !frame.url.startsWith("about:")) {
            frame.executeJavaScript(subframeInjectionScript).catch(() => {});
          }
        } catch { /* frame may have been destroyed */ }
      }
    });

    guestWebContents.on("enter-html-full-screen", () => {
      syncHtmlFullscreenState(mainWindow, true);
    });

    guestWebContents.on("leave-html-full-screen", () => {
      syncHtmlFullscreenState(mainWindow, false);
    });

    guestWebContents.on("before-input-event", (_event, input) => {
      if (input.key === "Escape" && htmlFullscreenActive) {
        void exitHtmlFullscreen();
      }
    });

    guestWebContents.on("destroyed", () => {
      if (currentGuestWebContents === guestWebContents) {
        currentGuestWebContents = null;
      }
      if (htmlFullscreenActive) {
        syncHtmlFullscreenState(mainWindow, false);
      }
    });
  });
}

// Expose the webview preload path to the renderer
ipcMain.handle("get-webview-preload-path", () => {
  return webviewPreloadPath;
});

ipcMain.handle("get-webview-media-source-id", () => {
  if (!currentMainWindow || currentMainWindow.isDestroyed()) return null;
  if (!currentGuestWebContents || currentGuestWebContents.isDestroyed()) return null;
  try {
    return currentGuestWebContents.getMediaSourceId(currentMainWindow.webContents);
  } catch {
    return null;
  }
});

ipcMain.handle("yiqikan:get-html-full-screen-state", () => htmlFullscreenActive);
ipcMain.handle("yiqikan:exit-html-full-screen", async () => {
  await exitHtmlFullscreen();
  return true;
});

ipcMain.handle("yiqikan:clear-browsing-data", async () => {
  const yiqikanSession = session.fromPartition(WEBVIEW_PARTITION);
  await yiqikanSession.clearCache();
  await yiqikanSession.clearStorageData({
    storages: ["cookies", "localstorage", "indexdb", "websql", "serviceworkers", "cachestorage"],
  });
  // Reload the webview so changes take effect immediately
  if (currentGuestWebContents && !currentGuestWebContents.isDestroyed()) {
    currentGuestWebContents.reload();
  }
});

ipcMain.on("yiqikan:html-full-screen-request", (event, payload: { active?: boolean } | undefined) => {
  if (!currentMainWindow || currentMainWindow.isDestroyed()) return;
  if (!currentGuestWebContents || currentGuestWebContents.isDestroyed()) return;
  if (event.sender.id !== currentGuestWebContents.id) return;

  syncHtmlFullscreenState(currentMainWindow, !!payload?.active);
});

registerUpdaterIpc();

app.whenReady().then(() => {
  // Remove the default application menu
  Menu.setApplicationMenu(null);
  // Also set session preloads as a fallback
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event, webPreferences, params) => {
      if (params.src && !isSafeWebviewUrl(params.src)) {
        event.preventDefault();
        return;
      }

      Reflect.deleteProperty(webPreferences as Record<string, unknown>, "preloadURL");
      webPreferences.preload = webviewPreloadPath;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      params.partition = WEBVIEW_PARTITION;
    });
  });

  const yiqikanSession = session.fromPartition(WEBVIEW_PARTITION);
  yiqikanSession.setPreloads([webviewPreloadPath]);

  // Override User-Agent to remove Electron identifier — prevents bot detection on sites
  const chromeUA = yiqikanSession.getUserAgent()
    .replace(/\s*Electron\/[\d.]+/, "")
    .replace(/\s*@[\w/-]+\/[\d.]+/, "");
  yiqikanSession.setUserAgent(chromeUA);

  // Normalize request headers to match standard Chrome behavior
  yiqikanSession.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
    const headers = details.requestHeaders;

    // Fix sec-ch-ua: add Google Chrome brand which Electron strips out
    if (headers["sec-ch-ua"]) {
      const uaMatch = chromeUA.match(/Chrome\/([\d]+)/);
      const chromeVersion = uaMatch?.[1] ?? "130";
      headers["sec-ch-ua"] = `"Google Chrome";v="${chromeVersion}", "Not.A/Brand";v="8", "Chromium";v="${chromeVersion}"`;
    }

    // Normalize Accept-Language to standard Chrome format
    if (headers["Accept-Language"] === "zh-CN") {
      headers["Accept-Language"] = "zh-CN,zh;q=0.9,en;q=0.8";
    }

    // Add Referer for same-origin navigation if missing — matches Chrome behavior
    if (!headers["Referer"] && !headers["referer"] && details.resourceType === "mainFrame") {
      try {
        const reqUrl = new URL(details.url);
        const wc = currentGuestWebContents;
        if (wc && !wc.isDestroyed()) {
          const currentUrl = wc.getURL();
          if (currentUrl && currentUrl !== "about:blank") {
            const currentOrigin = new URL(currentUrl).origin;
            if (reqUrl.origin === currentOrigin) {
              headers["Referer"] = currentUrl;
            }
          }
        }
      } catch { /* ignore */ }
    }

    if (process.env.ELECTRON_RENDERER_URL) {
      captureRequest?.(String(details.id), details.url, details.method, headers as Record<string, string>);
    }
    callback({ requestHeaders: headers });
  });
  startDevInspector?.(yiqikanSession);
  yiqikanSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== "fullscreen") return false;
    if (webContents && currentGuestWebContents && webContents.id !== currentGuestWebContents.id) {
      return false;
    }

    return isTrustedPermissionOrigin(details.requestingUrl)
      || isTrustedPermissionOrigin(requestingOrigin)
      || isTrustedPermissionOrigin(details.embeddingOrigin);
  });

  yiqikanSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== "fullscreen") {
      callback(false);
      return;
    }

    const sameGuest = !currentGuestWebContents || webContents.id === currentGuestWebContents.id;
    const allowed = sameGuest
      && (
        isTrustedPermissionOrigin(details.requestingUrl)
        || isTrustedPermissionOrigin(webContents.getURL())
      );

    callback(allowed);
  });

  createWindow();
  initializeAppUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
