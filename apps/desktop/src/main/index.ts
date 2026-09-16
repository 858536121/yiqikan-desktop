import { app, BrowserWindow, ipcMain, session, webFrameMain, Menu, shell, net, dialog, systemPreferences, clipboard } from "electron";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
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
const devInstanceProfile = process.env.YIQIKAN_DEV_PROFILE?.trim() || String(process.pid);
const allowMultipleDevInstances = __DEV__;
let currentMainWindow: BrowserWindow | null = null;
let currentGuestWebContents: Electron.WebContents | null = null;
let htmlFullscreenActive = false;
let pendingDeepLinkUrl: string | null = null;
const ONLINE_ROOM_URL = process.env.YIQIKAN_ONLINE_ROOM_URL?.trim() || "https://yiqikan.club/room";

function getBuiltinExtensionPath(): string | null {
  const isDev = !app.isPackaged;
  if (isDev) {
    const devPath = join(__dirname, "../../../browser-extension");
    if (existsSync(devPath)) return devPath;
  } else {
    const prodPath = join(process.resourcesPath, "extension");
    if (existsSync(prodPath)) return prodPath;
  }
  return null;
}

function getErrorFallbackPath(): string {
  const candidates = [
    join(__dirname, "../renderer/error.html"),
    join(__dirname, "../../src/renderer/error.html"),
    join(app.getAppPath(), "out/renderer/error.html"),
    join(app.getAppPath(), "src/renderer/error.html"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return join(__dirname, "../renderer/error.html");
}


if (allowMultipleDevInstances) {
  app.setPath("userData", join(tmpdir(), "yiqikan-desktop-dev", devInstanceProfile));
}

function handleDeepLink(url: string) {
  if (!url.startsWith("yiqikan://")) return;
  if (currentMainWindow && !currentMainWindow.isDestroyed()) {
    if (currentMainWindow.isMinimized()) currentMainWindow.restore();
    currentMainWindow.focus();
    currentMainWindow.webContents.send("yiqikan:deep-link", url);
  } else {
    pendingDeepLinkUrl = url;
  }
}

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

function registerWebviewAudioCaptureHandler() {

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    if (details.url.includes("videotogether.cn") || details.url.includes("kraken")) {
      responseHeaders["access-control-allow-origin"] = ["*"];
      responseHeaders["access-control-allow-headers"] = ["*"];
      responseHeaders["access-control-allow-methods"] = ["GET, POST, OPTIONS, PUT, DELETE"];
    }
    callback({ responseHeaders });
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const requestFrame = request.frame;
    const requestTopFrame = requestFrame?.top ?? requestFrame;
    const mainFrame = currentMainWindow?.webContents.mainFrame ?? null;

    if (!request.audioRequested || !requestFrame || !mainFrame || requestTopFrame !== mainFrame) {
      callback({});
      return;
    }
    if (!currentGuestWebContents || currentGuestWebContents.isDestroyed()) {
      callback({});
      return;
    }

    const guestFrame = currentGuestWebContents.mainFrame;
    callback({
      video: guestFrame,
      audio: guestFrame,
      enableLocalEcho: true,
    });
  });
}

// Pure-JS injection script for sub-frames (no Node/Electron APIs needed).
// Subframes only: find video, execute commands, report status upward.
// No decision logic — all policy lives in the renderer (hot-updatable).
const subframeInjectionScript = `
(function() {
  if (window.__yiqikan_subframe_injected) return;
  window.__yiqikan_subframe_injected = true;

  var VIDEO_TAGS = ["video", "bwp-video"];
  var MSG_SOURCE_CHILD = "yiqikan-child-video";
  var MSG_SOURCE_SYNC = "yiqikan-sync-cmd";
  var MSG_SOURCE_FULLSCREEN = "yiqikan-fullscreen-change";
  var MSG_SOURCE_EXIT_FULLSCREEN = "yiqikan-exit-fullscreen";
  var MSG_SOURCE_HOST_MODE_REQUEST = "yiqikan-request-host-mode";
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

  function findBestVideo() {
    var best = null, bestScore = -1;
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
    }, true);
  });

  ["loadeddata","canplay"].forEach(function(evt) {
    document.addEventListener(evt, function(e) {
      var tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : "";
      if (tag === "VIDEO" || tag === "BWP-VIDEO") { report(true); scheduleNextReport(1000); }
    }, true);
  });

  // Popup interception
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

  // Navigation-attempt forwarding (top frame decides whether to block)
  document.addEventListener("click", function(e) {
    var anchor = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!anchor) return;
    var href = anchor.href ? anchor.href.trim() : "";
    if (!href || href.indexOf("javascript:") === 0 || href.indexOf("about:blank") === 0) return;
    postToAncestor({ source: "yiqikan-member-blocked" });
  }, true);

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

  function requestHostModeFromTop() { postToAncestor({ source: MSG_SOURCE_HOST_MODE_REQUEST }); }
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
      var v = findBestVideo();
      if (v) try { v.pause(); } catch(e) {}
      postToChildFrames({ source: "yiqikan-force-pause" });
      return;
    }

    if (src !== MSG_SOURCE_SYNC) return;

    // Execute sync command — decisions already made by renderer/top-frame preload
    var v = findBestVideo();
    if (!v) { postToChildFrames(event.data); return; }
    var cmd = event.data.cmd;

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
      else if (!cmd.paused && cmd.allowResume) v.play().catch(function(){});
    }
    if (typeof cmd.playbackRate === "number" && v.playbackRate !== cmd.playbackRate) {
      try { v.playbackRate = cmd.playbackRate; } catch(e) {}
    }
    postToChildFrames(event.data);
  });

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

const activeVerificationWindows = new Map<string, BrowserWindow>();
const domainCooldowns = new Map<string, number>();

function openVerificationWindow(targetUrl: string) {
  if (!targetUrl || !targetUrl.startsWith("http")) return;
  let domain = "";
  try {
    domain = new URL(targetUrl).hostname;
  } catch {
    return;
  }

  const now = Date.now();
  const cooldownUntil = domainCooldowns.get(domain);
  if (cooldownUntil && now < cooldownUntil) {
    console.warn(`[Desktop] 域名 ${domain} 处于频控冷却中，跳过重复弹窗以防触发服务端 Rate Limit`);
    return;
  }
  domainCooldowns.set(domain, now + 30000); // 30秒冷却期，防止并发请求冲垮 WAF

  const existingWin = activeVerificationWindows.get(domain);
  if (existingWin && !existingWin.isDestroyed()) {
    existingWin.focus();
    return;
  }

  console.info(`[Desktop] 唤起人机/安全验证窗口: ${domain} (${targetUrl})`);

  const verifyWin = new BrowserWindow({
    width: 520,
    height: 620,
    minWidth: 420,
    minHeight: 460,
    title: `安全验证 - ${domain} (异起看)`,
    parent: currentMainWindow && !currentMainWindow.isDestroyed() ? currentMainWindow : undefined,
    modal: false,
    show: true,
    backgroundColor: "#18181b",
    webPreferences: {
      session: session.defaultSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  activeVerificationWindows.set(domain, verifyWin);

  let isVerified = false;

  const onVerificationSuccess = () => {
    if (isVerified) return;
    isVerified = true;
    console.info(`[Desktop] 域名 ${domain} 验证成功，准备同步刷新放映区`);

    setTimeout(() => {
      if (!verifyWin.isDestroyed()) {
        verifyWin.close();
      }
      activeVerificationWindows.delete(domain);

      if (currentMainWindow && !currentMainWindow.isDestroyed()) {
        currentMainWindow.webContents.send("yiqikan:verification-complete", {
          domain,
          url: targetUrl,
        });

        // Directly reload any subframes matching this domain
        try {
          const mainFrame = currentMainWindow.webContents.mainFrame;
          for (const frame of mainFrame.frames) {
            if (frame.url && (frame.url.includes(domain) || domain.includes(new URL(frame.url).hostname))) {
              console.info(`[Desktop] 自动刷新已通过验证的子框架: ${frame.url}`);
              frame.executeJavaScript("window.location.reload()").catch(() => {});
            }
          }
        } catch (_) {}
      }
    }, 1000);
  };

  const autoSolveScript = `
    (function() {
      try {
        // 1. Libvio PoW checkbox challenge
        const ck = document.getElementById("ck");
        if (ck && !ck.checked && !ck.disabled) {
          ck.checked = true;
          ck.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // 2. Cloudflare Turnstile iframe
        const cfTurnstile = document.querySelector("iframe[src*='challenges.cloudflare.com']");
        if (cfTurnstile && cfTurnstile.contentDocument) {
          const box = cfTurnstile.contentDocument.querySelector("input[type='checkbox']");
          if (box && !box.checked) box.click();
        }
      } catch (_) {}
    })();
  `;

  verifyWin.webContents.on("did-finish-load", () => {
    if (verifyWin.isDestroyed()) return;
    verifyWin.webContents.executeJavaScript(autoSolveScript).catch(() => {});

    verifyWin.webContents.executeJavaScript(`
      (() => {
        const text = (document.body?.innerText || "").slice(0, 400);
        const title = document.title || "";
        const isStillChallenged =
          text.includes("正在验证您的浏览器") ||
          text.includes("browser verification required") ||
          text.includes("工作量证明") ||
          title.includes("正在验证") ||
          title.includes("Just a moment");
        return !isStillChallenged;
      })()
    `).then((isClean) => {
      if (isClean && !isVerified) {
        onVerificationSuccess();
      }
    }).catch(() => {});
  });

  const checkTimer = setInterval(() => {
    if (verifyWin.isDestroyed() || isVerified) {
      clearInterval(checkTimer);
      return;
    }
    verifyWin.webContents.executeJavaScript(autoSolveScript).catch(() => {});
  }, 1000);

  const cookieListener = (_event: any, cookie: Electron.Cookie, _cause: any, removed: boolean) => {
    if (removed || isVerified) return;
    const cookieDomain = (cookie.domain || "").replace(/^\./, "");
    if (cookieDomain === domain || domain.endsWith(cookieDomain) || cookieDomain.endsWith(domain)) {
      const name = (cookie.name || "").toLowerCase();
      if (
        name.includes("pow") ||
        name.includes("cf_") ||
        name.includes("waf") ||
        name.includes("shield") ||
        name.includes("phpsessid")
      ) {
        console.info(`[Desktop] 捕获到目标域名验证通过 Cookie: ${cookie.name}`);
        onVerificationSuccess();
      }
    }
  };

  session.defaultSession.cookies.on("changed", cookieListener);
  verifyWin.on("closed", () => {
    clearInterval(checkTimer);
    session.defaultSession.cookies.removeListener("changed", cookieListener);
    activeVerificationWindows.delete(domain);
  });

  verifyWin.loadURL(targetUrl);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false, // hide until ready-to-show
    backgroundColor: "#0e0e11", // match app background to avoid flash
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: join(__dirname, "../preload/index.js"),
    },
  });
  currentMainWindow = mainWindow;

  // Show window as soon as content is ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.once("did-finish-load", () => {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (pendingDeepLinkUrl) {
      mainWindow.webContents.send("yiqikan:deep-link", pendingDeepLinkUrl);
      pendingDeepLinkUrl = null;
    }
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

  // Native context menu for text inputs and selections (Copy, Paste, Cut, Select All)
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      menuTemplate.push(
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { type: "separator" },
        { role: "selectAll", label: "全选" }
      );
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      menuTemplate.push(
        { role: "copy", label: "复制" },
        { role: "selectAll", label: "全选" }
      );
    }
    if (menuTemplate.length > 0) {
      Menu.buildFromTemplate(menuTemplate).popup({ window: mainWindow });
    }
  });

  // Global keyboard shortcuts (Reload / Force Reload / DevTools / Escape)
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape" && htmlFullscreenActive) {
      void exitHtmlFullscreen();
      return;
    }

    // F5 or Ctrl+R / Cmd+R -> Reload
    const isReload = input.key === "F5" || 
      ((input.control || input.meta) && input.key.toLowerCase() === "r" && !input.shift);
    if (isReload && input.type === "keyDown") {
      event.preventDefault();
      console.info("[Desktop Shell] 用户触发刷新快捷键，重新加载页面");
      mainWindow.webContents.reload();
      return;
    }

    // Ctrl+Shift+R / Cmd+Shift+R / Ctrl+F5 -> Hard Reload
    const isHardReload = 
      (((input.control || input.meta) && input.shift && input.key.toLowerCase() === "r") ||
       (input.control && input.key === "F5"));
    if (isHardReload && input.type === "keyDown") {
      event.preventDefault();
      console.info("[Desktop Shell] 用户触发强制刷新，忽略缓存并重新加载");
      mainWindow.webContents.reloadIgnoringCache();
      return;
    }

    // F12 -> Toggle DevTools
    if (input.key === "F12" && input.type === "keyDown") {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
      return;
    }
  });

  // Handle network loading failures (offline, connection refused, timeouts)
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    console.warn(`[Desktop] 页面加载失败 [${errorCode}] ${errorDescription} (${validatedURL})`);
    mainWindow.loadFile(getErrorFallbackPath(), {
      query: {
        errorCode: String(errorCode),
        errorDescription: errorDescription || "",
        targetUrl: validatedURL || ONLINE_ROOM_URL,
      },
    });
  });

  // Handle server HTTP 50x errors
  mainWindow.webContents.on("did-navigate", (_event, url, httpResponseCode) => {
    if (httpResponseCode && httpResponseCode >= 500) {
      console.warn(`[Desktop] 页面服务端异常 HTTP ${httpResponseCode} (${url})`);
      mainWindow.loadFile(getErrorFallbackPath(), {
        query: {
          httpCode: String(httpResponseCode),
          targetUrl: url || ONLINE_ROOM_URL,
        },
      });
    }
  });

  // Watchdog: Unresponsive / frozen renderer process detection
  mainWindow.on("unresponsive", () => {
    console.warn("[Desktop Watchdog] 房间页面未响应 (unresponsive)");
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["重新加载页面", "立即重试联网", "继续等待"],
      defaultId: 0,
      cancelId: 2,
      title: "异起看 · 提示",
      message: "放映房间暂时失去了响应。",
      detail: "可能是网络波动或视频源较慢导致，是否重新加载页面？",
    });
    if (choice === 0) {
      mainWindow.webContents.reload();
    } else if (choice === 1) {
      mainWindow.loadURL(ONLINE_ROOM_URL);
    }
  });

  // Watchdog: Crashed renderer process recovery
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[Desktop Watchdog] 渲染进程异常退出:", details.reason);
    if (details.reason !== "clean-exit") {
      mainWindow.loadFile(getErrorFallbackPath(), {
        query: {
          crashed: "true",
          reason: details.reason,
          targetUrl: ONLINE_ROOM_URL,
        },
      });
    }
  });

  // Watchdog: Subframe challenge / WAF interception detector
  mainWindow.webContents.on("did-frame-finish-load", (_event, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isMainFrame) return;
    try {
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      if (!frame || !frame.url || !frame.url.startsWith("http")) return;

      frame.executeJavaScript(`
        (() => {
          const text = (document.body?.innerText || "").slice(0, 400);
          const title = document.title || "";
          if (text.includes("Rate limit exceeded") || text.includes("Too Many Requests")) {
            console.warn("[Desktop] 目标站点触发频次限流 (Rate limit exceeded)，需等待服务端冷却");
            return false;
          }
          return (
            text.includes("browser verification required") ||
            text.includes("正在验证您的浏览器") ||
            text.includes("浏览器禁用了 Cookie") ||
            title.includes("正在验证您的浏览器") ||
            (text.includes("403 Forbidden") && (text.includes("verification") || text.includes("verify")))
          );
        })()
      `).then((isChallenge) => {
        if (isChallenge) {
          console.info(`[Desktop] 检测到内嵌视频源需要安全验证: ${frame.url}`);
          openVerificationWindow(frame.url);
        }
      }).catch(() => {});
    } catch { /* frame destroyed */ }
  });

  // Load target URL — online room by default, dev server when running in local dev mode
  if (process.env.ELECTRON_RENDERER_URL && process.env.YIQIKAN_DEV_LOCAL === "true") {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadURL(ONLINE_ROOM_URL);
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

ipcMain.handle("yiqikan:open-external", async (_event, url: string) => {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("yiqikan:voice-rpc", async (_event, payload: { host?: string; method: string; params?: any[] }) => {
  const host = (payload.host || "https://api.videotogether.cn").replace(/\/+$/, "");
  const body = JSON.stringify({
    id: `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    method: payload.method,
    params: payload.params || [],
  });
  console.log(`\x1b[36m[Voice-RPC Main ->]\x1b[0m ${payload.method}`, JSON.stringify(payload.params));
  try {
    const res = await net.fetch(`${host}/kraken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await res.text();
    console.log(`\x1b[32m[Voice-RPC Main <-]\x1b[0m ${payload.method} status=${res.status} resp=${text.slice(0, 150)}`);
    return JSON.parse(text);
  } catch (err: any) {
    console.error(`\x1b[31m[Voice-RPC Main Error]\x1b[0m ${payload.method}:`, err?.message || err);
    throw new Error(err?.message || "Voice RPC failed in main process");
  }
});

ipcMain.on("yiqikan:log", (_event, payload: { level: string; message: string; data?: any }) => {
  const time = new Date().toLocaleTimeString();
  const level = payload?.level || "info";
  const color = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : "\x1b[36m";
  console.log(`${color}[${time} ${level.toUpperCase()}]\x1b[0m ${payload?.message}`, payload?.data ?? "");
});

ipcMain.on("yiqikan:html-full-screen-request", (event, payload: { active?: boolean } | undefined) => {
  if (!currentMainWindow || currentMainWindow.isDestroyed()) return;
  if (!currentGuestWebContents || currentGuestWebContents.isDestroyed()) return;
  if (event.sender.id !== currentGuestWebContents.id) return;

  syncHtmlFullscreenState(currentMainWindow, !!payload?.active);
});

ipcMain.on("yiqikan:reload", () => {
  if (currentMainWindow && !currentMainWindow.isDestroyed()) {
    currentMainWindow.webContents.reload();
  }
});

ipcMain.on("yiqikan:force-reload", () => {
  if (currentMainWindow && !currentMainWindow.isDestroyed()) {
    currentMainWindow.webContents.reloadIgnoringCache();
  }
});

ipcMain.on("yiqikan:retry-online", (_event, targetUrl?: string) => {
  if (!currentMainWindow || currentMainWindow.isDestroyed()) return;
  const urlToLoad = targetUrl?.trim() || ONLINE_ROOM_URL;
  currentMainWindow.loadURL(urlToLoad);
});

ipcMain.on("yiqikan:launch-offline-mode", () => {
  if (!currentMainWindow || currentMainWindow.isDestroyed()) return;
  // Local player has been removed — redirect to online room as fallback
  currentMainWindow.loadURL(ONLINE_ROOM_URL);
});

ipcMain.handle("yiqikan:open-verification-window", (_event, url: string) => {
  openVerificationWindow(url);
  return true;
});

ipcMain.handle("yiqikan:write-clipboard", (_event, text: string) => {
  if (typeof text === "string") {
    clipboard.writeText(text);
    return true;
  }
  return false;
});

ipcMain.handle("yiqikan:read-clipboard", () => {
  return clipboard.readText();
});

registerUpdaterIpc();

// Register custom protocol — must be called before app ready
app.setAsDefaultProtocolClient("yiqikan");

// macOS: cold start — protocol URL arrives before ready
app.on("will-finish-launching", () => {
  app.on("open-url", (_event, url) => {
    _event.preventDefault();
    handleDeepLink(url);
  });
});

// Production keeps a single instance so deeplinks route into the existing window.
// Dev allows multiple clients for room testing; each gets an isolated userData path.
if (!allowMultipleDevInstances) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    // Windows hot start — second instance passes argv
    app.on("second-instance", (_event, argv) => {
      const url = argv.find((arg) => arg.startsWith("yiqikan://"));
      if (url) handleDeepLink(url);
      if (currentMainWindow) {
        if (currentMainWindow.isMinimized()) currentMainWindow.restore();
        currentMainWindow.focus();
      }
    });
  }
}

app.whenReady().then(async () => {
  // On macOS, an Edit menu with standard roles is REQUIRED for Cmd+C/Cmd+V/Cmd+X/Cmd+A shortcuts to work.
  // On Windows/Linux, remove application menu to keep clean borderless window UI.
  if (process.platform === "darwin") {
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
      {
        role: "appMenu",
        submenu: [
          { role: "about", label: "关于异起看" },
          { type: "separator" },
          { role: "hide", label: "隐藏异起看" },
          { role: "hideOthers", label: "隐藏其他" },
          { role: "unhide", label: "显示全部" },
          { type: "separator" },
          { role: "quit", label: "退出异起看" },
        ],
      },
      {
        role: "editMenu",
        submenu: [
          { role: "undo", label: "撤销" },
          { role: "redo", label: "重做" },
          { type: "separator" },
          { role: "cut", label: "剪切" },
          { role: "copy", label: "复制" },
          { role: "paste", label: "粘贴" },
          { role: "selectAll", label: "全选" },
        ],
      },
      {
        role: "windowMenu",
        submenu: [
          { role: "minimize", label: "最小化" },
          { role: "zoom", label: "缩放" },
          { role: "close", label: "关闭窗口" },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  } else {
    Menu.setApplicationMenu(null);
  }

  registerWebviewAudioCaptureHandler();

  // Load built-in browser extension into defaultSession
  const extPath = getBuiltinExtensionPath();
  if (extPath) {
    try {
      const ext = await session.defaultSession.loadExtension(extPath, { allowFileAccess: true });
      console.info(`[Desktop] 内置浏览器扩展加载成功: ${ext.name} (v${ext.version})`);
    } catch (err) {
      console.error("[Desktop] 加载内置浏览器扩展失败:", err);
    }
  } else {
    console.warn("[Desktop] 未找到内置浏览器扩展路径");
  }
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

  function setupSession(targetSession: Electron.Session, isDefaultSession: boolean) {
    // Override User-Agent to remove Electron identifier — prevents bot detection on sites
    const chromeUA = targetSession.getUserAgent()
      .replace(/\s*Electron\/[\d.]+/, "")
      .replace(/\s*@[\w/-]+\/[\d.]+/, "");
    targetSession.setUserAgent(chromeUA);

    // Normalize request headers to match standard Chrome behavior
    targetSession.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, async (details, callback) => {
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

      // In defaultSession, ensure subframe requests to external video sources retain their cookies and legitimate referer
      if (isDefaultSession && (details.resourceType === "subFrame" || details.resourceType === "xhr")) {
        try {
          const reqUrl = new URL(details.url);
          const host = reqUrl.hostname;
          if (!host.includes("yiqikan") && !host.includes("localhost") && !host.includes("127.0.0.1")) {
            if (!headers["Referer"] || headers["Referer"].includes("yiqikan")) {
              headers["Referer"] = `${reqUrl.origin}/`;
            }
            const domainCookies = await targetSession.cookies.get({ domain: host });
            if (domainCookies && domainCookies.length > 0) {
              const existingCookie = headers["Cookie"] || headers["cookie"] || "";
              const cookieMap = new Map<string, string>();
              if (existingCookie) {
                for (const part of existingCookie.split(";")) {
                  const [k, ...v] = part.trim().split("=");
                  if (k) cookieMap.set(k, v.join("="));
                }
              }
              for (const c of domainCookies) {
                if (!cookieMap.has(c.name)) {
                  cookieMap.set(c.name, c.value);
                }
              }
              headers["Cookie"] = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
            }
          }
        } catch { /* ignore */ }
      }

      if (process.env.ELECTRON_RENDERER_URL) {
        captureRequest?.(String(details.id), details.url, details.method, headers as Record<string, string>);
      }
      callback({ requestHeaders: headers });
    });

    // Remove framing restrictions on subframes embedded in Yiqikan
    targetSession.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      if (details.resourceType === "subFrame") {
        for (const key of Object.keys(responseHeaders)) {
          const lower = key.toLowerCase();
          if (
            lower === "x-frame-options" ||
            lower === "frame-options" ||
            lower === "content-security-policy" ||
            lower === "cross-origin-opener-policy" ||
            lower === "cross-origin-embedder-policy"
          ) {
            delete responseHeaders[key];
          }
        }
      }
      callback({ responseHeaders });
    });

    // Auto-patch SameSite=None on WAF/CDN cookies so they work in cross-site iframes
    targetSession.cookies.on("changed", async (_event, cookie, _cause, removed) => {
      if (removed || !cookie || cookie.sameSite === "no_restriction") return;
      const name = (cookie.name || "").toLowerCase();
      if (
        name.includes("pow") ||
        name.includes("cf_") ||
        name.includes("waf") ||
        name.includes("shield") ||
        name.includes("phpsessid")
      ) {
        const rawDomain = cookie.domain || "";
        const domain = rawDomain.startsWith(".") ? rawDomain.slice(1) : rawDomain;
        const protocol = cookie.secure ? "https:" : "http:";
        const url = `${protocol}//${domain}${cookie.path || "/"}`;
        try {
          await targetSession.cookies.set({
            url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || "/",
            secure: true,
            httpOnly: cookie.httpOnly,
            sameSite: "no_restriction",
            expirationDate: cookie.expirationDate,
          });
        } catch { /* ignore */ }
      }
    });
  }

  // Setup defaultSession (used by online web room & iframes & verification popup)
  setupSession(session.defaultSession, true);
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return (
      permission === "fullscreen" ||
      permission === "media" ||
      permission === "clipboard-read" ||
      permission === "clipboard-sanitized-write"
    );
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === "media") {
      // macOS: ensure system-level microphone access is granted when the web page
      // requests audio (e.g. user clicks the mic button in the voice room).
      // askForMediaAccess triggers the macOS permission dialog on first use and
      // registers the app in System Settings → Privacy → Microphone.
      if (process.platform === "darwin") {
        const mediaDetails = details as Electron.MediaAccessPermissionRequest;
        const needsMic = mediaDetails?.mediaTypes?.includes("audio");
        if (needsMic) {
          const status = systemPreferences.getMediaAccessStatus("microphone");
          console.info(`[Desktop] 麦克风系统权限状态: ${status}`);
          if (status === "not-determined") {
            systemPreferences.askForMediaAccess("microphone").then((granted: boolean) => {
              console.info(`[Desktop] 麦克风授权弹窗结果: ${granted ? "已授权 ✅" : "被拒绝 ❌"}`);
              callback(granted);
            });
            return;
          } else if (status === "denied") {
            console.warn("[Desktop] 麦克风权限被系统拒绝，请在系统偏好设置中手动开启");
            callback(false);
            return;
          }
          // status === "granted" — fall through to callback(true)
        }
      }
      callback(true);
      return;
    }
    callback(
      permission === "fullscreen" ||
      permission === "clipboard-read" ||
      permission === "clipboard-sanitized-write"
    );
  });

  // Setup yiqikanSession (used by embedded webview for video playback sources)
  const yiqikanSession = session.fromPartition(WEBVIEW_PARTITION);
  yiqikanSession.setPreloads([webviewPreloadPath]);
  setupSession(yiqikanSession, false);
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

  // macOS cold start: check argv for protocol URL (fallback for some versions)
  const argvUrl = process.argv.find((arg) => arg.startsWith("yiqikan://"));
  if (argvUrl && !pendingDeepLinkUrl) handleDeepLink(argvUrl);

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
