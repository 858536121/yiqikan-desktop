import type { NativeMessage } from '../contracts';

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

  function postMsg(data: NativeMessage) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      }
    } catch(e) {}
  }

  // 2. window.open 与安全/权限拦截
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
        postMsg({ type: 'HOST_ONLY_WARNING', message: '跟随房主中，可切换自由浏览进行跳转' });
        return { closed: true, location: {}, focus: function(){}, close: function(){} } as unknown as Window;
      }
      if (!isSafeWebUrl(url)) {
        postMsg({ type: 'LOG', msg: '已拦截非Web协议弹窗: ' + url });
        return { closed: true, location: {}, focus: function(){}, close: function(){} } as unknown as Window;
      }
      if (url && typeof url === 'string' && url !== 'about:blank') {
        window.location.href = url;
      }
      return window;
    };
  } catch (e) {}

  // 3. 全网通用：底层强制内联播放（Inline）与 iOS 原生全屏弹窗屏蔽
  try {
    function makeInline(v: HTMLVideoElement | null) {
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
    Document.prototype.createElement = function(tagName: string, options?: ElementCreationOptions) {
      var el = origCreateElement.call(this, tagName, options);
      if (el && typeof tagName === 'string') {
        var lower = tagName.toLowerCase();
        if (lower === 'video' || lower === 'bwp-video') {
          makeInline(el as HTMLVideoElement);
        }
      }
      return el;
    };

    // B. Hook HTMLMediaElement & HTMLVideoElement 原型链
    if (window.HTMLMediaElement && HTMLMediaElement.prototype) {
      var origMediaPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() {
        if (this && (this.tagName === 'VIDEO' || this.tagName === 'BWP-VIDEO')) {
          makeInline(this as HTMLVideoElement);
        }
        return Reflect.apply(origMediaPlay, this, arguments);
      };
    }

    if (window.HTMLVideoElement && HTMLVideoElement.prototype) {
      var videoProto = HTMLVideoElement.prototype;

      // 兜底防御 HTMLVideoElement 自身定义的 play
      if (videoProto.play && videoProto.play !== HTMLMediaElement.prototype.play) {
        var origVideoPlay = videoProto.play;
        videoProto.play = function() {
          makeInline(this as HTMLVideoElement);
          return Reflect.apply(origVideoPlay, this, arguments);
        };
      }

      // 彻底阻断 iOS 原生 webkitEnterFullscreen 弹窗（防止唤起 QuickTime/AVPlayer 破坏房间同步与覆盖层）
      videoProto.webkitEnterFullscreen = function() {
        makeInline(this as HTMLVideoElement);
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
    var handleFullscreenRequest = function(this: HTMLVideoElement) {
      if (this && this.tagName && (this.tagName === 'VIDEO' || this.tagName === 'BWP-VIDEO' || (this.querySelector && this.querySelector<HTMLVideoElement>('video, bwp-video')))) {
        makeInline(this.tagName === 'VIDEO' ? this : this.querySelector<HTMLVideoElement>('video, bwp-video'));
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
          var node = added[j] as Element;
          if (node && node.nodeType === 1) {
            if (node.tagName === 'VIDEO' || node.tagName === 'BWP-VIDEO') {
              makeInline(node as HTMLVideoElement);
            } else if (node.querySelectorAll) {
              var vids = node.querySelectorAll<HTMLVideoElement>('video, bwp-video');
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
