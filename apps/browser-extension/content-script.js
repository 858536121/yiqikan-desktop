/**
 * YiVideo Extension Content Script (All Frames)
 * Ports and adapts universal player detection, ad filtering, audio boost,
 * and bidirectional postMessage synchronization with the Web Room top frame.
 */

(function () {
  const IS_TOP = window.self === window.top;

  const YIQIKAN_HOSTS = [
    "cpolar.cn",
    "cpolar.top",
    "yiqikan.club",
    "yiqikan.cn",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
  ];

  function isYiqikanHost(hostname) {
    if (!hostname || typeof hostname !== "string") return false;
    const h = hostname.toLowerCase();
    return YIQIKAN_HOSTS.some((y) => h === y || h.endsWith(`.${y}`));
  }

  function hasYiqikanAncestor() {
    try {
      if (window.location.ancestorOrigins && window.location.ancestorOrigins.length) {
        for (let i = 0; i < window.location.ancestorOrigins.length; i++) {
          const origin = window.location.ancestorOrigins[i];
          const url = new URL(origin);
          if (isYiqikanHost(url.hostname)) return true;
        }
        return false;
      }
    } catch (_) {}
    try {
      if (document.referrer) {
        const refHost = new URL(document.referrer).hostname;
        if (isYiqikanHost(refHost)) return true;
      }
    } catch (_) {}
    return false;
  }

  // 1. In top-level tabs: only active on Yiqikan domain to respond to ping and register tabId
  if (IS_TOP) {
    if (!isYiqikanHost(window.location.hostname)) {
      return; // 100% silent and zero-overhead on any external web browsing
    }

    try {
      chrome.runtime.sendMessage({
        action: "register-room-tab",
        url: window.location.href,
      });
    } catch (_) {}

    // Respond to extension detection ping from Web Room
    window.addEventListener("message", (event) => {
      if (event.data?.source === "yiqikan-ping") {
        try {
          chrome.runtime.sendMessage({
            action: "register-room-tab",
            url: window.location.href,
          });
          const extVersion = (typeof chrome !== "undefined" && chrome.runtime?.getManifest?.()?.version) || "";
          window.postMessage({ source: "yiqikan-pong", version: extVersion }, "*");
        } catch (_) {}
      }
    });

    return; // Top frame does not need video sync/player interception
  }

  // 2. In subframes: MUST be embedded inside a Yiqikan room
  if (!hasYiqikanAncestor()) {
    return; // 100% isolated on non-Yiqikan browsing
  }

  // Notify background worker of active room domain to prepare cookies & headers
  try {
    if (window.location.hostname) {
      chrome.runtime?.sendMessage?.({
        action: "room-domain-active",
        domain: window.location.hostname,
        url: window.location.href,
      });
    }
  } catch (_) {}

  const VIDEO_TAGS = ["video", "bwp-video"];
  const MSG_SOURCE_CHILD = "yiqikan-child-video";
  const MSG_SOURCE_SYNC = "yiqikan-sync-cmd";
  const MSG_SOURCE_FULLSCREEN = "yiqikan-fullscreen-change";
  const MSG_SOURCE_EXIT_FULLSCREEN = "yiqikan-exit-fullscreen";
  const MSG_SOURCE_HOST_MODE_REQUEST = "yiqikan-request-host-mode";

  const VIDEO_SCAN_INTERVAL_PLAYING_MS = 2000;
  const VIDEO_SCAN_INTERVAL_PAUSED_MS = 4000;
  const VIDEO_SCAN_INTERVAL_RECENT_IDLE_MS = 4000;
  const VIDEO_SCAN_INTERVAL_IDLE_MS = 7000;
  const VIDEO_SCAN_INTERVAL_HIDDEN_MS = 10000;
  const FULLSCREEN_TRANSITION_SUPPRESS_MS = 1200;
  const MAX_VIDEO_BOOST_GAIN = 8;
  const VOLUME_TAGS = ["video", "audio", "bwp-video"];

  function emitToParentOrTop(channel, payload) {
    const msg = { source: "yiqikan-bridge", channel, payload };
    try {
      window.top.postMessage(msg, "*");
    } catch (_) {
      try {
        window.parent.postMessage(msg, "*");
      } catch (_) {}
    }
  }


  // ------------------------------------------------------------------
  // In-Frame Link & Navigation Interception (Keep navigation inside Web Room)
  // ------------------------------------------------------------------
  if (!IS_TOP) {
    const IS_DIRECT_EMBEDDED_FRAME = window.parent === window.top;

    function isValidPageUrl(url) {
      if (!url || typeof url !== "string") return false;
      if (url === "about:blank" || url.startsWith("javascript:") || url.startsWith("data:") || url.startsWith("blob:")) return false;
      if (url.includes("leader-election") || url.includes("/bfs/seed/") || url.includes("pos.baidu.com")) return false;
      return true;
    }

    // 1. Sanitize <base target> directly in DOM without injecting inline scripts (CSP immune)
    function sanitizeBases() {
      try {
        document.querySelectorAll("base[target]").forEach((b) => {
          const t = (b.getAttribute("target") || "").toLowerCase();
          if (t === "_blank" || t === "_top" || t === "_parent") {
            b.setAttribute("target", "_self");
            b.target = "_self";
          }
        });
      } catch (_) {}
    }
    sanitizeBases();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", sanitizeBases);
    }

    // 2. Intercept link clicks, button clicks and form submits in capture phase
    function findAnchorElement(e) {
      const path = e.composedPath ? e.composedPath() : [];
      for (const el of path) {
        if (el && el.tagName === "A" && el.href) {
          return el;
        }
      }
      return e.target && e.target.closest ? e.target.closest("a[href]") : null;
    }

    document.addEventListener(
      "click",
      (e) => {
        const path = e.composedPath ? e.composedPath() : [];
        for (const el of path) {
          if (!el || !el.tagName) continue;
          const tag = el.tagName.toUpperCase();
          if (tag === "BUTTON" || tag === "INPUT") {
            const form = el.form || el.closest?.("form");
            if (form) {
              const t = (form.getAttribute("target") || form.target || "").toLowerCase();
              if (t === "_blank" || t === "_top" || t === "_parent") {
                form.setAttribute("target", "_self");
                form.target = "_self";
              }
            }
            const ft = (el.getAttribute("formtarget") || el.formTarget || "").toLowerCase();
            if (ft === "_blank" || ft === "_top" || ft === "_parent") {
              el.setAttribute("formtarget", "_self");
              el.formTarget = "_self";
            }
          }
        }

        const anchor = findAnchorElement(e);
        if (!anchor || !anchor.href) return;

        const href = anchor.href;
        if (href.startsWith("javascript:") || href.startsWith("#") || href.startsWith("mailto:")) return;

        // Force target to _self so the iframe navigates in-place
        const target = (anchor.getAttribute("target") || "").toLowerCase();
        if (target === "_blank" || target === "_top" || target === "_parent") {
          anchor.setAttribute("target", "_self");
          anchor.target = "_self";
        }
      },
      true // Capture phase: intercepts BEFORE website handlers
    );

    // 3. Intercept form submits and Enter key in capture phase
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter") {
          const form = e.target?.form || e.target?.closest?.("form");
          if (form) {
            form.setAttribute("target", "_self");
            form.target = "_self";
          }
        }
      },
      true
    );

    document.addEventListener(
      "submit",
      (e) => {
        const form = e.target;
        if (!form) return;
        const target = (form.getAttribute("target") || form.target || "").toLowerCase();
        if (target === "_blank" || target === "_top" || target === "_parent") {
          form.setAttribute("target", "_self");
          form.target = "_self";
        }
        if (e.submitter) {
          const sTarget = (e.submitter.getAttribute("formtarget") || e.submitter.formTarget || "").toLowerCase();
          if (sTarget === "_blank" || sTarget === "_top" || sTarget === "_parent") {
            e.submitter.setAttribute("formtarget", "_self");
            e.submitter.formTarget = "_self";
          }
        }
      },
      true
    );

    // 4. Continuously sanitize dynamic DOM
    const sanitizeNode = (node) => {
      if (!node || node.nodeType !== 1) return;
      if (node.tagName === "FORM" || node.tagName === "A" || node.tagName === "BASE") {
        const t = (node.getAttribute("target") || "").toLowerCase();
        if (t === "_blank" || t === "_top" || t === "_parent") {
          node.setAttribute("target", "_self");
          node.target = "_self";
        }
      }
      if (node.querySelectorAll) {
        node.querySelectorAll("base[target], form[target], a[target], button[formtarget], input[formtarget]").forEach((el) => {
          el.setAttribute("target", "_self");
          if ("target" in el) el.target = "_self";
          if ("formTarget" in el) {
            el.setAttribute("formtarget", "_self");
            el.formTarget = "_self";
          }
        });
      }
    };

    try {
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "childList") {
            m.addedNodes.forEach(sanitizeNode);
          } else if (m.type === "attributes") {
            sanitizeNode(m.target);
          }
        }
      });
      observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["target", "formtarget"],
      });
    } catch (_) {}

    // 5. Track URL and SPA history navigation (ONLY for the primary embedded frame, NOT nested sub-iframes)
    if (IS_DIRECT_EMBEDDED_FRAME) {
      let lastReportedHref = "";
      function reportUrlChange() {
        const current = window.location.href;
        if (isValidPageUrl(current) && current !== lastReportedHref) {
          lastReportedHref = current;
          emitToParentOrTop("yiqikan:page-navigated", {
            url: current,
            title: document.title || getCleanVideoTitle(),
          });
        }
      }

      window.addEventListener("popstate", reportUrlChange);
      window.addEventListener("hashchange", reportUrlChange);
      window.addEventListener("yiqikan:urlchange", reportUrlChange);
      document.addEventListener("DOMContentLoaded", () => {
        reportUrlChange();
        try {
          document.querySelectorAll("base[target], form[target], a[target]").forEach((b) => {
            const t = (b.getAttribute("target") || "").toLowerCase();
            if (t === "_blank" || t === "_top" || t === "_parent") {
              b.setAttribute("target", "_self");
              b.target = "_self";
            }
          });
        } catch (_) {}
      });
      setInterval(reportUrlChange, 1500);
    }
  }

  // Patch navigator.webdriver if present to prevent anti-bot tripping
  try {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  } catch (_) {}

  // ------------------------------------------------------------------
  // Audio Boost
  // ------------------------------------------------------------------
  const mediaBoostStates = new WeakMap();
  let currentVolumeLevel = 1;

  function volumeLevelToGain(level) {
    const clamped = Math.max(0, Math.min(MAX_VIDEO_BOOST_GAIN, level));
    if (clamped <= 1) return clamped;
    const normalized = (clamped - 1) / (MAX_VIDEO_BOOST_GAIN - 1);
    return Math.pow(MAX_VIDEO_BOOST_GAIN, normalized);
  }

  function applyVolumeToVideos(vol) {
    currentVolumeLevel = Math.max(0, Math.min(MAX_VIDEO_BOOST_GAIN, vol));
    for (const tag of VOLUME_TAGS) {
      const elements = document.getElementsByTagName(tag);
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (!(el instanceof HTMLMediaElement)) {
          try { el.volume = Math.max(0, Math.min(1, vol)); } catch (_) {}
          continue;
        }

        if (currentVolumeLevel <= 1) {
          const boost = mediaBoostStates.get(el);
          if (boost) {
            try { boost.gain.gain.setTargetAtTime(1, boost.ctx.currentTime, 0.03); } catch (_) {}
          }
          try { el.volume = currentVolumeLevel; } catch (_) {}
          continue;
        }

        try { el.volume = 1; } catch (_) {}

        let boost = mediaBoostStates.get(el);
        if (!boost) {
          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) continue;
            const ctx = new AudioCtx();
            const source = ctx.createMediaElementSource(el);
            const gain = ctx.createGain();
            gain.gain.value = volumeLevelToGain(currentVolumeLevel);
            source.connect(gain);
            gain.connect(ctx.destination);
            boost = { ctx, source, gain };
            mediaBoostStates.set(el, boost);
          } catch (_) {
            try { el.volume = 1; } catch (_) {}
            continue;
          }
        } else {
          try { boost.gain.gain.setTargetAtTime(volumeLevelToGain(currentVolumeLevel), boost.ctx.currentTime, 0.03); } catch (_) {}
        }

        if (boost.ctx.state === "suspended") {
          boost.ctx.resume().catch(() => {});
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Platform Player Wrappers
  // ------------------------------------------------------------------
  function getCleanVideoTitle() {
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
    } catch (_) {
      return "当前视频";
    }
  }

  function getTencentPlayerWrapper() {
    try {
      const playerObj = window.__PLAYER__;
      if (playerObj && playerObj.corePlayer && playerObj.currentVideoInfo) {
        return {
          isPlatformAdapter: true,
          get currentTime() { return Number(playerObj.currentVideoInfo?.playtime || 0); },
          set currentTime(val) { playerObj.seek?.(val); },
          get duration() { return Number(playerObj.currentVideoInfo?.duration || 0); },
          get paused() { return Boolean(playerObj.paused ?? playerObj.corePlayer?.paused); },
          get playbackRate() { return Number(playerObj.playbackRate || 1); },
          set playbackRate(r) { if (playerObj.setPlaybackRate) playerObj.setPlaybackRate(r); else playerObj.playbackRate = r; },
          get readyState() { return 4; },
          play: () => playerObj.corePlayer.play(),
          pause: () => playerObj.corePlayer.pause(),
          seek: (time) => playerObj.seek?.(time),
        };
      }
    } catch (_) {}
    return null;
  }

  function getBaiduPanPlayerWrapper() {
    try {
      if (window.location.host.includes("pan.baidu.com")) {
        const vjs = document.querySelector(".vjs-controls-enabled")?.player;
        if (vjs && typeof vjs.currentTime === "function") {
          return {
            isPlatformAdapter: true,
            get currentTime() { return Number(vjs.currentTime() || 0); },
            set currentTime(val) { vjs.currentTime(val); },
            get duration() { return Number(vjs.duration() || 0); },
            get paused() { return Boolean(vjs.paused()); },
            get playbackRate() { return Number(vjs.playbackRate() || 1); },
            set playbackRate(r) { vjs.playbackRate(r); },
            get readyState() { return vjs.readyState ? vjs.readyState() : 4; },
            play: () => vjs.play(),
            pause: () => vjs.pause(),
            seek: (time) => vjs.currentTime(time),
          };
        }
      }
    } catch (_) {}
    return null;
  }

  function wrapVideoElement(v) {
    return {
      element: v,
      isPlatformAdapter: false,
      get currentTime() { return v.currentTime || 0; },
      set currentTime(val) { v.currentTime = val; },
      get duration() { return v.duration || 0; },
      get paused() { return v.paused; },
      get playbackRate() { return v.playbackRate || 1; },
      set playbackRate(r) { try { v.playbackRate = r; } catch (_) {} },
      get readyState() { return v.readyState || 0; },
      play: () => {
        try {
          const p = v.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch (_) {}
      },
      pause: () => {
        try { v.pause(); } catch (_) {}
      },
      seek: (time) => {
        try {
          let t = Math.max(0, time);
          const d = v.duration;
          if (isFinite(d) && d > 0) {
            t = Math.min(d - 0.2, t);
          }
          v.currentTime = t;
        } catch (_) {}
      },
    };
  }

  function isAdOrThumbnailVideo(v) {
    try {
      if (v.VideoTogetherDisabled) return true;
      const hostname = window.location.hostname.toLowerCase();

      // 1. Bilibili thumbnails in cards
      if (hostname.endsWith("bilibili.com")) {
        if (v.closest("div.video-page-card-small") || v.closest("div.feed-card") || v.closest(".bili-video-card__stats")) {
          return true;
        }
      }

      // 2. iQiyi ad layers - only if video is inside active ad container
      if (hostname.endsWith("iqiyi.com")) {
        if (v.closest(".iqp-ad, .iqp-player-ad, [class*='ad-container']") && !v.closest(".iqp-player-videolayer-inner")) {
          return true;
        }
      }

      // 3. Tencent Video ads - only if strictly inside active ad wrapper, not the main player container
      if (hostname.endsWith("v.qq.com")) {
        if (v.closest(".txp_ad_control, .txp_ad_container, .txp_ad_layer") && !v.closest(".txp_videos_container")) {
          return true;
        }
      }

      // 4. Youku ads
      if (hostname.endsWith("youku.com")) {
        if (v.closest(".advertise-layer, .ad-layer") && v.duration && v.duration < 120) {
          return true;
        }
      }

      // 5. Tiny background preview / icons
      if (v.duration && v.duration < 3 && (v.offsetWidth < 60 || v.offsetHeight < 60)) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function calculateVideoScore(v) {
    if (isAdOrThumbnailVideo(v)) return -1000;

    const hasStream = Boolean(v.src || v.currentSrc);
    const width = v.offsetWidth || 0;
    const height = v.offsetHeight || 0;

    // Discard empty auxiliary tags with no stream or tiny layout
    if (!hasStream && (!v.duration || isNaN(v.duration))) {
      return -500;
    }

    let score = 0;

    // Visual area weighting - primary player viewport
    if (width >= 200 && height >= 120) {
      score += Math.min(800, (width * height) / 1000);
    }

    // Active playback status weighting (highest priority: current playing stream)
    if (!v.paused && v.currentTime > 0.1) {
      score += 1000;
    } else if (!v.paused) {
      score += 500;
    }

    // ReadyState weighting (ready to play/buffered)
    if (v.readyState >= 3) {
      score += 400;
    } else if (v.readyState >= 1) {
      score += 200;
    }

    // Stream presence
    if (hasStream) {
      score += 300;
    }

    // Balanced duration weighting (capped to 150 to avoid lingering old video dominating new video on SPA switch)
    const duration = v.duration || 0;
    if (isFinite(duration) && duration > 0) {
      score += Math.min(150, duration / 20);
    }

    const hostname = window.location.hostname.toLowerCase();
    if (hostname.endsWith("iqiyi.com") && v.closest(".iqp-player-videolayer-inner")) {
      score += 1000;
    }
    if (hostname.endsWith("v.qq.com") && v.closest(".txp_videos_container")) {
      score += 500;
    }

    return score;
  }

  function findBestPlayerInFrame() {
    const tencent = getTencentPlayerWrapper();
    if (tencent) return tencent;

    const baidu = getBaiduPanPlayerWrapper();
    if (baidu) return baidu;

    let best = null;
    let bestScore = -1;

    for (const tag of VIDEO_TAGS) {
      const elements = document.getElementsByTagName(tag);
      for (let i = 0; i < elements.length; i++) {
        const v = elements[i];
        const score = calculateVideoScore(v);
        if (score > bestScore) {
          bestScore = score;
          best = v;
        }
      }
    }

    return best ? wrapVideoElement(best) : null;
  }

  // ------------------------------------------------------------------
  // DOM Mutation Observer
  // ------------------------------------------------------------------
  try {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
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
          } catch (_) {}
        }
      }
    });
    const target = document.documentElement || document.body;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }, { once: true });
    }
  } catch (_) {}

  // ------------------------------------------------------------------
  // Video Status Reporting (via postMessage)
  // ------------------------------------------------------------------
  function buildStatus(p) {
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
  let reportTimer = null;
  let fullscreenTransitionUntil = 0;


  function reportFromThisFrame(force = false) {
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

    emitToParentOrTop("yiqikan:video-status", status);
  }

  function forceReport() {
    lastReportKey = "";
    lastReportTs = 0;
    reportFromThisFrame(true);
  }

  function getNextReportDelay() {
    if (document.hidden) return VIDEO_SCAN_INTERVAL_HIDDEN_MS;
    const p = findBestPlayerInFrame();
    if (p) return p.paused ? VIDEO_SCAN_INTERVAL_PAUSED_MS : VIDEO_SCAN_INTERVAL_PLAYING_MS;
    const idleFor = Date.now() - lastVideoFoundAt;
    return idleFor < 15000 ? VIDEO_SCAN_INTERVAL_RECENT_IDLE_MS : VIDEO_SCAN_INTERVAL_IDLE_MS;
  }

  function scheduleNextReport(delay = getNextReportDelay()) {
    if (reportTimer) window.clearTimeout(reportTimer);
    reportTimer = window.setTimeout(() => {
      reportFromThisFrame();
      scheduleNextReport();
    }, delay);
  }

  scheduleNextReport(1200);
  document.addEventListener("visibilitychange", () => {
    scheduleNextReport(document.hidden ? VIDEO_SCAN_INTERVAL_HIDDEN_MS : 500);
  });

  for (const evt of ["loadstart", "loadedmetadata", "loadeddata", "canplay", "play", "playing", "pause", "seeked", "ratechange"]) {
    document.addEventListener(evt, (e) => {
      const tag = e.target?.tagName?.toUpperCase();
      if (tag === "VIDEO" || tag === "BWP-VIDEO") {
        forceReport();
        scheduleNextReport(600);
      }
    }, true);
  }

  setTimeout(forceReport, 100);
  setTimeout(forceReport, 500);
  setTimeout(forceReport, 1500);
  setTimeout(forceReport, 3000);

  // ------------------------------------------------------------------
  // Command Execution (Received from Web Room via window.postMessage)
  // ------------------------------------------------------------------
  let smoothRateTimer = null;
  let syncInProgressUntil = 0;

  function applySyncToVideo(cmd) {
    const player = findBestPlayerInFrame();
    if (!player) return;

    syncInProgressUntil = Date.now() + 800;

    const isForced = Boolean(cmd.force);
    const nextSyncId = typeof cmd.syncId === "number" ? cmd.syncId : 0;
    const nextTimestamp = typeof cmd.localTimestamp === "number" ? cmd.localTimestamp : 0;
    const lastSyncId = typeof window.__yiqikan_last_sync_id === "number" ? window.__yiqikan_last_sync_id : 0;
    const lastSyncTimestamp = typeof window.__yiqikan_last_sync_ts === "number" ? window.__yiqikan_last_sync_ts : 0;

    if (!isForced) {
      if (nextSyncId > 0 && nextSyncId < lastSyncId) return;
      if (nextSyncId === lastSyncId && nextTimestamp > 0 && nextTimestamp <= lastSyncTimestamp) return;
      if (nextSyncId === 0 && lastSyncId > 0 && nextTimestamp > 0 && nextTimestamp <= lastSyncTimestamp) return;
    }
    window.__yiqikan_last_sync_id = Math.max(lastSyncId, nextSyncId);
    window.__yiqikan_last_sync_ts = Math.max(lastSyncTimestamp, nextTimestamp);

    const baseRate = typeof cmd.playbackRate === "number" ? cmd.playbackRate : 1;

    if (typeof cmd.currentTime === "number") {
      let target = cmd.currentTime;
      if (!cmd.paused && typeof cmd.localTimestamp === "number") {
        const elapsed = Date.now() / 1000 - cmd.localTimestamp;
        if (elapsed > 0 && elapsed < 3600) {
          target += elapsed * baseRate;
        }
      }

      const current = player.currentTime;
      const diff = target - current;
      const absDiff = Math.abs(diff);

      if (cmd.paused || absDiff > 0.6 || isForced) {
        if (absDiff > 0.05 || isForced) {
          player.seek(target);
        }
        if (smoothRateTimer) {
          window.clearTimeout(smoothRateTimer);
          smoothRateTimer = null;
        }
        player.playbackRate = baseRate;
      } else if (absDiff > 0.3 && !player.paused) {
        const rateMultiplier = diff > 0 ? 1.06 : 0.94;
        const temporaryRate = Math.max(0.25, Math.min(4, baseRate * rateMultiplier));
        player.playbackRate = temporaryRate;

        if (smoothRateTimer) window.clearTimeout(smoothRateTimer);
        smoothRateTimer = window.setTimeout(() => {
          const p = findBestPlayerInFrame();
          if (p) p.playbackRate = baseRate;
          smoothRateTimer = null;
        }, 1500);
      } else if (absDiff <= 0.3) {
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
      } else if (!cmd.paused && (cmd.allowResume !== false)) {
        const p = player.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {});
        }
      }
    }

    if (typeof cmd.playbackRate === "number" && !smoothRateTimer) {
      if (player.playbackRate !== cmd.playbackRate) {
        player.playbackRate = cmd.playbackRate;
      }
    }
  }

  function forwardToSubframes(msgData) {
    try {
      const frames = window.frames;
      if (!frames || !frames.length) return;
      for (let i = 0; i < frames.length; i++) {
        try {
          frames[i].postMessage(msgData, "*");
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Listen for sync messages from the Web Room top window
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data) return;

    if (data.channel === "yiqikan:video-sync" || data.channel === "yiqikan:sync-cmd") {
      const cmd = data.payload || data.args?.[0] || data.cmd;
      if (cmd) applySyncToVideo(cmd);
      forwardToSubframes(data);
    } else if (data.channel === "yiqikan:force-pause") {
      const player = findBestPlayerInFrame();
      try { player?.pause(); } catch (_) {}
      forwardToSubframes(data);
    } else if (data.channel === "yiqikan:set-volume") {
      const vol = data.payload?.volume ?? data.volume ?? 1;
      applyVolumeToVideos(vol);
      forwardToSubframes(data);
    } else if (data.channel === "yiqikan:history-back") {
      try { window.history.back(); } catch (_) {}
    } else if (data.channel === "yiqikan:history-forward") {
      try { window.history.forward(); } catch (_) {}
    }
  });

  console.info("[YiVideo Extension] Injected frame script active.");
})();

