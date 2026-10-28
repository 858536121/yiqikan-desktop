import { findBestPlayerInFrame, wrapVideoElement, getCleanVideoTitle, installPlayerDiscovery } from './players';
import { installPlayback } from './playback';
import { applyTheaterMode } from './presentation';
import type { NativeMessage } from '../contracts';


// 1. 拦截非法协议与 window.open，强制在当前安全 Web 容器中加载
try {
  function isSafeWebUrl(u: unknown) {
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
      return { closed: true, location: {}, focus: function(){}, close: function(){} } as unknown as Window;
    }
    if (!isSafeWebUrl(url)) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'LOG', msg: '已拦截非Web协议弹窗: ' + url }));
      }
      return { closed: true, location: {}, focus: function(){}, close: function(){} } as unknown as Window;
    }
    if (url && typeof url === 'string' && url !== 'about:blank') {
      window.location.href = url;
    }
    return window;
  };
} catch (e) {}

// 2. 点击事件拦截：重写 target 为 _self，并对跟随页面模式及第三方应用私有 Scheme 进行阻断
document.addEventListener('click', (e) => {
  const target = e.target as Element | null;
  const anchor = target && target.closest ? target.closest<HTMLAnchorElement>('a') : null;
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

(function() {
  if (window.__YIQIKAN_INJECTED) return;
  window.__YIQIKAN_INJECTED = true;

  const sendMessage = (msg: NativeMessage) => {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };

  installPlayerDiscovery();
  const playback = installPlayback({ findBestPlayerInFrame, wrapVideoElement, getCleanVideoTitle, sendMessage, applyTheaterMode });
  const { reportState, hookVideoEvents } = playback;
  const forceInline = (v: HTMLVideoElement) => {
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
      var touchTime = window.__lastUserTouchTime || playback.lastTouchTime || 0;
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
      m.addedNodes.forEach((addedNode) => {
        const node = addedNode as Element;
        if (node.tagName === 'VIDEO' || node.tagName === 'BWP-VIDEO') {
          forceInline(node as HTMLVideoElement);
        } else if (node.querySelectorAll) {
          const videos = node.querySelectorAll<HTMLVideoElement>('video, bwp-video');
          if (videos.length > 0) videos.forEach(forceInline);
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let hasReportedVideoFound = false;
  let lastVideoElement: HTMLVideoElement | boolean | null = null;

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

  window.addEventListener('pagehide', () => window.__resetVideoSync());
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    // A restored history document keeps its old detection flag, but its sync
    // was cleared on pagehide. Rediscover it so native requests a fresh sample.
    hasReportedVideoFound = false;
    pollVideo();
  });

  let lastDiscoveryAt = -Infinity;
  setInterval(() => {
    const now = Date.now();
    if (now - lastDiscoveryAt >= 1000) {
      lastDiscoveryAt = now;
      if (!pollVideo()) pollIframe();
    }
    const player = findBestPlayerInFrame();
    if (player) reportState(player, 'heartbeat');
  }, 250);

})();
true;
