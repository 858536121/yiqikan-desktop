import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, PanResponder, AppState, Alert, Platform, BackHandler } from 'react-native';
import { WebView } from 'react-native-webview';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useRoomStore } from '../store/useRoomStore';
import { socketService } from '../services/socket';
import { mobileSyncCommand, type RealtimePlayback } from '../utils/playback-sync';
import Slider from '@react-native-community/slider';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { 
  Play, 
  Pause, 
  ChevronLeft, 
  Lightbulb, 
  MessageSquare,
  MessageSquareText,
  Lock,
  FastForward,
  Mic,
  MicOff,
  Minimize2
} from 'lucide-react-native';
import { DanmakuOverlay } from './app/danmaku-overlay';
import { LandscapeDrawer } from './app/landscape-drawer';
import { SeekBackward10Icon, SeekForward10Icon } from './icons/SeekStepIcons';
import { usePlaybackScrub } from '../hooks/use-playback-scrub';
import { useVoice } from '../services/voice-service';
import { formatTime } from '../utils/time';
import { generateLocalVideoPlayerHtml } from '../utils/local-player-html';
import { PC_USER_AGENT } from '../utils/browser-user-agent';
import { createWebPlayerScript } from '../utils/web-player-script';
import { PlayerTransitionNotice } from './app/player-transition-notice';
import { PlayerTransition, type LocalMedia, type PlayerMode } from '../utils/player-transition';

const INJECTED_BEFORE_LOAD_SCRIPT = `
(function() {
  if (window.__YIQIKAN_EARLY_INJECTED) return;
  window.__YIQIKAN_EARLY_INJECTED = true;

  // 1. 全局真实手势时间戳记录（严格区分用户主动交互与网页脚本自动触发）
  window.__lastUserTouchTime = 0;
  function markTouch() {
    window.__lastUserTouchTime = Date.now();
  }
  window.addEventListener('touchstart', markTouch, { passive: true, capture: true });
  window.addEventListener('pointerdown', markTouch, { passive: true, capture: true });
  window.addEventListener('mousedown', markTouch, { passive: true, capture: true });

  function postMsg(data) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      }
    } catch(e) {}
  }

  // 2. window.open 与安全/权限拦截
  try {
    function isSafeWebUrl(u) {
      if (!u || typeof u !== 'string') return false;
      try {
        var parsed = new URL(u, document.baseURI || window.location.href);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ||
          (parsed.protocol === 'about:' && (parsed.pathname === 'blank' || parsed.pathname === 'srcdoc')) ||
          parsed.protocol === 'data:' || parsed.protocol === 'blob:';
      } catch (e) { return false; }
    }

    window.open = function(url) {
      if (window.__canNavigate === false) {
        postMsg({ type: 'HOST_ONLY_WARNING', message: '跟随房主中，可切换自由浏览进行跳转' });
        return { closed: true, location: {}, focus: function(){}, close: function(){} };
      }
      if (!isSafeWebUrl(url)) {
        postMsg({ type: 'LOG', msg: '已拦截非Web协议弹窗: ' + url });
        return { closed: true, location: {}, focus: function(){}, close: function(){} };
      }
      if (url && typeof url === 'string' && url !== 'about:blank') {
        window.location.href = url;
      }
      return window;
    };
  } catch (e) {}

  // 3. 全网通用：底层强制内联播放（Inline）与 iOS 原生全屏弹窗屏蔽
  try {
    function makeInline(v) {
      if (!v || !v.setAttribute) return;
      try {
        if (!v.hasAttribute('playsinline')) v.setAttribute('playsinline', 'true');
        if (!v.hasAttribute('webkit-playsinline')) v.setAttribute('webkit-playsinline', 'true');
        if (!v.hasAttribute('x5-playsinline')) v.setAttribute('x5-playsinline', 'true');
        if (!v.hasAttribute('x5-video-player-type')) v.setAttribute('x5-video-player-type', 'h5');
        v.playsInline = true;
        if ('webkitPlaysInline' in v) v.webkitPlaysInline = true;
      } catch(e) {}
    }

    // A. 拦截 document.createElement：动态创建的 video/bwp-video 元素在生成时即被注入 playsinline
    var origCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function(tagName, options) {
      var el = origCreateElement.call(this, tagName, options);
      if (el && typeof tagName === 'string') {
        var lower = tagName.toLowerCase();
        if (lower === 'video' || lower === 'bwp-video') {
          makeInline(el);
        }
      }
      return el;
    };

    // B. Hook HTMLMediaElement & HTMLVideoElement 原型链
    if (window.HTMLMediaElement && HTMLMediaElement.prototype) {
      var origMediaPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        if (this && (this.tagName === 'VIDEO' || this.tagName === 'BWP-VIDEO')) {
          makeInline(this);
        }
        return origMediaPlay.apply(this, arguments);
      };
    }

    if (window.HTMLVideoElement && HTMLVideoElement.prototype) {
      var videoProto = HTMLVideoElement.prototype;

      // 兜底防御 HTMLVideoElement 自身定义的 play
      if (videoProto.play && videoProto.play !== HTMLMediaElement.prototype.play) {
        var origVideoPlay = videoProto.play;
        videoProto.play = function() {
          makeInline(this);
          return origVideoPlay.apply(this, arguments);
        };
      }

      // 彻底阻断 iOS 原生 webkitEnterFullscreen 弹窗（防止唤起 QuickTime/AVPlayer 破坏房间同步与覆盖层）
      videoProto.webkitEnterFullscreen = function() {
        makeInline(this);
        // 仅在真实手势（点击播放器全屏按钮）1200ms 内，才将意图传给 App 进入自定义横屏影院全屏
        // 网页脚本若在加载、自动播放时未经手势静默调用，直接静默忽略
        var touchTime = window.__lastUserTouchTime || 0;
        if (Date.now() - touchTime < 1200) {
          postMsg({ type: 'REQUEST_FULLSCREEN' });
        }
        return Promise.resolve();
      };

      videoProto.webkitExitFullscreen = function() {
        var touchTime = window.__lastUserTouchTime || 0;
        if (Date.now() - touchTime < 1200) {
          postMsg({ type: 'EXIT_FULLSCREEN' });
        }
        return Promise.resolve();
      };

      try {
        Object.defineProperty(videoProto, 'webkitSupportsFullscreen', {
          get: function() { return true; },
          configurable: true
        });
      } catch(e) {}
    }

    // C. 拦截标准的 Element.prototype.requestFullscreen（适配各大现代 Web 播放器全屏按钮）
    var handleFullscreenRequest = function() {
      if (this && this.tagName && (this.tagName === 'VIDEO' || this.tagName === 'BWP-VIDEO' || (this.querySelector && this.querySelector('video, bwp-video')))) {
        makeInline(this.tagName === 'VIDEO' ? this : this.querySelector('video, bwp-video'));
      }
      var touchTime = window.__lastUserTouchTime || 0;
      if (Date.now() - touchTime < 1200) {
        postMsg({ type: 'REQUEST_FULLSCREEN' });
      }
      return Promise.resolve();
    };

    if (window.Element && Element.prototype) {
      if (typeof Element.prototype.requestFullscreen === 'function') {
        Element.prototype.requestFullscreen = handleFullscreenRequest;
      }
      if (typeof Element.prototype.webkitRequestFullscreen === 'function') {
        Element.prototype.webkitRequestFullscreen = handleFullscreenRequest;
      }
    }

    // D. 拦截 document.exitFullscreen
    var handleExitFullscreen = function() {
      var touchTime = window.__lastUserTouchTime || 0;
      if (Date.now() - touchTime < 1200) {
        postMsg({ type: 'EXIT_FULLSCREEN' });
      }
      return Promise.resolve();
    };
    document.exitFullscreen = handleExitFullscreen;
    if ('webkitExitFullscreen' in document) {
      document.webkitExitFullscreen = handleExitFullscreen;
    }

    // E. 伪造标准全屏能力支持，确保各大网站播放器 UI 上正常亮起全屏按钮
    try {
      Object.defineProperty(document, 'fullscreenEnabled', { get: function() { return true; }, configurable: true });
      Object.defineProperty(document, 'webkitFullscreenEnabled', { get: function() { return true; }, configurable: true });
    } catch(e) {}

    // F. Early MutationObserver：在 HTML 流式解析的第一毫秒为进入 DOM 的视频标签注入 playsinline
    var earlyObserver = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node && node.nodeType === 1) {
            if (node.tagName === 'VIDEO' || node.tagName === 'BWP-VIDEO') {
              makeInline(node);
            } else if (node.querySelectorAll) {
              var vids = node.querySelectorAll('video, bwp-video');
              for (var k = 0; k < vids.length; k++) {
                makeInline(vids[k]);
              }
            }
          }
        }
      }
    });
    earlyObserver.observe(document, { childList: true, subtree: true });
  } catch (e) {}
})();
true;
`;

const INJECTED_SCRIPT = `
// 1. 拦截非法协议与 window.open，强制在当前安全 Web 容器中加载
try {
  function isSafeWebUrl(u) {
    if (!u || typeof u !== 'string') return false;
    try {
      var parsed = new URL(u, document.baseURI || window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ||
        (parsed.protocol === 'about:' && (parsed.pathname === 'blank' || parsed.pathname === 'srcdoc')) ||
        parsed.protocol === 'data:' || parsed.protocol === 'blob:';
    } catch (e) { return false; }
  }

  window.open = function(url) {
    if (window.__canNavigate === false) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'HOST_ONLY_WARNING', message: '跟随房主中，可切换自由浏览进行跳转' }));
      }
      return { closed: true, location: {}, focus: function(){}, close: function(){} };
    }
    if (!isSafeWebUrl(url)) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'LOG', msg: '已拦截非Web协议弹窗: ' + url }));
      }
      return { closed: true, location: {}, focus: function(){}, close: function(){} };
    }
    if (url && typeof url === 'string' && url !== 'about:blank') {
      window.location.href = url;
    }
    return window;
  };
} catch (e) {}

// 2. 点击事件拦截：重写 target 为 _self，并对跟随页面模式及第三方应用私有 Scheme 进行阻断
document.addEventListener('click', (e) => {
  const anchor = e.target && e.target.closest ? e.target.closest('a') : null;
  if (anchor && anchor.href) {
    var lowerHref = anchor.href.trim().toLowerCase();
    var isWebHref = lowerHref.startsWith('http://') || lowerHref.startsWith('https://') ||
      /^about:(blank|srcdoc)([?#]|$)/.test(lowerHref) || lowerHref.startsWith('data:') || lowerHref.startsWith('blob:');
    // 通用协议策略，不依赖网站或 App 名单；站内 JavaScript 控件仍交给页面处理。
    if (!lowerHref.startsWith('javascript:') && !isWebHref) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (anchor.target && anchor.target.toLowerCase() !== '_self') {
      anchor.target = '_self';
    }
    if (window.__canNavigate === false && anchor.href && !anchor.href.startsWith('javascript:')) {
      e.preventDefault();
      e.stopPropagation();
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'HOST_ONLY_WARNING', message: '跟随房主中，可切换自由浏览进行跳转' }));
      }
      return;
    }
  }

  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'TOGGLE_CONTROLS' }));
  }
}, true);

document.addEventListener('touchstart', (e) => {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'TOUCH_INTERACT' }));
  }
}, { passive: true, capture: true });

(function() {
  if (window.__YIQIKAN_INJECTED) return;
  window.__YIQIKAN_INJECTED = true;

  const sendMessage = (msg) => {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };

  function getCleanVideoTitle() {
    try {
      var title = document.title || "";
      title = title
        .replace(/_哔哩哔哩_bilibili.*$/i, "")
        .replace(/- 腾讯视频.*$/i, "")
        .replace(/- 优酷.*$/i, "")
        .replace(/- 爱奇艺.*$/i, "")
        .replace(/_芒果TV.*$/i, "")
        .replace(/【[^】]*】/g, "")
        .trim();
      return title.length > 40 ? title.slice(0, 40) + "..." : (title || "当前视频");
    } catch (e) { return "当前视频"; }
  }

  function getTencentPlayerWrapper() {
    try {
      var playerObj = window.__PLAYER__;
      if (playerObj && playerObj.corePlayer && playerObj.currentVideoInfo) {
        return {
          isPlatformAdapter: true,
          get currentTime() { return Number(playerObj.currentVideoInfo.playtime || 0); },
          set currentTime(val) { playerObj.seek && playerObj.seek(val); },
          get duration() { return Number(playerObj.currentVideoInfo.duration || 0); },
          get paused() { return Boolean(playerObj.paused || (playerObj.corePlayer && playerObj.corePlayer.paused)); },
          get playbackRate() { return Number(playerObj.playbackRate || 1); },
          set playbackRate(r) { if (playerObj.setPlaybackRate) playerObj.setPlaybackRate(r); else playerObj.playbackRate = r; },
          play: function() { return playerObj.corePlayer.play(); },
          pause: function() { return playerObj.corePlayer.pause(); },
          seek: function(time) { playerObj.seek && playerObj.seek(time); }
        };
      }
    } catch (e) {}
    return null;
  }

  function getBaiduPanPlayerWrapper() {
    try {
      if (window.location.host.indexOf("pan.baidu.com") !== -1) {
        var el = document.querySelector(".vjs-controls-enabled");
        var vjs = el && el.player;
        if (vjs && typeof vjs.currentTime === "function") {
          return {
            isPlatformAdapter: true,
            get currentTime() { return vjs.currentTime() || 0; },
            set currentTime(val) { vjs.currentTime(val); },
            get duration() { return vjs.duration() || 0; },
            get paused() { return vjs.paused(); },
            get readyState() { return vjs.readyState ? vjs.readyState() : undefined; },
            get seeking() { return vjs.seeking ? vjs.seeking() : false; },
            get playbackRate() { return vjs.playbackRate() || 1; },
            set playbackRate(r) { vjs.playbackRate(r); },
            play: function() { return vjs.play(); },
            pause: function() { return vjs.pause(); },
            seek: function(time) { vjs.currentTime(time); }
          };
        }
      }
    } catch (e) {}
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
      get readyState() { return v.readyState; },
      get seeking() { return v.seeking; },
      get playbackRate() { return v.playbackRate || 1; },
      set playbackRate(r) { try { v.playbackRate = r; } catch (e) {} },
      play: function() { return v.play(); },
      pause: function() { return v.pause(); },
      seek: function(time) { v.currentTime = time; }
    };
  }

  function isAdOrThumbnailVideo(v) {
    try {
      if (v.VideoTogetherDisabled) return true;
      var host = (window.location.hostname || "").toLowerCase();
      if (host.indexOf("bilibili.com") !== -1) {
        if (v.closest && (v.closest("div.video-page-card-small") || v.closest("div.feed-card") || v.closest(".bili-video-card__stats"))) return true;
      }
      if (host.indexOf("iqiyi.com") !== -1) {
        var cdTimes = document.querySelectorAll(".cd-time");
        for (var i = 0; i < cdTimes.length; i++) {
          if (cdTimes[i].offsetParent !== null && v.duration && v.duration < 120 && !(v.closest && v.closest(".iqp-player-videolayer-inner"))) {
            return true;
          }
        }
      }
      if (host.indexOf("v.qq.com") !== -1) {
        var adCtrls = document.querySelectorAll('.txp_ad_control:not(.txp_none)[data-role="creative-player-video-ad-control"]');
        if (adCtrls.length > 0 && v.duration && v.duration < 120) return true;
      }
      if (host.indexOf("youku.com") !== -1) {
        if (document.querySelector(".advertise-layer div") && v.duration && v.duration < 120) return true;
      }
      if (v.duration && v.duration < 5 && (v.offsetWidth < 60 || v.offsetHeight < 60)) return true;
    } catch (e) {}
    return false;
  }

  function calculateVideoScore(v) {
    if (isAdOrThumbnailVideo(v)) return -1000;
    var score = 0;
    var duration = v.duration || 0;
    if (isFinite(duration) && duration > 0) score += Math.min(duration, 7200) / 10;
    var width = v.offsetWidth || 0;
    var height = v.offsetHeight || 0;
    if (width >= 100 && height >= 60) score += (width * height) / 2000;
    if (!v.paused && v.currentTime > 0.3) score += 300;
    if (v.readyState >= 2) score += 200;
    if (window.location.hostname.indexOf("iqiyi.com") !== -1 && v.closest && v.closest(".iqp-player-videolayer-inner")) score += 2000;
    return score;
  }

  window.__yiqikanIsVideoCandidate = function(v) { return !isAdOrThumbnailVideo(v); };

  function findBestPlayerInFrame() {
    var selectedVideo = window.__yiqikanSelectedVideo;
    if (selectedVideo && selectedVideo.isConnected) return wrapVideoElement(selectedVideo);
    var localVideo = document.getElementById("yiqikan-local-video");
    if (localVideo && localVideo.src) return wrapVideoElement(localVideo);

    var tencent = getTencentPlayerWrapper();
    if (tencent) return tencent;
    var baidu = getBaiduPanPlayerWrapper();
    if (baidu) return baidu;

    var videos = document.querySelectorAll("video, bwp-video");
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < videos.length; i++) {
      var score = calculateVideoScore(videos[i]);
      if (score > bestScore) {
        bestScore = score;
        best = videos[i];
      }
    }
    // Android injects only the main document. Control accessible iframe media
    // directly when that document has no independently injected controller.
    // Keep cross-origin frames and already routed child controllers separate.
    if (!best && window.__yiqikanScanSameOriginFrames === true) {
      function visitFrames(doc, depth) {
        if (depth > 12) return;
        var frames = doc.querySelectorAll('iframe');
        for (var j = 0; j < frames.length; j++) {
          try {
            var child = frames[j].contentDocument;
            if (!child || !child.defaultView || child.defaultView.__YIQIKAN_INJECTED) continue;
            var childVideos = child.querySelectorAll('video, bwp-video');
            for (var k = 0; k < childVideos.length; k++) {
              var score = calculateVideoScore(childVideos[k]);
              if (score > bestScore) { bestScore = score; best = childVideos[k]; }
            }
            visitFrames(child, depth + 1);
          } catch (_) { /* Cross-origin documents need a native frame bridge. */ }
        }
      }
      visitFrames(document, 0);
    }
    return best ? wrapVideoElement(best) : null;
  }

  window.__yiqikanCurrentVideo = function() { var player=findBestPlayerInFrame(); return player && player.element; };

  const forceInline = (v) => {
    if (v.__inlineSet) return;
    try {
      if (!v.hasAttribute('playsinline')) v.setAttribute('playsinline', 'true');
      if (!v.hasAttribute('webkit-playsinline')) v.setAttribute('webkit-playsinline', 'true');
      if (!v.hasAttribute('x5-playsinline')) v.setAttribute('x5-playsinline', 'true');
      if (!v.hasAttribute('x5-video-player-type')) v.setAttribute('x5-video-player-type', 'h5');
      v.playsInline = true;
      if ('webkitPlaysInline' in v) v.webkitPlaysInline = true;
    } catch (e) {}
    
    // 拦截原生全屏 API，触发自定义全屏（需手势校验，杜绝自动播放时误触全屏）
    const preventFullscreen = function() {
      var touchTime = window.__lastUserTouchTime || lastUserTouchTime || 0;
      if (Date.now() - touchTime < 1200) {
        sendMessage({ type: 'REQUEST_FULLSCREEN' });
      }
      return Promise.resolve();
    };
    if (typeof v.webkitEnterFullscreen === 'function') v.webkitEnterFullscreen = preventFullscreen;
    if (typeof v.requestFullscreen === 'function') v.requestFullscreen = preventFullscreen;
    
    v.__inlineSet = true;
  };

  // 监听动态插入
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.tagName === 'VIDEO' || node.tagName === 'BWP-VIDEO') {
          forceInline(node);
        } else if (node.querySelectorAll) {
          const videos = node.querySelectorAll('video, bwp-video');
          if (videos.length > 0) videos.forEach(forceInline);
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let hasReportedVideoFound = false;
  let lastVideoElement = null;

  function reportState(p, eventName) {
    sendMessage({ 
      type: 'SYNC_EVENT', 
      payload: { 
        eventName,
        paused: p.paused, 
        currentTime: p.currentTime,
        duration: p.duration || 0,
        playbackRate: p.playbackRate || 1,
        videoTitle: getCleanVideoTitle(),
        sampledAt: Date.now(),
        buffering: Boolean(p.element && (p.element.__yiqikanBuffering || (!p.paused && p.element.readyState < 3))),
        seeking: Boolean((p.element ? p.element.seeking : p.seeking) || (window.__isHost === true && hostSeek)),
        ended: Boolean(p.element && p.element.ended),
      } 
    });
  }

  let lastUserTouchTime = 0;
  let isApplyingSync = false;
  let syncActionTimer = null;

  function markProgrammaticSync(durationMs = 8000) {
    isApplyingSync = true;
    if (syncActionTimer) clearTimeout(syncActionTimer);
    syncActionTimer = setTimeout(() => {
      isApplyingSync = false;
      syncActionTimer = null;
    }, durationMs);
  }

  function clearProgrammaticSync() {
    isApplyingSync = false;
    if (syncActionTimer) {
      clearTimeout(syncActionTimer);
      syncActionTimer = null;
    }
  }

  function updateTouchTime() {
    window.__lastUserTouchTime = Date.now();
    lastUserTouchTime = window.__lastUserTouchTime;
    playBlocked = false;
  }

  document.addEventListener('touchstart', updateTouchTime, { passive: true, capture: true });
  document.addEventListener('pointerdown', updateTouchTime, { passive: true, capture: true });
  document.addEventListener('mousedown', updateTouchTime, { passive: true, capture: true });

  function hookVideoEvents(v) {
    if (v.__yiqikan_hooked) return;

    function isActiveVideo() {
      if (window.__yiqikanInactiveFrame) return false;
      var player = findBestPlayerInFrame();
      return !player || !player.element || player.element === v;
    }
    
    v.addEventListener('play', (e) => {
      if (!isActiveVideo()) return;
      const touchTime = window.__lastUserTouchTime || lastUserTouchTime || 0;
      const isManualUserGesture = (Date.now() - touchTime) < 1500;
      const isLocalMedia = v.id === 'yiqikan-local-video';
      if (window.__isHost === false && !isApplyingSync && isManualUserGesture && !isLocalMedia) {
        v.pause();
        sendMessage({ type: 'HOST_ONLY_WARNING', message: '仅房主可操作播放，自动恢复跟播' });
        sendMessage({ type: 'REQUEST_RESYNC' });
        return;
      }
      clearProgrammaticSync();
      var p = findBestPlayerInFrame() || wrapVideoElement(v);
      reportState(p, 'play');
    });
    
    v.addEventListener('pause', (e) => {
      if (!isActiveVideo()) return;
      clearProgrammaticSync();
      var p = findBestPlayerInFrame() || wrapVideoElement(v);
      reportState(p, 'pause');
    });
    
    v.addEventListener('seeked', (e) => {
      if (!isActiveVideo()) return;
      const touchTime = window.__lastUserTouchTime || lastUserTouchTime || 0;
      const isManualUserGesture = (Date.now() - touchTime) < 1500;
      const isLocalMedia = v.id === 'yiqikan-local-video';
      if (window.__isHost === false && !isApplyingSync && isManualUserGesture && !isLocalMedia) {
        sendMessage({ type: 'HOST_ONLY_WARNING', message: '仅房主可调整进度，自动恢复跟播' });
        sendMessage({ type: 'REQUEST_RESYNC' });
        return;
      }
      clearProgrammaticSync();
      var p = findBestPlayerInFrame() || wrapVideoElement(v);
      if (window.__isHost === true) {
        // A newer native drag may be waiting for this older seek to finish.
        reconcileVideoSync();
        settleHostSeek();
        return;
      }
      reportState(p, 'seeked');
    });
    
    v.addEventListener('timeupdate', () => {
      if (!isActiveVideo()) return;
      if (!window._lastUpdate || Date.now() - window._lastUpdate > 1000) {
        var p = findBestPlayerInFrame() || wrapVideoElement(v);
        reportState(p, 'timeupdate');
        window._lastUpdate = Date.now();
      }
    });
    
    ['waiting', 'stalled', 'seeking', 'loadeddata', 'canplay', 'playing', 'ratechange', 'ended'].forEach((eventName) => {
      v.addEventListener(eventName, () => {
        if (!isActiveVideo()) return;
        if (eventName === 'seeking' && window.__isHost === true) beginHostSeek(findBestPlayerInFrame() || wrapVideoElement(v));
        if (eventName === 'waiting' || (eventName === 'stalled' && v.readyState < 3)) v.__yiqikanBuffering = true;
        if ((eventName === 'canplay' || eventName === 'playing' || eventName === 'loadeddata') && v.readyState >= 3) v.__yiqikanBuffering = false;
        if (eventName === 'ended') window.__resetVideoSync();
        var p = findBestPlayerInFrame() || wrapVideoElement(v);
        reportState(p, eventName);
        if (eventName === 'loadeddata' || eventName === 'canplay' || eventName === 'playing') reconcileVideoSync();
      });
    });
    v.__yiqikan_hooked = true;
  }

  function pollVideo() {
    const player = findBestPlayerInFrame();
    if (player) {
      if (player.element) {
        forceInline(player.element);
        hookVideoEvents(player.element);
      }
      
      const el = player.element || player.isPlatformAdapter || true;
      if (el !== lastVideoElement || !hasReportedVideoFound) {
        lastVideoElement = el;
        hasReportedVideoFound = true;
        sendMessage({ type: 'VIDEO_FOUND', title: getCleanVideoTitle(), platformAdapter: Boolean(player.isPlatformAdapter) });
      }
      return true;
    }
    lastVideoElement = null;
    hasReportedVideoFound = false;
    return false;
  }

  function pollIframe() {
    const pathname = window.location.pathname;
    if (pathname === '/' || pathname === '/index.html' || pathname === '/index.php') return false;

    const iframes = document.querySelectorAll('iframe');
    let bestIframe = null;
    for (let i = 0; i < iframes.length; i++) {
      const iframe = iframes[i];
      if (iframe.src && !iframe.src.includes('google') && !iframe.src.includes('baidu')) {
        if (iframe.offsetWidth > 100 || iframe.src.includes('player') || iframe.src.includes('m3u8') || iframe.src.includes('url=')) {
          bestIframe = iframe;
          break;
        }
      }
    }
    if (bestIframe && bestIframe.src) {
      if (window.__lastFoundIframe === bestIframe.src) return false;
      window.__lastFoundIframe = bestIframe.src;
      sendMessage({ type: 'FOUND_IFRAME', url: bestIframe.src, parentHost: window.location.href });
      return true;
    }
    return false;
  }

  let latestSync = null;
  let syncPlayer = null;
  let lastSeekAt = -Infinity;
  let seekNeedsProgress = false;
  let syncWasUnavailable = false;
  let recoveryReadyAt = -Infinity;
  let lastSeekPosition = 0;
  let driftVotes = { direction: 0, count: 0, at: -Infinity };
  let playBlocked = false;
  let playPending = null;
  let syncGeneration = 0;
  let desiredSyncPause = null;
  let hostSeek = null;
  let hostSeekTimer = null;
  const syncNow = () => window.performance && typeof window.performance.now === 'function' ? window.performance.now() : Date.now();

  function beginHostSeek(player, target) {
    if (hostSeekTimer) clearTimeout(hostSeekTimer);
    hostSeekTimer = null;
    hostSeek = { player, target, origin: player.currentTime, startedAt: syncNow(), rate: player.playbackRate, confirmed: false };
  }

  function hostSeekIsReady(pending) {
    const player = findBestPlayerInFrame();
    if (!player || (player.element || player.isPlatformAdapter) !== (pending.player.element || pending.player.isPlatformAdapter)) return false;
    if (latestSync && !latestSync.remote && latestSync.force) return false;
    const video = player.element;
    const readyState = video ? video.readyState : player.readyState;
    if ((video ? video.seeking : player.seeking) || readyState < (player.paused ? 2 : 3)
      || (!player.paused && video && video.__yiqikanBuffering)) return false;
    if (!player.element && typeof pending.target === 'number' && !pending.confirmed) {
      // API-only players have no seeked event: wait for their real media clock.
      const advance = Math.max(0, syncNow() - pending.startedAt) / 1000 * Math.max(pending.rate, player.playbackRate);
      if (player.currentTime < pending.target - 0.75 || player.currentTime > pending.target + advance + 0.75) return false;
      if (Math.abs(pending.target - pending.origin) > 0.75 && Math.abs(player.currentTime - pending.origin) < 0.1) return false;
      pending.confirmed = true;
    }
    return true;
  }

  function settleHostSeek() {
    const pending = hostSeek;
    if (!pending || hostSeekTimer || !hostSeekIsReady(pending)) return;
    // Website scrubbing may finish several seeks in a burst. Publish the last
    // settled position through the same path as a native toolbar drag.
    hostSeekTimer = setTimeout(() => {
      hostSeekTimer = null;
      if (hostSeek !== pending || !hostSeekIsReady(pending)) return;
      hostSeek = null;
      reportState(findBestPlayerInFrame(), 'seeked');
    }, 250);
  }

  function restoreSyncRate(player, rate) {
    if (player && player.playbackRate !== rate) player.playbackRate = rate;
  }

  function hasSyncBuffer(player, position, rate) {
    const ranges = player.element && player.element.buffered;
    // Some platform adapters do not expose buffered ranges.
    if (!ranges) return true;
    const end = Number.isFinite(player.duration) && player.duration > 0
      ? Math.min(position + 2 * rate, player.duration) : position + 2 * rate;
    try {
      for (let i = 0; i < ranges.length; i++) {
        if (position >= ranges.start(i) && end <= ranges.end(i) + 0.05) return true;
      }
    } catch (e) { return false; }
    return false;
  }

  function startSyncPlayback(player, remote) {
    if (playPending || playBlocked) return;
    markProgrammaticSync();
    const attempt = { generation: syncGeneration };
    playPending = attempt;
    Promise.resolve(player.play()).then(() => {
      // A reset invalidates the old goal, but a newer pause still wins if play
      // completes late. This also covers local toolbar play without a position.
      if (desiredSyncPause === true) player.pause();
    }).catch((error) => {
      if (attempt.generation !== syncGeneration || (error && error.name === 'AbortError')) return;
      if (remote) {
        playBlocked = true;
        sendMessage({ type: 'LOG', msg: '播放未能启动，请点击播放后恢复跟播' });
      }
    }).finally(() => { if (playPending === attempt) playPending = null; });
  }

  window.__yiqikanResumeInGesture = () => {
    if (window.__isHost !== false || window.__followSyncEnabled !== true || desiredSyncPause !== false) return;
    const player = findBestPlayerInFrame();
    if (!player) return;
    playBlocked = false;
    startSyncPlayback(player, true);
  };

  window.__resetVideoSync = (preserveHostSeek = false) => {
    if (!preserveHostSeek) {
      if (hostSeekTimer) clearTimeout(hostSeekTimer);
      hostSeekTimer = null;
      hostSeek = null;
    }
    syncGeneration++;
    playBlocked = false;
    playPending = null;
    if (syncPlayer && latestSync) restoreSyncRate(syncPlayer, latestSync.playbackRate);
    latestSync = null;
    syncPlayer = null;
    seekNeedsProgress = false;
    syncWasUnavailable = false;
    recoveryReadyAt = -Infinity;
    lastSeekAt = -Infinity;
    driftVotes = { direction: 0, count: 0, at: -Infinity };
  };

  function reconcileVideoSync() {
    settleHostSeek();
    if (!latestSync) return;
    const player = findBestPlayerInFrame();
    if (!player) return;
    if (syncPlayer && (player.element || player.isPlatformAdapter) !== (syncPlayer.element || syncPlayer.isPlatformAdapter)) {
      window.__resetVideoSync();
      sendMessage({ type: 'REQUEST_RESYNC' });
      return;
    }
    syncPlayer = player;
    const cmd = latestSync;
    desiredSyncPause = cmd.paused;
    const now = syncNow();
    const rate = cmd.playbackRate;
    if (cmd.remote && (window.__followSyncEnabled === false || now - cmd.sampleAt > 3000)) {
      restoreSyncRate(player, rate);
      latestSync = null;
      driftVotes = { direction: 0, count: 0, at: -Infinity };
      return;
    }
    const video = player.element;
    const seeking = video ? video.seeking : player.seeking;
    const readyState = video ? video.readyState : player.readyState;
    if (playBlocked && !cmd.paused) {
      restoreSyncRate(player, rate);
      return;
    }
    const ready = readyState === undefined || readyState >= (cmd.force || cmd.paused ? 2 : 3);
    const buffering = video && video.__yiqikanBuffering;
    if (seeking || buffering || (readyState !== undefined && readyState < 3)) syncWasUnavailable = true;
    else if (syncWasUnavailable) {
      // Recovery (including our own seek) is not an explicit catch-up command.
      // Let playback settle before resuming ordinary drift correction.
      recoveryReadyAt = now + 1000;
      syncWasUnavailable = false;
    }
    let target = cmd.currentTime;
    if (!cmd.paused && cmd.remote) target += Math.max(0, now - cmd.sampleAt) / 1000 * rate;
    if (Number.isFinite(player.duration) && player.duration > 0) target = Math.min(player.duration, target);
    target = Math.max(0, target);
    if (video && video.ended && !cmd.paused && Number.isFinite(player.duration) && target >= player.duration - 0.05) {
      restoreSyncRate(player, rate);
      latestSync = null;
      return; // A late playing sample at the end must not restart a finished video.
    }
    const diff = target - player.currentTime;
    const gap = Math.abs(diff);

    if (cmd.paused && !player.paused) {
      markProgrammaticSync();
      player.pause();
    }
    if (!ready || seeking || buffering || (!cmd.force && now < recoveryReadyAt)) {
      restoreSyncRate(player, rate);
    } else {
      if (seekNeedsProgress && Math.abs(player.currentTime - lastSeekPosition) > 0.1) seekNeedsProgress = false;
      const hardSeek = cmd.force || (cmd.paused && gap > 1) || (gap > 2 && driftVotes.count >= 2);
      // A paused media clock cannot advance to release seekNeedsProgress. Keep
      // the cooldown, but allow a later paused host position to align again.
      if (hardSeek && (cmd.force || ((cmd.paused || !seekNeedsProgress) && now - lastSeekAt >= 3000
        && (cmd.paused || hasSyncBuffer(player, target, rate))))) {
        restoreSyncRate(player, rate);
        // force means one explicit alignment, not a seek on every timer tick.
        cmd.force = false;
        driftVotes.count = 0;
        if (gap > 0.05) {
          markProgrammaticSync();
          lastSeekAt = now;
          seekNeedsProgress = true;
          if (hostSeek && !player.element) {
            hostSeek.origin = player.currentTime;
            hostSeek.startedAt = now;
            hostSeek.rate = player.playbackRate;
          }
          player.seek(target);
          lastSeekPosition = player.currentTime;
        }
      // A short rolling buffer may never include a distant target. Keep
      // converging smoothly when a hard seek is unsafe or still cooling down.
      } else if (!cmd.paused && !player.paused && gap > 1 && driftVotes.count >= 2
        && (diff < 0 || hasSyncBuffer(player, player.currentTime, rate * 1.08))) {
        restoreSyncRate(player, Math.max(0.25, Math.min(4, rate * (diff > 0 ? 1.08 : 0.92))));
      } else {
        // Every periodic sample inside the 1-second tolerance is observational.
        restoreSyncRate(player, rate);
      }
    }
    // Starting an unready video is necessary to decode the first frame on iOS.
    // A rejected autoplay is not retried by every heartbeat.
    if (!cmd.paused && player.paused && !playPending && !playBlocked) {
      startSyncPlayback(player, cmd.remote);
    }
    // Local host controls are one-shot; the sync timer must not undo a later native pause.
    if (!cmd.remote && !cmd.force && ready && !seeking) latestSync = null;
    settleHostSeek();
  }

  window.__syncCmd = (cmd) => {
    try {
      const age = cmd.remote && typeof cmd.sampledAt === 'number' ? Math.max(0, Date.now() - cmd.sampledAt) : 0;
      // Check every remote command shape before changing playback intent. Rate
      // events may carry paused=false but omit a position.
      if (cmd.remote && (window.__followSyncEnabled === false || age > 3000)) return;
      // A recognized iframe can be presented before its media has loaded.
      if (typeof cmd.fullscreen === 'boolean') applyTheaterMode(cmd.fullscreen);
      const player = findBestPlayerInFrame();
      if (!player) return;
      if (cmd.allowRetry) playBlocked = false;
      if (typeof cmd.paused === 'boolean') desiredSyncPause = cmd.paused;
      if (player.element) hookVideoEvents(player.element);
      const now = syncNow();
      const rate = typeof cmd.playbackRate === 'number' && cmd.playbackRate > 0 ? cmd.playbackRate
        : latestSync ? latestSync.playbackRate : player.playbackRate || 1;
      if (!cmd.remote && (typeof cmd.currentTime === 'number' || typeof cmd.paused === 'boolean')) {
        if (typeof cmd.currentTime !== 'number' && latestSync && !latestSync.remote && latestSync.force) {
          // Pause/play during loading changes intent without losing the queued seek.
          latestSync.paused = cmd.paused;
          latestSync.playbackRate = rate;
          reconcileVideoSync();
          return;
        }
        window.__resetVideoSync(typeof cmd.currentTime !== 'number');
        playBlocked = false;
      }
      if (typeof cmd.currentTime === 'number' && Number.isFinite(cmd.currentTime)) {
        const paused = typeof cmd.paused === 'boolean' ? cmd.paused : player.paused;
        const target = cmd.currentTime + (paused ? 0 : age / 1000 * rate);
        const diff = target - player.currentTime;
        const direction = Math.sign(diff);
        if (Math.abs(diff) <= 1) driftVotes = { direction: 0, count: 0, at: now };
        else if (direction !== driftVotes.direction) driftVotes = { direction, count: 1, at: now };
        else if (now - driftVotes.at >= 500) driftVotes = { direction, count: driftVotes.count + 1, at: now };
        latestSync = {
          currentTime: cmd.currentTime, paused, playbackRate: rate,
          sampleAt: now - age, remote: Boolean(cmd.remote),
          force: Boolean(cmd.force || !cmd.remote || (latestSync && latestSync.force)
            || (player.paused && !paused)),
        };
        if (!cmd.remote && window.__isHost === true) beginHostSeek(player, Math.max(0,
          Number.isFinite(player.duration) && player.duration > 0 ? Math.min(player.duration, target) : target));
        reconcileVideoSync();
      } else if (latestSync && (typeof cmd.paused === 'boolean' || typeof cmd.playbackRate === 'number')) {
        if (latestSync.remote && !latestSync.paused) latestSync.currentTime += Math.max(0, now - latestSync.sampleAt) / 1000 * latestSync.playbackRate;
        latestSync.sampleAt = now;
        latestSync.playbackRate = rate;
        if (typeof cmd.paused === 'boolean') latestSync.paused = cmd.paused;
        reconcileVideoSync();
      } else {
        if (typeof cmd.playbackRate === 'number') restoreSyncRate(player, rate);
        if (typeof cmd.paused === 'boolean') {
          markProgrammaticSync();
          if (cmd.paused) player.pause();
          else startSyncPlayback(player, Boolean(cmd.remote));
        }
      }
    } catch(e) {
      sendMessage({ type: 'LOG', msg: '指令执行报错: ' + e.message });
    }
  };

  setInterval(() => {
    try { reconcileVideoSync(); } catch (e) {}
  }, 500);
  window.addEventListener('pagehide', () => window.__resetVideoSync());
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    // A restored history document keeps its old detection flag, but its sync
    // was cleared on pagehide. Rediscover it so native requests a fresh sample.
    hasReportedVideoFound = false;
    pollVideo();
  });

  window.__queryRealtimeStatus = (queryId) => {
    try {
      const player = findBestPlayerInFrame();
      if (player) {
        if (window.__isHost === true && (hostSeek || (player.element ? player.element.seeking : player.seeking))) {
          sendMessage({ type: 'MEDIA_REALTIME_STATUS', queryId, payload: null });
          return;
        }
        sendMessage({
          type: 'MEDIA_REALTIME_STATUS',
          queryId,
          payload: {
            sampledAt: Date.now(),
            paused: player.paused || Boolean(player.element && (player.element.__yiqikanBuffering || player.element.seeking || player.element.ended || player.element.readyState < 3)),
            currentTime: player.currentTime,
            duration: player.duration || 0,
            playbackRate: player.playbackRate || 1,
          }
        });
      }
    } catch(e) {}
  };

  function applyTheaterMode(enable) {
    try {
      if (window.__yiqikanPlayer && window.__yiqikanPlayer.fullscreen(enable)) return;
      var styleId = '__yiqikan_theater_style';
      var existing = document.getElementById(styleId);
      if (enable) {
        if (!existing) {
          var s = document.createElement('style');
          s.id = styleId;
          s.innerHTML = 'html, body { overflow: hidden !important; background: #000 !important; margin: 0 !important; padding: 0 !important; width: 100vw !important; height: 100vh !important; } header, .header, nav, .nav, .bili-header, .site-nav, .search-box, .m-navbar, #biliMainHeader { display: none !important; } .yiqikan-fullscreen-target { position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483647 !important; background: #000 !important; margin: 0 !important; padding: 0 !important; }';
          document.head.appendChild(s);
        }
        var player = findBestPlayerInFrame();
        var targetEl = (player && player.element ? (player.element.closest('.bpx-player-container, .player-container, #player, .txp_player, .iqp-player, .m-video-player') || player.element) : document.querySelector('video'));
        if (targetEl) {
          targetEl.classList.add('yiqikan-fullscreen-target');
        }
      } else {
        if (existing) existing.remove();
        var targets = document.querySelectorAll('.yiqikan-fullscreen-target');
        for (var i = 0; i < targets.length; i++) {
          targets[i].classList.remove('yiqikan-fullscreen-target');
        }
        setTimeout(function() {
          window.dispatchEvent(new Event('resize'));
        }, 100);
      }
    } catch (e) {}
  }

  setInterval(() => {
    if (!pollVideo()) pollIframe();
    else {
      const player = findBestPlayerInFrame();
      if (player) reportState(player, 'heartbeat');
    }
  }, 1000);

})();
true;
`;

export interface RoomWebViewRef {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stopLoading?: () => void;
  navigateTo?: (url: string) => void;
  togglePlayPause: () => void;
  seekRelative: (seconds: number) => void;
  seekTo: (time: number) => void;
  setPaused: (paused: boolean) => void;
  setRate: (rate: number) => void;
  setPlaybackRate: (rate: number) => void;
}

export interface PlayerPresentationState {
  hasVideo: boolean;
  mode: 'page' | 'floating' | 'fullscreen';
}

interface RoomWebViewProps {
  initialUrl: string;
  isFullscreen: boolean;
  onToggleFullscreen: (force?: boolean) => void;
  onNavigationStateChange?: (canGoBack: boolean, canGoForward: boolean, currentUrl: string, title?: string) => void;
  onLampPress?: () => void;
  isPortraitPanelExpanded?: boolean;
  onVideoStateChange?: (state: { currentTime: number; duration: number; paused: boolean }) => void;
  onPlayerPresentationChange?: (state: PlayerPresentationState) => void;
  isHost?: boolean;
  isFollowingHost?: boolean;
  onShowToast?: (msg: string, options?: { type?: 'success' | 'info' | 'none' }) => void;
}

const PLAYBACK_RATES = [0.75, 1.0, 1.25, 1.5, 2.0];
const IDLE_FULLSCREEN_LAMP_OPACITY = 0.8;

function parseExpectedFileName(urlStr: string | null | undefined): string | null {
  if (!urlStr) return null;
  try {
    if (urlStr.startsWith('yiqikan://player') || urlStr.startsWith('local://')) {
      const match = urlStr.match(/[?&](?:file|name)=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
  } catch {}
  return null;
}

const RoomWebView = React.forwardRef((
  { initialUrl, isFullscreen, onToggleFullscreen, onNavigationStateChange, onLampPress, isPortraitPanelExpanded, onVideoStateChange, onPlayerPresentationChange, isHost = true, isFollowingHost = true, onShowToast }: RoomWebViewProps,
  ref: React.ForwardedRef<RoomWebViewRef>
) => {
  const webviewRef = useRef<WebView>(null);
  const playerSession = useRef('player-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const playerDocument = useRef<string | null>(null);
  const playerScript = useMemo(() => createWebPlayerScript(playerSession.current), []);
  const [isFloatingPlayer, setIsFloatingPlayer] = useState(false);
  const transition = useRef(new PlayerTransition());
  const localMedia = useRef<LocalMedia | null>(null);
  const hostMediaKey = useRef('');
  const episodeAttempt = useRef('');
  const episodeNavigation = useRef('');
  const [switchPhase, setSwitchPhase] = useState<'loading' | 'choose' | null>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const actualUrlRef = useRef(initialUrl);
  const canNavigate = isHost || !isFollowingHost;
  // 搜索与视频站始终使用同一个电脑 UA，避免搜索后变成 App 引导页。
  const [initialNavigationReady, setInitialNavigationReady] = useState(Platform.OS !== 'ios');

  useEffect(() => {
    if (initialNavigationReady) return;
    // iOS 首次先提交电脑 UA 与 contentMode，再加载远端页面。
    const frame = requestAnimationFrame(() => setInitialNavigationReady(true));
    return () => cancelAnimationFrame(frame);
  }, [initialNavigationReady]);

  const isLocalVideoMode = Boolean(
    currentUrl && (currentUrl.startsWith('yiqikan://player') || currentUrl.startsWith('local://'))
  );
  const expectedFileName = useMemo(() => parseExpectedFileName(currentUrl), [currentUrl]);

  const [videoTitle, setVideoTitle] = useState(() => expectedFileName || '当前视频');
  const [headers, setHeaders] = useState<any>({});
  const [videoState, setVideoState] = useState({ currentTime: 0, duration: 0, paused: true });
  const [hasVideo, setHasVideo] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  // 本地视频模式下保持 HTML 模板的单例稳定性，避免由于 expectedFileName 改变导致 WebView reload 丢失已载入的视频 Blob
  const localPlayerHtml = useMemo(() => {
    if (!isLocalVideoMode) return '';
    return generateLocalVideoPlayerHtml({
      expectedFileName,
      isHost,
    });
    // 注意：仅在初次进入本地模式时生成初始 HTML，后续片名与角色同步全部通过 injectJavaScript 更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocalVideoMode]);

  const webviewSource = useMemo(() => {
    // iOS 部分 WebView 版本会把 about:blank URI 当成本地文件加载并抛出异常。
    // 使用内存 HTML 等待电脑模式配置，不发网络请求，也不进入文件加载路径。
    if (!initialNavigationReady) return { html: '<!doctype html><html><head></head><body></body></html>' };
    if (isLocalVideoMode) {
      return { html: localPlayerHtml, baseUrl: 'https://yiqikan.club' };
    }
    return { uri: currentUrl, headers };
  }, [initialNavigationReady, isLocalVideoMode, localPlayerHtml, isLocalVideoMode ? null : currentUrl, headers]);

  // 本地视频模式下，URL 片名或房主角色发生变更时，动态调用网页内部方法更新而无需重载页面
  useEffect(() => {
    if (!isLocalVideoMode) return;
    webviewRef.current?.injectJavaScript(`
      if (typeof window.__updateExpectedMedia === 'function') {
        window.__updateExpectedMedia(${JSON.stringify(expectedFileName || '')}, ${isHost});
      }
      true;
    `);
  }, [isLocalVideoMode, expectedFileName, isHost]);

  // 全屏 HUD 控制栏显示状态
  const [showControls, setShowControls] = useState(true);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const currentPlaybackRate = useRoomStore(state => state.currentPlaybackRate);
  const setCurrentPlaybackRate = useRoomStore(state => state.setCurrentPlaybackRate);
  
  const roomState = useRoomStore(state => state.roomState);
  const scrub = usePlaybackScrub({ currentTime: videoState.currentTime, duration: videoState.duration, enabled: isHost && isFullscreen,
    mediaKey: `${roomState?.id || ''}|${currentUrl}|${roomState?.playback.media?.id || ''}`,
    onSeek: time => { sendRemoteSeek(time); resetTimers(); } });
  const isConnected = useRoomStore(state => state.isConnected);
  const memberLocalPause = useRoomStore(state => state.memberLocalPause);
  const memberMediaPending = useRoomStore(state => state.memberMediaPending);
  const setMemberLocalPause = useRoomStore(state => state.setMemberLocalPause);
  const lastRemotePlayerEvent = useRoomStore(state => state.lastRemotePlayerEvent);

  // 动画值：HUD 控制条与辅助台灯
  const hudOpacityAnim = useRef(new Animated.Value(1)).current;
  const lampOpacityAnim = useRef(new Animated.Value(1)).current;
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 辅助台灯拖拽支持
  const pan = useRef(new Animated.ValueXY()).current;
  const isDraggingLamp = useRef(false);

  const [isDanmakuEnabled, setIsDanmakuEnabled] = useState(true);
  const [isLandscapeDrawerOpen, setIsLandscapeDrawerOpen] = useState(false);
  const { voiceStatus, isMuted, toggleMute, stats, notifyVideoPlayback } = useVoice();

  useEffect(() => {
    if (hasVideo) notifyVideoPlayback(videoState.paused);
  }, [hasVideo, videoState.paused, voiceStatus, notifyVideoPlayback]);

  const chatMessages = useRoomStore(state => state.chatMessages);
  useEffect(() => {
    // 严格限制仅在本地开发测试环境下响应调试用视频注入指令
    if (!__DEV__) return;
    if (!chatMessages || chatMessages.length === 0) return;
    const latest = chatMessages[chatMessages.length - 1];
    if (latest && typeof latest.message === 'string' && latest.message.startsWith('/test_load_media')) {
      const parts = latest.message.split(' ');
      const mediaUrl = parts[1] || 'http://127.0.0.1:9999/real_sample.mp4';
      const mediaName = parts[2] || '流浪地球2.2023.IMAX.mkv';
      webviewRef.current?.injectJavaScript(`
        if (typeof window.__loadTestVideo === 'function') {
          window.__loadTestVideo(${JSON.stringify(mediaUrl)}, ${JSON.stringify(mediaName)});
        }
        true;
      `);
    }
  }, [chatMessages]);

  // 注册全局回传当前播放状态的 getter
  const videoStateRef = useRef(videoState);
  videoStateRef.current = videoState;
  const currentPlaybackRateRef = useRef(currentPlaybackRate);
  currentPlaybackRateRef.current = currentPlaybackRate;

  const querySequenceRef = useRef(0);
  const pendingPlaybackQueryRef = useRef<{
    id: number; promise: Promise<RealtimePlayback | null>;
    resolve: (value: RealtimePlayback | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const lastHostReportRef = useRef<{ paused: boolean; rate: number } | null>(null);
  const wasBufferingRef = useRef(false);

  const presentationMode = (): PlayerMode => isFullscreen ? 'fullscreen' : isFloatingPlayer ? 'floating' : 'page';
  const reflectTransition = () => {
    const phase = transition.current.pending?.phase || null;
    setSwitchPhase(phase);
    const state = useRoomStore.getState();
    state.setMemberMediaPending(!state.isHost && Boolean(phase));
  };
  const suspendOldPlayer = (pause = true) => {
    reflectTransition();
    webviewRef.current?.injectJavaScript(`window.__followSyncEnabled=false;if(window.__resetVideoSync)window.__resetVideoSync();if(window.__yiqikanPlayer){${pause ? 'window.__yiqikanPlayer.pauseAll();' : ''}window.__yiqikanPlayer.restore();} true;`);
    setIsFloatingPlayer(false);
    if (isFullscreen) onToggleFullscreen(false);
  };
  const restorePresentation = (mode: PlayerMode) => {
    reflectTransition();
    const state = useRoomStore.getState();
    webviewRef.current?.injectJavaScript(`window.__followSyncEnabled=${!state.isHost && !state.memberLocalPause && !state.memberMediaPending && Boolean(state.roomState) && AppState.currentState === 'active'};if(window.__yiqikanPlayer){window.__yiqikanPlayer.cancelFollowMedia();window.__yiqikanPlayer.present(${JSON.stringify(mode)});} true;`);
    if (mode === 'fullscreen') onToggleFullscreen(true);
    if (!isHost) requestLatestPlayback();
  };
  const observeHostMedia = () => {
    const state = useRoomStore.getState(), room = state.roomState;
    if (state.isHost || !room) return;
    const wasPending = Boolean(transition.current.pending);
    const priorMode = transition.current.pending?.mode || presentationMode();
    if (!transition.current.observe(`${room.id}|${room.hostId}`, room.playback.url || '', room.playback.media,
      isFollowingHost && !isLocalVideoMode, presentationMode(), localMedia.current)) {
      if (wasPending && !transition.current.pending) restorePresentation(priorMode);
      return;
    }
    suspendOldPlayer();
    const pending = transition.current.pending;
    if (pending?.phase === 'loading' && pending.media?.episode && !pending.newDocument) {
      webviewRef.current?.injectJavaScript(`if(window.__yiqikanPlayer)window.__yiqikanPlayer.followMedia(${JSON.stringify(pending.media)}); true;`);
    }
  };
  const startPageTransition = () => {
    if (isLocalVideoMode) return;
    if (!localMedia.current && !hasVideo && !transition.current.pending && presentationMode() === 'page') { setHasVideo(false); return; }
    transition.current.loading(presentationMode(), localMedia.current);
    suspendOldPlayer();
    setHasVideo(false);
  };
  const attemptHostEpisode = () => {
    const pending = transition.current.pending;
    if (isHost || pending?.phase !== 'loading' || !pending.media?.episode) return;
    const key = `${pending.media.id}|${playerDocument.current}`;
    if (episodeAttempt.current === key) return;
    episodeAttempt.current = key;
    webviewRef.current?.injectJavaScript(`if(window.__yiqikanPlayer)window.__yiqikanPlayer.followMedia(${JSON.stringify(pending.media)}); true;`);
  };
  const failMediaTransition = () => {
    transition.current.fail();
    reflectTransition();
    if (isFullscreen) onToggleFullscreen(false);
  };
  const confirmMemberMedia = () => {
    if (!hasVideo || !localMedia.current?.ready) { onShowToast?.('请先在网页中打开对应视频'); return; }
    const mode = transition.current.confirm();
    setMemberLocalPause(false);
    restorePresentation(mode);
  };

  useEffect(() => {
    observeHostMedia();
  }, [roomState?.id, roomState?.hostId, roomState?.playback.url, roomState?.playback.media?.id, isFollowingHost]);

  useEffect(() => {
    if (!isHost) return;
    transition.current.pending = null;
    transition.current.host = null;
    hostMediaKey.current = '';
    reflectTransition();
    webviewRef.current?.injectJavaScript('if(window.__yiqikanPlayer)window.__yiqikanPlayer.invalidateContext(); true;');
  }, [isHost, roomState?.id]);

  useEffect(() => {
    if (switchPhase !== 'loading') return;
    const timer = setTimeout(failMediaTransition, 12000);
    return () => clearTimeout(timer);
  }, [switchPhase, roomState?.playback.url, roomState?.playback.media?.id]);

  useEffect(() => () => { useRoomStore.getState().setMemberMediaPending(false); }, []);

  useEffect(() => {
    if (isConnected) lastHostReportRef.current = null; // Publish one live state after reconnect.
  }, [isConnected]);

  useEffect(() => {
    socketService.registerPlaybackGetter(() => {
      if (transition.current.pending) return Promise.resolve(null);
      if (pendingPlaybackQueryRef.current) return pendingPlaybackQueryRef.current.promise;
      if (!webviewRef.current) return Promise.resolve(null);
      const id = ++querySequenceRef.current;
      let resolve!: (value: RealtimePlayback | null) => void;
      const promise = new Promise<RealtimePlayback | null>(done => { resolve = done; });
      const timer = setTimeout(() => {
        if (pendingPlaybackQueryRef.current?.id === id) pendingPlaybackQueryRef.current = null;
        resolve(null); // Never label a stale React cache as a fresh host sample.
      }, 800);
      pendingPlaybackQueryRef.current = { id, promise, resolve, timer };
      try {
        webviewRef.current.injectJavaScript(`if(window.__queryRealtimeStatus) window.__queryRealtimeStatus(${id}); true;`);
      } catch {
        clearTimeout(timer);
        pendingPlaybackQueryRef.current = null;
        resolve(null);
      }
      return promise;
    });
    return () => {
      socketService.unregisterPlaybackGetter();
      const pending = pendingPlaybackQueryRef.current;
      if (pending) { clearTimeout(pending.timer); pending.resolve(null); }
      pendingPlaybackQueryRef.current = null;
    };
  }, []);

  useEffect(() => {
    lastHostReportRef.current = null;
    wasBufferingRef.current = false;
    const pending = pendingPlaybackQueryRef.current;
    if (pending) { clearTimeout(pending.timer); pending.resolve(null); pendingPlaybackQueryRef.current = null; }
    webviewRef.current?.injectJavaScript('if(window.__resetVideoSync) window.__resetVideoSync(); true;');
  }, [roomState?.id, roomState?.hostId, roomState?.playback.url]);

  useEffect(() => {
    webviewRef.current?.injectJavaScript(`window.__followSyncEnabled = ${AppState.currentState === 'active' && !isHost && !memberLocalPause && !memberMediaPending && Boolean(roomState)}; if(!window.__followSyncEnabled && window.__resetVideoSync) window.__resetVideoSync(); true;`);
  }, [isHost, memberLocalPause, memberMediaPending, roomState?.id]);

  useEffect(() => {
    webviewRef.current?.injectJavaScript(`
      window.__canNavigate = ${canNavigate};
      if (${canNavigate} && window.__yiqikanPlayer) window.__yiqikanPlayer.cancelFollowMedia();
      window.__isHost = ${isHost};
      if (typeof window.__updateHostRole === 'function') {
        window.__updateHostRole(${isHost});
      }
      true;
    `);
  }, [canNavigate, isHost]);

  // 重置控制条隐藏计时器
  const resetTimers = useCallback(() => {
    setShowControls(true);
    Animated.timing(hudOpacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    Animated.timing(lampOpacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    // 抽屉展开期间不自动隐藏 HUD
    if (isLandscapeDrawerOpen) {
      return;
    }

    idleTimerRef.current = setTimeout(() => {
      if (videoStateRef.current.paused) return;
      setShowControls(false);
      setShowRateMenu(false);
      Animated.timing(hudOpacityAnim, { toValue: 0, duration: 400, useNativeDriver: true }).start();
      // 全屏时小台灯缓慢淡至低透明度，保留可见、可点击的控制栏入口
      if (isFullscreen) {
        Animated.timing(lampOpacityAnim, { toValue: IDLE_FULLSCREEN_LAMP_OPACITY, duration: 1400, useNativeDriver: true }).start();
      } else {
        Animated.timing(lampOpacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      }
    }, 4500);
  }, [isFullscreen, isLandscapeDrawerOpen, hudOpacityAnim, lampOpacityAnim]);

  const toggleControls = useCallback(() => {
    if (showControls) {
      setShowControls(false);
      setShowRateMenu(false);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      Animated.timing(hudOpacityAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      if (isFullscreen) {
        Animated.timing(lampOpacityAnim, { toValue: IDLE_FULLSCREEN_LAMP_OPACITY, duration: 300, useNativeDriver: true }).start();
      } else {
        Animated.timing(lampOpacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      }
    } else {
      resetTimers();
    }
  }, [showControls, resetTimers, isFullscreen, hudOpacityAnim, lampOpacityAnim]);

  // 抽屉开关状态与全屏状态联动
  useEffect(() => {
    if (isLandscapeDrawerOpen) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setShowControls(true);
      hudOpacityAnim.setValue(1);
    } else if (isFullscreen) {
      resetTimers();
    }
  }, [isLandscapeDrawerOpen, isFullscreen, resetTimers, hudOpacityAnim]);

  useEffect(() => {
    if (!isFullscreen) {
      setIsLandscapeDrawerOpen(false);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (isFullscreen) {
      resetTimers();
    } else {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setShowControls(true);
      setShowRateMenu(false);
      hudOpacityAnim.setValue(1);
      lampOpacityAnim.setValue(1);
      pan.setValue({ x: 0, y: 0 });
    }
  }, [isFullscreen, resetTimers, hudOpacityAnim, lampOpacityAnim]);

  // 台灯拖拽手势
  const lampPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        isDraggingLamp.current = true;
        pan.extractOffset();
        resetTimers();
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: (evt, gestureState) => {
        pan.flattenOffset();
        const isClick = Math.abs(gestureState.dx) < 6 && Math.abs(gestureState.dy) < 6;
        if (isClick) {
          if (isFullscreen) {
            toggleControls();
          } else if (onLampPress) {
            onLampPress();
          }
        }
        setTimeout(() => {
          isDraggingLamp.current = false;
        }, 80);
        resetTimers();
      },
    })
  ).current;

  // AppState 切后台与恢复
  const appState = useRef(AppState.currentState);
  const wasHostPlayingBeforeBackground = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState.match(/inactive|background/)) {
        webviewRef.current?.injectJavaScript('window.__followSyncEnabled = false; if(window.__resetVideoSync) window.__resetVideoSync(); true;');
      }
      // 1. 切入后台：若房主正在播放，自动暂停房间，防止切到后台时视频不同步或倒带
      if (appState.current === 'active' && nextAppState.match(/inactive|background/)) {
        const state = useRoomStore.getState();
        if (state.isHost && !transition.current.pending && state.roomState?.id && !videoStateRef.current.paused) {
          wasHostPlayingBeforeBackground.current = true;
          // 本地播放器暂停
          webviewRef.current?.injectJavaScript(`if(window.__syncCmd) window.__syncCmd({ paused: true }); true;`);
          // 广播暂停至房间全员，避免切到后台期间音视频脱节
          socketService.sendPlayerEvent({
            roomId: state.roomState.id,
            actorId: socketService.getUserId(),
            action: 'pause',
            currentTime: videoStateRef.current.currentTime,
            paused: true,
            playbackRate: currentPlaybackRateRef.current,
          });
          setVideoState(prev => ({ ...prev, paused: true }));
        }
      }

      // 2. 切回前台：精准获取 DOM 真实状态，杜绝使用陈旧进度倒带广播
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        const state = useRoomStore.getState();
        webviewRef.current?.injectJavaScript(`window.__followSyncEnabled = ${!state.isHost && !state.memberLocalPause && !state.memberMediaPending && Boolean(state.roomState)}; true;`);
        if (state.roomState?.id) {
          // 向 WebView 注入查询真实状态
          webviewRef.current?.injectJavaScript(`
            if (typeof window.__queryRealtimeStatus === 'function') {
              window.__queryRealtimeStatus();
            } else {
              var v = document.querySelector('video');
              if (v && window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'MEDIA_REALTIME_STATUS',
                  payload: { paused: v.paused, currentTime: v.currentTime, duration: v.duration || 0, playbackRate: v.playbackRate || 1 }
                }));
              }
            }
            true;
          `);

          if (state.isHost) {
            if (wasHostPlayingBeforeBackground.current) {
              wasHostPlayingBeforeBackground.current = false;
              const msg = '已切回前台，房间处于暂停状态，点击继续播放';
              if (onShowToast) onShowToast(msg);
              else useRoomStore.getState().showToast(msg);
            }
            // 房主切回前台：绝不主动广播陈旧 video_sync，等房主点击播放时自然以校准后的真实进度广播
          } else {
            // 普通成员切回前台：主动向房主请求最新对齐进度
            socketService.requestPlaybackSync(state.roomState.id);
          }
        }
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [onShowToast]);

  useEffect(() => {
    if (isHost || !roomState?.id || !hasVideo || memberLocalPause || memberMediaPending) return;
    const roomId = roomState.id;
    const timer = setInterval(() => {
      if (appState.current === 'active') socketService.requestPlaybackSync(roomId, false);
    }, 1000);
    return () => clearInterval(timer);
  }, [isHost, roomState?.id, hasVideo, memberLocalPause, memberMediaPending]);

  // 保持常亮
  useEffect(() => {
    if (hasVideo && !videoState.paused) {
      activateKeepAwakeAsync().catch(() => {});
    } else {
      deactivateKeepAwake().catch(() => {});
    }
    return () => {
      deactivateKeepAwake().catch(() => {});
    };
  }, [hasVideo, videoState.paused]);

  const handleTogglePlayPause = () => {
    if (!isHost) {
      if (useRoomStore.getState().memberMediaPending) { onShowToast?.('房主已切换视频，请先选择对应影片或集数'); return; }
      // 普通成员本地暂停或追赶
      if (videoState.paused) {
        // 恢复跟播
        setMemberLocalPause(false);
        socketService.requestPlaybackSync(roomState?.id || '');
        if (onShowToast) onShowToast('已恢复跟播房主进度');
      } else {
        // 本地暂停
        setMemberLocalPause(true);
        applyLocalPause();
        if (onShowToast) onShowToast('已临时本地暂停，点击追赶即可同步');
      }
      return;
    }
    sendRemoteSync(!videoState.paused);
  };

  const handleCatchUpHost = () => {
    if (useRoomStore.getState().memberMediaPending) { onShowToast?.('请先选择对应影片或集数，再继续同步'); return; }
    setMemberLocalPause(false);
    if (roomState?.id) {
      socketService.requestPlaybackSync(roomState.id);
      onShowToast?.('正在追赶房主播放进度...');
    }
  };

  const handleSelectPlaybackRate = (rate: number) => {
    if (!isHost || transition.current.pending) return;
    setCurrentPlaybackRate(rate);
    setShowRateMenu(false);
    resetTimers();

    const script = `if(window.__syncCmd) window.__syncCmd({ playbackRate: ${rate} }); true;`;
    webviewRef.current?.injectJavaScript(script);

    if (isHost && roomState) {
      socketService.sendPlayerEvent({
        roomId: roomState.id,
        actorId: socketService.getUserId(),
        action: 'rate_change',
        currentTime: videoState.currentTime,
        paused: videoState.paused,
        playbackRate: rate,
      });
      if (onShowToast) onShowToast(`已设置倍速: ${rate}x (全员已同步)`);
    } else {
      if (onShowToast) onShowToast(`已设置本地倍速: ${rate}x`);
    }
  };

  React.useImperativeHandle(ref, () => ({
    goBack: () => webviewRef.current?.goBack(),
    goForward: () => webviewRef.current?.goForward(),
    reload: () => webviewRef.current?.reload(),
    stopLoading: () => webviewRef.current?.stopLoading(),
    navigateTo: (url: string) => {
      if (!url) return;
      const needsHistoryNavigation = url === currentUrl && url !== actualUrlRef.current;
      actualUrlRef.current = url;
      setCurrentUrl(url);
      const parsedName = parseExpectedFileName(url);
      if (parsedName) setVideoTitle(parsedName);
      const isLocal = url.startsWith('yiqikan://') || url.startsWith('local://');
      // A new source already loads natively. Only use JS when returning to the
      // unchanged source prop after a browser-history navigation.
      if (needsHistoryNavigation && !isLocal && initialNavigationReady) {
        webviewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
      }
    },
    togglePlayPause: handleTogglePlayPause,
    seekRelative: (seconds: number) => {
      const targetTime = Math.max(0, Math.min(videoState.duration || 99999, videoState.currentTime + seconds));
      sendRemoteSeek(targetTime);
    },
    seekTo: (time: number) => sendRemoteSeek(time),
    setPaused: (paused: boolean) => {
      if (isHost) sendRemoteSync(paused);
      else {
        setMemberLocalPause(paused);
        if (paused) applyLocalPause();
        else if (roomState?.id) socketService.requestPlaybackSync(roomState.id);
      }
    },
    setRate: handleSelectPlaybackRate,
    setPlaybackRate: handleSelectPlaybackRate,
  }));

  // 全屏指令
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isFullscreen) { onToggleFullscreen(false); return true; }
      if (isFloatingPlayer) {
        webviewRef.current?.injectJavaScript('if(window.__yiqikanPlayer) window.__yiqikanPlayer.restore(); true;');
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [isFullscreen, isFloatingPlayer, onToggleFullscreen]);

  useEffect(() => {
    if (isFullscreen && transition.current.pending) { onToggleFullscreen(false); return; }
    const script = `if(window.__syncCmd) window.__syncCmd({ fullscreen: ${isFullscreen} }); true;`;
    webviewRef.current?.injectJavaScript(script);
  }, [isFullscreen]);

  // 远端同步事件响应
  useEffect(() => {
    if (!lastRemotePlayerEvent) return;
    const { action, currentTime, paused, actorId, playbackRate } = lastRemotePlayerEvent;
    
    // 如果是房主自己，或事件来自自己，不回环执行
    if (isHost || actorId === socketService.getUserId()) {
      return;
    }

    observeHostMedia();
    if (useRoomStore.getState().memberMediaPending || transition.current.pending) return;
    const expectedMedia = useRoomStore.getState().roomState?.playback.media?.id;
    if (lastRemotePlayerEvent.media?.id && expectedMedia && lastRemotePlayerEvent.media.id !== expectedMedia) return;

    // 自由浏览只解除页面跟随；成员使用自己的片源时仍同步房主的播放状态。

    // 如果当前成员处于本地暂停，且不是房主切新视频，暂不强制改变播放状态
    if (memberLocalPause && action !== 'load_url') {
      return;
    }
    
    if (typeof playbackRate === 'number' && Number.isFinite(playbackRate) && playbackRate > 0) setCurrentPlaybackRate(playbackRate);
    const rate = typeof playbackRate === 'number' ? playbackRate : currentPlaybackRate;

    // 提取房主称谓（个性化提示）
    const hostMember = roomState?.members?.find(m => m.id === roomState?.hostId);
    const partnerName = hostMember?.name ? `「${hostMember.name}」` : 'TA';

    let script = '';
    if (action === 'play' || action === 'pause' || action === 'seek' || action === 'rate_change' || action === 'video_sync') {
      const cmd = mobileSyncCommand(lastRemotePlayerEvent);
      script = `if(window.__syncCmd) window.__syncCmd(${JSON.stringify(cmd)}); true;`;
      if (action === 'play') onShowToast?.(`▶️ ${partnerName} 恢复了播放`, { type: 'info' });
      if (action === 'pause') onShowToast?.(`☕ ${partnerName} 暂停了播放`, { type: 'info' });
      if (action === 'seek') onShowToast?.(`⏩ ${partnerName} 调整进度至 ${formatTime(Math.round(currentTime || 0))}`, { type: 'info' });
      if (action === 'rate_change') onShowToast?.(`⚡ ${partnerName} 将播放倍速调整为 ${rate}x`, { type: 'info' });
    } else if (action === 'load_url') {
      onShowToast?.(lastRemotePlayerEvent.url ? `🎬 ${partnerName} 正在放映新影片...` : `🎬 ${partnerName} 关闭了播放`, { type: 'info' });
    }

    if (script) {
      webviewRef.current?.injectJavaScript(script);
    }
  }, [lastRemotePlayerEvent, isHost, memberLocalPause]);

  // URL 变更
  useEffect(() => {
    if (initialUrl && initialUrl !== actualUrlRef.current) {
      const wasLocal = Boolean(
        actualUrlRef.current && (actualUrlRef.current.startsWith('yiqikan://') || actualUrlRef.current.startsWith('local://'))
      );
      const isNowLocal = Boolean(
        initialUrl.startsWith('yiqikan://') || initialUrl.startsWith('local://')
      );

      actualUrlRef.current = initialUrl;
      setCurrentUrl(initialUrl);

      const parsedName = parseExpectedFileName(initialUrl);
      if (parsedName) {
        setVideoTitle(parsedName);
      }

      if (wasLocal && isNowLocal) {
        // 本地模式内部切换（例如房主广播了带片名的伪协议），仅动态同步片名与角色，不破坏当前播放器
        webviewRef.current?.injectJavaScript(`
          if (typeof window.__updateExpectedMedia === 'function') {
            window.__updateExpectedMedia(${JSON.stringify(parsedName || '')}, ${isHost});
          }
          true;
        `);
        return;
      }

      if (initialUrl === currentUrl && !isNowLocal && initialNavigationReady) {
        webviewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(initialUrl)}; true;`);
      }

      setHasVideo(false);
    }
  }, [initialUrl, isHost, setMemberLocalPause]);

  const requestLatestPlayback = (force = true) => {
    const state = useRoomStore.getState();
    if (state.isHost || state.memberLocalPause || state.memberMediaPending || transition.current.pending || !state.roomState?.id) return;
    socketService.requestPlaybackSync(state.roomState.id, force);
    // Buffer recovery asks for a fresh observation, never replays an old seek/play.
    if (!force) return;
    const latest = state.lastRemotePlayerEvent;
    if (latest && latest.action !== 'media_change' && latest.action !== 'load_url' && latest.action !== 'navigate'
      && (!latest.media?.id || latest.media.id === state.roomState.playback.media?.id)
      && latest.roomId === state.roomState.id && latest.receivedAt && Date.now() - latest.receivedAt < 3000) {
      const cmd = mobileSyncCommand({ ...latest, forceSync: true });
      webviewRef.current?.injectJavaScript(`if(window.__syncCmd) window.__syncCmd(${JSON.stringify(cmd)}); true;`);
    }
  };

  const handleMessage = (event: any) => {
    try {
      let data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'WEB_PLAYER_MESSAGE') {
        if (data.session !== playerSession.current || !data.payload || typeof data.payload.type !== 'string') return;
        if (data.payload.type === 'PLAYER_DOCUMENT') {
          if (playerDocument.current === data.documentId) return;
          if (playerDocument.current && playerDocument.current !== data.documentId) startPageTransition();
          playerDocument.current = data.documentId;
          localMedia.current = null;
          hostMediaKey.current = '';
          setIsFloatingPlayer(false);
          return;
        }
        if (playerDocument.current && data.documentId !== playerDocument.current) return;
        data = data.payload;
      }
      if (data.type === 'MEDIA_CONTEXT') {
        if (isLocalVideoMode || typeof data.key !== 'string') return;
        const state = useRoomStore.getState();
        if (state.isHost && state.roomState?.id && typeof data.pageUrl === 'string') {
          const identity = data.contentKey || data.key;
          if (hostMediaKey.current !== identity) {
            hostMediaKey.current = identity;
            socketService.sendPlayerEvent({ roomId: state.roomState.id, actorId: socketService.getUserId(), action: 'media_change',
              media: { id: `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`, pageUrl: data.pageUrl,
                title: String(data.title || '').slice(0,300), contentId: data.contentId, episode: data.episode }, paused: true, currentTime: 0 });
          }
        } else observeHostMedia();
        if (!data.ready) {
          if (isHost) { transition.current.replacement(presentationMode(), localMedia.current); suspendOldPlayer(false); }
          localMedia.current = null;
          setHasVideo(false);
          return;
        }
        const media: LocalMedia = { key: data.key, documentId: playerDocument.current || '', pageUrl: data.pageUrl, title: data.title, contentId: data.contentId, episode: data.episode, ready: true };
        localMedia.current = media;
        setHasVideo(true);
        const mode = transition.current.ready(media);
        if (mode !== null) restorePresentation(mode);
        else { attemptHostEpisode(); if (!isHost) requestLatestPlayback(); }
        return;
      }
      if (data.type === 'PLAYER_EPISODE_NAVIGATION') {
        if (transition.current.pending?.phase === 'loading' && typeof data.url === 'string') episodeNavigation.current = data.url;
        return;
      }
      if (data.type === 'TOUCH_INTERACT') {
        if (isFloatingPlayer && !isFullscreen) webviewRef.current?.injectJavaScript('if(window.__yiqikanPlayer)window.__yiqikanPlayer.wake(); true;');
        return;
      }
      if (data.type === 'PLAYER_IFRAME_SELECTED') {
        setIsFloatingPlayer(true);
        if (data.title) setVideoTitle(data.title);
        return;
      }
      if (data.type === 'PLAYER_SELECTED') {
        setIsFloatingPlayer(true);
        setHasVideo(true);
        if (data.title) setVideoTitle(data.title);
        resetTimers();
        if (!isHost) requestLatestPlayback();
        return;
      }
      if (data.type === 'PLAYER_CONTROL') {
        if (data.action === 'pause' && !isHost) {
          setMemberLocalPause(true);
          applyLocalPause();
        } else if (data.action === 'resume' && !isHost) handleCatchUpHost();
        return;
      }
      if (data.type === 'TOGGLE_CONTROLS') {
        if (isFullscreen) toggleControls();
        return;
      }
      if (data.type === 'PLAYER_RELEASED' || data.type === 'PLAYER_EXPIRED') {
        if ((data.type === 'PLAYER_EXPIRED' || data.reason === 'navigation') && !transition.current.pending) {
          transition.current.replacement(data.previousMode || presentationMode(), localMedia.current);
          reflectTransition();
        }
        if (data.type === 'PLAYER_EXPIRED' || data.reason === 'navigation') { localMedia.current = null; setHasVideo(false); }
        setIsFloatingPlayer(false);
        if (isFullscreen) onToggleFullscreen(false);
        if (data.message) onShowToast?.(data.message);
        return;
      }
      if (data.type === 'VIDEO_FOUND') {
        setHasVideo(true);
        if (data.title) setVideoTitle(data.title);
        // Some original website players expose a playback API instead of an
        // accessible video node. Preserve their existing navigation/sync path.
        if (data.platformAdapter) {
          const media: LocalMedia = { key: `adapter-${playerDocument.current}`, documentId: playerDocument.current || '', pageUrl: actualUrlRef.current, title: data.title, ready: true };
          localMedia.current = media;
          const mode = transition.current.ready(media);
          if (mode !== null) restorePresentation(mode);
        }
        
        if (!isHost) { attemptHostEpisode(); requestLatestPlayback(); }
      } 
      else if (data.type === 'REQUEST_FULLSCREEN') {
        if (transition.current.pending) { onShowToast?.('请先确认新视频，再进入全屏'); return; }
        onToggleFullscreen(true);
      }
      else if (data.type === 'EXIT_FULLSCREEN') {
        onToggleFullscreen(false);
      }
      else if (data.type === 'TOGGLE_FULLSCREEN') {
        onToggleFullscreen();
      } 
      else if (data.type === 'FOUND_IFRAME') {
        // A player iframe is part of the current page, not a navigation request.
        // Child media reports and commands use the frame transport above.
        return;
      }
      else if (data.type === 'SYNC_EVENT') {
        if (appState.current.match(/inactive|background/)) return;

        setVideoState({
          currentTime: data.payload.currentTime,
          duration: data.payload.duration,
          paused: data.payload.paused,
        });

        if (data.payload.videoTitle) {
          setVideoTitle(data.payload.videoTitle);
        }
        
        const storeState = useRoomStore.getState();
        const payload = data.payload;
        // Web controls and the native full-screen HUD share the host/solo rate.
        // Follower correction rates are temporary, not a new baseline.
        if (isHost && Number.isFinite(payload.playbackRate) && payload.playbackRate > 0) {
          setCurrentPlaybackRate(payload.playbackRate);
        }
        const buffering = Boolean(payload.buffering || payload.seeking);
        const memberBuffering = Boolean(payload.buffering);
        if (!storeState.isHost && wasBufferingRef.current && !memberBuffering) requestLatestPlayback(false);
        wasBufferingRef.current = memberBuffering;
        if (!storeState.isHost && storeState.memberMediaPending && !payload.paused) applyLocalPause();
        if (storeState.isHost && !payload.seeking && !transition.current.pending && storeState.roomState && storeState.isConnected !== false) {
          const eventName = payload.eventName;
          const effectivePaused = Boolean(payload.paused || buffering || payload.ended);
          const rate = Number.isFinite(payload.playbackRate) && payload.playbackRate > 0 ? payload.playbackRate : currentPlaybackRate;
          const last = lastHostReportRef.current;
          const explicit = eventName === 'play' || eventName === 'pause' || eventName === 'seeked' || eventName === 'ratechange';
          if (explicit || !last || last.paused !== effectivePaused || last.rate !== rate) {
            lastHostReportRef.current = { paused: effectivePaused, rate };
            socketService.sendPlayerEvent({
              roomId: storeState.roomState.id,
              actorId: socketService.getUserId() || 'mobile-host',
              action: eventName === 'seeked' ? 'seek' : eventName === 'ratechange' ? 'rate_change'
                : eventName === 'pause' ? 'pause' : eventName === 'play' && !effectivePaused ? 'play' : 'video_sync',
              currentTime: payload.currentTime,
              paused: effectivePaused,
              playbackRate: rate,
              duration: payload.duration,
              localTimestamp: (payload.sampledAt ?? Date.now()) / 1000,
            });
          }
        }
      }
      else if (data.type === 'LOCAL_VIDEO_SELECTED') {
        const selectedFileName = data.fileName;
        if (selectedFileName) {
          setVideoTitle(selectedFileName);
        }
        setHasVideo(true);
        const storeState = useRoomStore.getState();
        if (storeState.isHost && storeState.roomState?.id) {
          const newUrl = `yiqikan://player?file=${encodeURIComponent(selectedFileName || 'video')}`;
          actualUrlRef.current = newUrl;
          setCurrentUrl(newUrl);
          socketService.sendPlayerEvent({
            roomId: storeState.roomState.id,
            actorId: socketService.getUserId(),
            action: 'load_url',
            url: newUrl,
            pageTitle: selectedFileName,
          });
          onShowToast?.(`已开播本地视频: ${selectedFileName}`);
        } else {
          const expected = parseExpectedFileName(storeState.roomState?.playback.url || '');
          if (transition.current.pending && selectedFileName && expected && selectedFileName === expected) {
            const mode = transition.current.confirm();
            reflectTransition();
            if (mode === 'fullscreen') onToggleFullscreen(true);
          }
          requestLatestPlayback();
          onShowToast?.(`已载入本地视频: ${selectedFileName || '本地视频'}`);
        }
      }
      else if (data.type === 'TOAST') {
        if (data.message) {
          onShowToast?.(data.message);
        }
      }
      else if (data.type === 'HOST_ONLY_WARNING') {
        if (onShowToast) onShowToast(data.message);
        else useRoomStore.getState().showToast(data.message);
      }
      else if (data.type === 'REQUEST_RESYNC') {
        requestLatestPlayback();
      }
      else if (data.type === 'MEDIA_REALTIME_STATUS') {
        const pending = pendingPlaybackQueryRef.current;
        if (pending && pending.id === data.queryId) {
          clearTimeout(pending.timer);
          pendingPlaybackQueryRef.current = null;
          const p = data.payload;
          pending.resolve(p && Number.isFinite(p.currentTime) && Number.isFinite(p.playbackRate)
            ? { ...p, sampledAt: p.sampledAt ?? Date.now() } : null);
        }
        if (data.payload) {
          if (isHost && Number.isFinite(data.payload.playbackRate) && data.payload.playbackRate > 0) {
            setCurrentPlaybackRate(data.payload.playbackRate);
          }
          setVideoState(prev => ({
            currentTime: typeof data.payload.currentTime === 'number' ? data.payload.currentTime : prev.currentTime,
            duration: typeof data.payload.duration === 'number' ? data.payload.duration : prev.duration,
            paused: typeof data.payload.paused === 'boolean' ? data.payload.paused : prev.paused,
          }));
        }
      }
    } catch (e) {
      console.error('WebView msg error:', e);
    }
  };

  const applyLocalPause = () => {
    webviewRef.current?.injectJavaScript('if(window.__syncCmd) window.__syncCmd({ paused: true }); true;');
    setVideoState(prev => ({ ...prev, paused: true }));
  };

  const applyLocalSync = (paused: boolean, currentTime: number, rate: number = currentPlaybackRate) => {
    const script = `if(window.__syncCmd) window.__syncCmd({ paused: ${paused}, currentTime: ${currentTime}, playbackRate: ${rate} }); true;`;
    webviewRef.current?.injectJavaScript(script);
    // Scrub controls own the pending preview. Only a player report can confirm
    // its position; an optimistic clock would acknowledge the seek too early.
  };

  const sendRemoteSync = (paused: boolean) => {
    if (transition.current.pending) return;
    webviewRef.current?.injectJavaScript(`if(window.__syncCmd) window.__syncCmd({ paused: ${paused}, playbackRate: ${currentPlaybackRate} }); true;`);
    setVideoState(prev => ({ ...prev, paused }));
    socketService.publishCurrentPlayback(paused ? 'pause' : 'play');
  };

  const sendRemoteSeek = (time: number) => {
    if (!isHost || transition.current.pending) return;
    applyLocalSync(videoState.paused, time, currentPlaybackRate);
    // The player's completed seek is the only authoritative room broadcast.
  };

  const showHours = (videoState.duration >= 3600) || (videoState.currentTime >= 3600);
  const displayTime = scrub.displayTime;

  useEffect(() => {
    if (onVideoStateChange) {
      onVideoStateChange(videoState);
    }
  }, [videoState.currentTime, videoState.duration, videoState.paused]);

  const RNCWebView = WebView as any;

  useEffect(() => {
    onPlayerPresentationChange?.({ hasVideo, mode: isFullscreen ? 'fullscreen' : isFloatingPlayer ? 'floating' : 'page' });
  }, [hasVideo, isFullscreen, isFloatingPlayer, onPlayerPresentationChange]);

  return (
    <View style={styles.container}>
      {/* 核心 WebView 容器：所有协议先进入导航检查，避免库默认用 Linking 打开外部 App。 */}
      <RNCWebView
        ref={webviewRef}
        source={webviewSource}
        originWhitelist={['*']}
        userAgent={PC_USER_AGENT}
        contentMode="desktop"
        setSupportMultipleWindows={true}
        javaScriptCanOpenWindowsAutomatically={false}
        allowsLinkPreview={false}
        // iOS accepts this setting; Android forwards it to an array-only Fabric
        // parser, where a string can crash the process before the view mounts.
        dataDetectorTypes={Platform.OS === 'ios' ? 'none' : undefined}
        domStorageEnabled={true}
        thirdPartyCookiesEnabled={true}
        sharedCookiesEnabled={true}
        mixedContentMode="always"
        allowsBackForwardNavigationGestures={!isFullscreen && !isFloatingPlayer}
        injectedJavaScriptBeforeContentLoaded={`window.__yiqikanScanSameOriginFrames = ${Platform.OS === 'android'};\nwindow.__canNavigate = ${canNavigate};\nwindow.__isHost = ${isHost};\nwindow.__followSyncEnabled = ${!isHost && !memberLocalPause && !memberMediaPending && Boolean(roomState) && AppState.currentState === 'active'};\n${playerScript}\n${INJECTED_BEFORE_LOAD_SCRIPT}`}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
        injectedJavaScript={`window.__yiqikanScanSameOriginFrames = ${Platform.OS === 'android'};\nwindow.__canNavigate = ${canNavigate};\nwindow.__isHost = ${isHost};\nwindow.__followSyncEnabled = ${!isHost && !memberLocalPause && !memberMediaPending && Boolean(roomState) && AppState.currentState === 'active'};\n${playerScript}\n${INJECTED_SCRIPT}\nif(window.__yiqikanPlayer) window.__yiqikanPlayer.attach(); true;`}
        injectedJavaScriptForMainFrameOnly={false}
        onMessage={handleMessage}
        onOpenWindow={(syntheticEvent: any) => {
          const { targetUrl } = syntheticEvent?.nativeEvent || {};
          if (!targetUrl || typeof targetUrl !== 'string') return;
          const lower = targetUrl.trim().toLowerCase();
          const isAllowedScheme = lower.startsWith('http://') || lower.startsWith('https://');
          if (!isAllowedScheme) {
            console.log('[WebView] 已拦截非法第三方外链协议:', targetUrl);
            return;
          }
          if (!canNavigate) {
            if (onShowToast) onShowToast('跟随房主中，可切换自由浏览进行跳转');
            else useRoomStore.getState().showToast('跟随房主中，可切换自由浏览进行跳转');
            return;
          }
          // 正在播放视频时，避免弹窗广告强行切走视频
          if (hasVideo) {
            console.log('[WebView] 正在播放视频，已拦截第三方弹窗页面:', targetUrl);
            return;
          }
          webviewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(targetUrl)}; true;`);
        }}
        mediaPlaybackRequiresUserAction={false}
        mediaTypesRequiringUserActionForPlayback="none"
        allowsInlineMediaPlayback={true}
        androidHardwareAccelerationDisabled={false}
        androidLayerType="hardware"
        style={styles.webview}
        containerStyle={{ backgroundColor: '#000' }}
        opaque={false}
        backgroundColor="#000000"
        onShouldStartLoadWithRequest={(request: any) => {
          const url = request?.url;
          if (!url || typeof url !== 'string') return false;

          // 本地视频模式放行内部页面与媒体流
          if (isLocalVideoMode) {
            const lower = url.trim().toLowerCase();
            if (/^about:(blank|srcdoc)([?#]|$)/.test(lower) || lower.startsWith('https://yiqikan.club') || lower.startsWith('blob:') || lower.startsWith('data:')) {
              return true;
            }
          }

          // 1. 强力拦截所有非 Web 协议（如 alipays://, weixin://, tbopen://, itms-appss://, market:// 等）
          const lower = url.trim().toLowerCase();
          const isAllowedScheme = 
            lower.startsWith('http://') || 
            lower.startsWith('https://') || 
            /^about:(blank|srcdoc)([?#]|$)/.test(lower) ||
            lower.startsWith('data:') || 
            lower.startsWith('blob:');

          if (!isAllowedScheme) {
            console.log('[WebView] 已拦截第三方应用/私有协议跳转:', url);
            return false;
          }

          // 2. 针对受限模式的顶层跳转拦截
          if (!canNavigate && request.isTopFrame && url !== 'about:blank' && url !== currentUrl && url !== actualUrlRef.current
            && !(transition.current.pending?.phase === 'loading' && url === episodeNavigation.current)) {
             if (onShowToast) onShowToast('跟随房主中，可切换自由浏览进行跳转');
             else useRoomStore.getState().showToast('跟随房主中，可切换自由浏览进行跳转');
             return false;
          }

          return true;
        }}
        onNavigationStateChange={(navState: any) => {
          if (isLocalVideoMode) {
            if (navState.title) {
              setVideoTitle(expectedFileName || '本地视频');
            }
            if (onNavigationStateChange) {
              onNavigationStateChange(false, false, currentUrl, expectedFileName || '本地视频');
            }
            return;
          }
          // 原生重定向只记录实际 URL，不回写 source，避免重复加载中间页面。
          if (navState.url && !navState.url.startsWith('about:blank')) {
            actualUrlRef.current = navState.url;
          }
          if (navState.title) {
            setVideoTitle(navState.title);
          }
          if (onNavigationStateChange) {
            onNavigationStateChange(navState.canGoBack, navState.canGoForward, navState.url, navState.title);
          }
        }}
        onLoadStart={startPageTransition}
        onTouchStart={() => {
          if (isFloatingPlayer && !isFullscreen) webviewRef.current?.injectJavaScript('if(window.__yiqikanPlayer)window.__yiqikanPlayer.wake(); true;');
        }}
        onLoadProgress={({ nativeEvent }: any) => setLoadProgress(nativeEvent.progress)}
        onError={({ nativeEvent }: any) => {
          failMediaTransition();
          setHasVideo(false);
          onShowToast?.(`网页加载失败（${nativeEvent.code ?? '未知错误'}）：${nativeEvent.description || '请刷新重试'}`, { type: 'info' });
        }}
        onHttpError={({ nativeEvent }: any) => {
          onShowToast?.(`网站返回错误 ${nativeEvent.statusCode}，请检查网址或刷新重试`, { type: 'info' });
        }}
        onRenderProcessGone={() => {
          failMediaTransition();
          setHasVideo(false);
          onShowToast?.('网页显示进程已退出，请刷新重试', { type: 'info' });
        }}
      />

      {/* 页面加载细进度条 */}
      {loadProgress < 1 && (
        <View style={[styles.progressBar, { width: `${loadProgress * 100}%` }]} />
      )}
      
      {/* 弹幕浮层 */}
      <DanmakuOverlay 
        enabled={isFullscreen && isDanmakuEnabled} 
        isDrawerOpen={isLandscapeDrawerOpen}
      />

      {/* 全屏台灯随控制栏变淡；竖屏使用固定播放条，不再重复悬浮入口。 */}
      {isFullscreen && <Animated.View
        {...lampPanResponder.panHandlers}
        pointerEvents="auto"
        style={[
          styles.draggableLampContainer, 
          isFloatingPlayer && !isFullscreen && { display: 'none' },
          isFullscreen ? styles.lampFullscreenPos : styles.lampPortraitPos,
          { 
            opacity: lampOpacityAnim, 
            transform: pan.getTranslateTransform()
          }
        ]}
      >
        {(() => {
          const isLampLit = isFullscreen ? showControls : !!isPortraitPanelExpanded;
          return (
            <TouchableOpacity 
              testID="辅助灯光与面板控制按钮"
              accessibilityLabel="辅助灯光与面板控制按钮"
              style={[styles.lampButton, isLampLit && styles.lampButtonActive]} 
              onPress={() => {
                if (isDraggingLamp.current) return;
                if (isFullscreen) {
                  toggleControls();
                } else if (onLampPress) {
                  onLampPress();
                }
              }}
              activeOpacity={0.75}
            >
              <Lightbulb 
                color={isLampLit ? "#FFF7ED" : "rgba(255, 255, 255, 0.45)"} 
                fill={isLampLit ? "#F97316" : "transparent"} 
                strokeWidth={isLampLit ? 2.2 : 1.8}
                size={21} 
              />
            </TouchableOpacity>
          );
        })()}
      </Animated.View>}

      {/* 全屏控制 HUD: 顶部导航条 */}
      {isFullscreen && (
        <TouchableOpacity
          testID="fullscreen-header-controls-trigger"
          accessibilityLabel="显示全屏控制栏"
          accessibilityRole="button"
          style={[styles.fullscreenTopBar, styles.fullscreenHeaderTrigger]}
          onPress={resetTimers}
          activeOpacity={1}
        />
      )}
      {isFullscreen && (
        <Animated.View 
          pointerEvents={showControls ? 'box-none' : 'none'}
          style={[
            styles.fullscreenTopBar,
            { opacity: hudOpacityAnim }
          ]}
        >
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs><LinearGradient id="player-header-shade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000" stopOpacity={0.6} />
              <Stop offset="1" stopColor="#000" stopOpacity={0} />
            </LinearGradient></Defs>
            <Rect width="100" height="100" fill="url(#player-header-shade)" />
          </Svg>
          <TouchableOpacity 
            style={styles.hudIconBtn} 
            accessibilityLabel="退出播放器全屏"
            testID="player-exit-fullscreen"
            onPress={() => {
              if (transition.current.pending) transition.current.pending.mode = isFloatingPlayer ? 'floating' : 'page';
              onToggleFullscreen(false);
            }}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.6}
          >
            <ChevronLeft color="#fff" size={28} />
          </TouchableOpacity>

          <View style={styles.topBarTitleGroup} pointerEvents="none">
            <Text style={styles.topBarTitle} numberOfLines={1}>
              {videoTitle}
            </Text>
            {roomState && (
              <View style={styles.roomBadge}>
                {roomState.hasPassword && <Lock size={12} color="#F97316" style={{ marginRight: 4 }} />}
                <Text style={styles.roomBadgeText}>房间 {roomState.id}</Text>
              </View>
            )}
          </View>

          {(voiceStatus === 'connected' || voiceStatus === 'reconnecting') && (
            <TouchableOpacity 
              style={[
                styles.hudIconBtn, 
                isMuted ? styles.hudIconBtnMuted : stats.isLocalSpeaking ? styles.hudIconBtnSpeaking : null,
                voiceStatus === 'reconnecting' && { opacity: 0.6 },
                { marginRight: 8 }
              ]} 
              onPress={() => {
                toggleMute();
                resetTimers();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              {isMuted ? (
                <MicOff color="#FB7185" size={20} />
              ) : (
                <Mic color={stats.isLocalSpeaking ? "#4ADE80" : "#E4E4E7"} size={20} />
              )}
            </TouchableOpacity>
          )}

          {/* 弹幕主开关：高辨识度【弹】字徽章按钮 */}
          <TouchableOpacity 
            style={[
              styles.danmakuToggleBtn, 
              isDanmakuEnabled ? styles.danmakuToggleBtnActive : styles.danmakuToggleBtnMuted,
              { marginRight: 8 }
            ]} 
            onPress={() => {
              setIsDanmakuEnabled(!isDanmakuEnabled);
              resetTimers();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            accessibilityLabel="弹幕开关"
            testID="弹幕开关"
          >
            <Text style={[styles.danmakuToggleText, isDanmakuEnabled ? styles.danmakuToggleTextActive : styles.danmakuToggleTextMuted]}>
              弹
            </Text>
            {!isDanmakuEnabled && <View style={styles.danmakuToggleSlash} />}
          </TouchableOpacity>

          {/* 右侧极简互动抽屉展开按钮 */}
          <TouchableOpacity 
            style={[styles.hudIconBtn, isLandscapeDrawerOpen && styles.hudIconBtnActive]} 
            onPress={() => {
              setIsLandscapeDrawerOpen(prev => !prev);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            accessibilityLabel="横屏互动抽屉按钮"
            testID="横屏互动抽屉按钮"
          >
            <MessageSquareText color={isLandscapeDrawerOpen ? "#F97316" : "#fff"} size={20} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* 普通成员本地暂停时的【追赶房主】胶囊提示 */}
      {!isHost && memberLocalPause && !switchPhase && roomState && (
        <View style={[styles.catchUpBanner, isFullscreen ? styles.catchUpBannerFullscreen : styles.catchUpBannerPortrait]}>
          <Text style={styles.catchUpText}>已临时本地暂停</Text>
          <TouchableOpacity style={styles.catchUpBtn} onPress={handleCatchUpHost} activeOpacity={0.7}>
            <FastForward size={14} color="#fff" style={{ marginRight: 4 }} />
            <Text style={styles.catchUpBtnText}>追赶房主</Text>
          </TouchableOpacity>
        </View>
      )}

      {switchPhase && <PlayerTransitionNotice phase={switchPhase} isHost={isHost} episodeLabel={roomState?.playback.media?.episode?.label} onConfirm={confirmMemberMedia} />}

      {/* 全屏控制 HUD: 底部控制条 */}
      {isFullscreen && hasVideo && (
        <Animated.View 
          pointerEvents={showControls ? 'box-none' : 'none'}
          style={[
            styles.fullscreenBottomBar,
            { opacity: hudOpacityAnim }
          ]}
        >
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs><LinearGradient id="player-footer-shade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000" stopOpacity={0} />
              <Stop offset="1" stopColor="#000" stopOpacity={0.7} />
            </LinearGradient></Defs>
            <Rect width="100" height="100" fill="url(#player-footer-shade)" />
          </Svg>
          <View style={styles.controlsRow}>
            {/* 播放/暂停 */}
            <TouchableOpacity 
              style={styles.playPauseBtn} 
              testID="player-toggle-play-pause"
              accessibilityLabel={videoState.paused ? '播放视频' : '暂停视频'}
              onPress={() => { handleTogglePlayPause(); resetTimers(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              {videoState.paused ? <Play color="#fff" size={22} fill="#fff" /> : <Pause color="#fff" size={22} fill="#fff" />}
            </TouchableOpacity>

            {/* 快退 10s */}
            <TouchableOpacity 
              style={styles.smallHudBtn} 
              accessibilityLabel="快退 10 秒"
              disabled={!scrub.canSeek}
              onPress={() => scrub.onSlidingComplete(Math.max(0, displayTime - 10))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <SeekBackward10Icon color="#ccc" size={22} />
            </TouchableOpacity>

            {/* 当前时间 */}
            <Text style={styles.timeLabel}>{formatTime(displayTime, showHours)}</Text>

            {/* 进度条 */}
            <Slider
              style={styles.hudSlider}
              disabled={!scrub.canSeek}
              minimumValue={0}
              maximumValue={scrub.maximumValue}
              value={scrub.sliderValue}
              minimumTrackTintColor="#F97316"
              maximumTrackTintColor="rgba(255,255,255,0.2)"
              thumbTintColor="#F97316"
              onSlidingStart={(val) => {
                scrub.onSlidingStart(val);
                if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
              }}
              onValueChange={scrub.onValueChange}
              onSlidingComplete={scrub.onSlidingComplete}
            />

            {/* 总时长 */}
            <Text style={styles.durationLabel}>{formatTime(videoState.duration, showHours)}</Text>

            {/* 快进 10s */}
            <TouchableOpacity 
              style={styles.smallHudBtn} 
              disabled={!scrub.canSeek}
              accessibilityLabel="快进 10 秒"
              onPress={() => scrub.onSlidingComplete(Math.min(videoState.duration, displayTime + 10))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <SeekForward10Icon color="#ccc" size={22} />
            </TouchableOpacity>

            {/* 倍速切换按钮 */}
            <TouchableOpacity 
              style={[styles.rateBtn, showRateMenu && styles.rateBtnActive]} 
              disabled={!isHost}
              onPress={() => {
                setShowRateMenu(!showRateMenu);
                resetTimers();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Text style={styles.rateBtnText}>{currentPlaybackRate}x</Text>
            </TouchableOpacity>

            {/* 退出全屏 */}
            <TouchableOpacity 
              style={styles.smallHudBtn} 
              accessibilityLabel="退出播放器全屏"
              onPress={() => {
                if (transition.current.pending) transition.current.pending.mode = isFloatingPlayer ? 'floating' : 'page';
                onToggleFullscreen(false);
              }}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              activeOpacity={0.6}
            >
              <Minimize2 color="#fff" size={20} />
            </TouchableOpacity>
          </View>

          {/* 倍速弹出选择列表 */}
          {showRateMenu && (
            <View style={styles.rateMenuContainer}>
              {PLAYBACK_RATES.map(rate => (
                <TouchableOpacity 
                  key={rate} 
                  style={[styles.rateMenuItem, currentPlaybackRate === rate && styles.rateMenuItemActive]}
                  onPress={() => handleSelectPlaybackRate(rate)}
                >
                  <Text style={[styles.rateMenuItemText, currentPlaybackRate === rate && styles.rateMenuItemTextActive]}>
                    {rate}x
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Animated.View>
      )}

      {/* 横屏全屏模式下的半透明极简互动抽屉 */}
      {isFullscreen && (
        <LandscapeDrawer
          visible={isLandscapeDrawerOpen}
          onClose={() => setIsLandscapeDrawerOpen(false)}
          onShowToast={onShowToast}
          isHost={isHost}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 2.5,
    backgroundColor: '#F97316',
    zIndex: 50,
  },
  draggableLampContainer: {
    position: 'absolute',
    zIndex: 60,
  },
  lampFullscreenPos: {
    bottom: 86,
    right: 26,
  },
  lampPortraitPos: {
    bottom: 14,
    right: 14,
  },
  lampButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Platform.OS === 'android' ? 'rgba(18, 20, 26, 0.85)' : 'rgba(15, 16, 22, 0.65)',
    borderWidth: 1,
    borderColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.16)' : undefined,
    borderTopColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.32)' : undefined,
    borderBottomColor: Platform.OS !== 'android' ? 'rgba(0, 0, 0, 0.45)' : undefined,
    borderLeftColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.12)' : undefined,
    borderRightColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.12)' : undefined,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: Platform.OS === 'android' ? 0 : 3,
  },
  lampButtonActive: {
    backgroundColor: Platform.OS === 'android' ? 'rgba(234, 88, 12, 0.88)' : 'rgba(234, 88, 12, 0.42)',
    borderWidth: Platform.OS === 'android' ? 1 : 1.2,
    borderColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.65)' : undefined,
    borderTopColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.75)' : undefined,
    borderBottomColor: Platform.OS !== 'android' ? 'rgba(249, 115, 22, 0.45)' : undefined,
    borderLeftColor: Platform.OS !== 'android' ? 'rgba(255, 200, 120, 0.60)' : undefined,
    borderRightColor: Platform.OS !== 'android' ? 'rgba(255, 200, 120, 0.60)' : undefined,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 14,
    elevation: Platform.OS === 'android' ? 0 : 8,
  },
  fullscreenTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 50,
  },
  fullscreenHeaderTrigger: {
    backgroundColor: 'transparent',
    zIndex: 40,
  },
  topBarTitleGroup: {
    flex: 1,
    marginHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  topBarTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
    marginRight: 10,
  },
  roomBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roomBadgeText: {
    color: '#F97316',
    fontSize: 11,
    fontWeight: '600',
  },
  hudIconBtn: {
    padding: 8,
    borderRadius: 8,
  },
  hudIconBtnActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
  },
  hudIconBtnMuted: {
    backgroundColor: 'rgba(244, 63, 94, 0.2)',
  },
  hudIconBtnSpeaking: {
    backgroundColor: 'rgba(34, 197, 94, 0.25)',
    borderColor: '#22C55E',
    borderWidth: 1,
  },
  danmakuToggleBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    position: 'relative',
    overflow: 'hidden',
  },
  danmakuToggleBtnActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
    borderColor: '#F97316',
  },
  danmakuToggleBtnMuted: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  danmakuToggleText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  danmakuToggleTextActive: {
    color: '#F97316',
  },
  danmakuToggleTextMuted: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
  danmakuToggleSlash: {
    position: 'absolute',
    width: 34,
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    transform: [{ rotate: '-45deg' }],
  },
  fullscreenBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 16,
    paddingTop: 28,
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
    zIndex: 50,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playPauseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  smallHudBtn: {
    padding: 8,
    marginHorizontal: 4,
  },
  timeLabel: {
    color: '#ccc',
    fontSize: 12,
    fontFamily: 'monospace',
    marginLeft: 6,
    minWidth: 42,
    textAlign: 'center',
  },
  durationLabel: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
    marginRight: 6,
    minWidth: 42,
    textAlign: 'center',
  },
  hudSlider: {
    flex: 1,
    height: 36,
    marginHorizontal: 4,
  },
  rateBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: 6,
  },
  rateBtnActive: {
    backgroundColor: '#F97316',
  },
  rateBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  rateMenuContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 10,
    gap: 8,
  },
  rateMenuItem: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  rateMenuItemActive: {
    backgroundColor: '#F97316',
  },
  rateMenuItemText: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
  },
  rateMenuItemTextActive: {
    color: '#fff',
  },
  catchUpBanner: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.95)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    zIndex: 65,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  catchUpBannerFullscreen: {
    top: 70,
    alignSelf: 'center',
  },
  catchUpBannerPortrait: {
    top: 14,
    alignSelf: 'center',
  },
  catchUpText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    marginRight: 8,
  },
  catchUpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  catchUpBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
});

export default RoomWebView;
