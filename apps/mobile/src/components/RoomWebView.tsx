import React, { useRef, useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, PanResponder, AppState, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useRoomStore } from '../store/useRoomStore';
import { socketService } from '../services/socket';
import Slider from '@react-native-community/slider';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  ChevronLeft, 
  Lamp, 
  MessageSquare,
  Lock,
  FastForward,
  Mic,
  MicOff
} from 'lucide-react-native';
import { RotateToPortraitIcon } from './icons/ScreenRotationIcons';
import { DanmakuOverlay } from './app/danmaku-overlay';
import { useVoice } from '../services/voice-service';

const PC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const INJECTED_SCRIPT = `
document.addEventListener('click', (e) => {
  if (window.__isHost === false) {
    const anchor = e.target.closest ? e.target.closest('a[href]') : null;
    if (anchor) {
      e.preventDefault();
      e.stopPropagation();
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'HOST_ONLY_WARNING', message: '只有房主可以点击链接跳转' }));
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

  function findBestPlayerInFrame() {
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
    return best ? wrapVideoElement(best) : null;
  }

  const forceInline = (v) => {
    if (v.__inlineSet) return;
    v.setAttribute('playsinline', 'true');
    v.setAttribute('webkit-playsinline', 'true');
    
    // 拦截原生全屏 API，触发自定义全屏
    const preventFullscreen = function() {
      sendMessage({ type: 'TOGGLE_FULLSCREEN' });
      return Promise.resolve();
    };
    if (typeof v.webkitEnterFullscreen === 'function') v.webkitEnterFullscreen = preventFullscreen;
    if (typeof v.requestFullscreen === 'function') v.requestFullscreen = preventFullscreen;
    
    document.exitFullscreen = preventFullscreen;
    if (document.webkitExitFullscreen) document.webkitExitFullscreen = preventFullscreen;
    
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
      } 
    });
  }

  function hookVideoEvents(v) {
    if (v.__yiqikan_hooked) return;
    
    v.addEventListener('play', (e) => {
      if (window.__isHost === false && Date.now() > (window.__syncInProgressUntil || 0)) {
        v.pause();
        sendMessage({ type: 'HOST_ONLY_WARNING', message: '仅房主可操作播放，自动恢复跟播' });
        sendMessage({ type: 'REQUEST_RESYNC' });
        return;
      }
      var p = findBestPlayerInFrame() || wrapVideoElement(v);
      reportState(p, 'play');
    });
    
    v.addEventListener('pause', (e) => {
      var p = findBestPlayerInFrame() || wrapVideoElement(v);
      reportState(p, 'pause');
    });
    
    v.addEventListener('seeked', (e) => {
      if (window.__isHost === false && Date.now() > (window.__syncInProgressUntil || 0)) {
        sendMessage({ type: 'HOST_ONLY_WARNING', message: '仅房主可调整进度，自动恢复跟播' });
        sendMessage({ type: 'REQUEST_RESYNC' });
        return;
      }
      var p = findBestPlayerInFrame() || wrapVideoElement(v);
      reportState(p, 'seeked');
    });
    
    v.addEventListener('timeupdate', () => {
      if (!window._lastUpdate || Date.now() - window._lastUpdate > 1000) {
        var p = findBestPlayerInFrame() || wrapVideoElement(v);
        reportState(p, 'timeupdate');
        window._lastUpdate = Date.now();
      }
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
        sendMessage({ type: 'VIDEO_FOUND', title: getCleanVideoTitle() });
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

  let smoothRateTimer = null;
  window.__syncCmd = (cmd) => {
    window.__syncInProgressUntil = Date.now() + 800;
    try {
      const player = findBestPlayerInFrame();
      if (!player) return;

      const baseRate = typeof cmd.playbackRate === 'number' ? cmd.playbackRate : (player.playbackRate || 1);

      if (typeof cmd.currentTime === 'number') {
        const current = player.currentTime;
        const diff = cmd.currentTime - current;
        const absDiff = Math.abs(diff);

        if (cmd.paused || absDiff > 1.8) {
          if (absDiff > 0.05) {
            player.seek(cmd.currentTime);
          }
          if (smoothRateTimer) {
            clearTimeout(smoothRateTimer);
            smoothRateTimer = null;
          }
          player.playbackRate = baseRate;
        } else if (absDiff > 0.35 && !player.paused) {
          const multiplier = diff > 0 ? 1.06 : 0.94;
          const tempRate = Math.max(0.25, Math.min(4, baseRate * multiplier));
          player.playbackRate = tempRate;
          if (smoothRateTimer) clearTimeout(smoothRateTimer);
          smoothRateTimer = setTimeout(() => {
            const p = findBestPlayerInFrame();
            if (p) p.playbackRate = baseRate;
            smoothRateTimer = null;
          }, 1500);
        } else if (absDiff <= 0.35) {
          if (smoothRateTimer) {
            clearTimeout(smoothRateTimer);
            smoothRateTimer = null;
          }
          if (player.playbackRate !== baseRate) {
            player.playbackRate = baseRate;
          }
        }
      }

      if (typeof cmd.paused === 'boolean') {
        if (cmd.paused && !player.paused) player.pause();
        else if (!cmd.paused && player.paused) {
          let p = player.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      }

      if (typeof cmd.playbackRate === 'number' && !smoothRateTimer) {
        if (player.playbackRate !== cmd.playbackRate) {
          player.playbackRate = cmd.playbackRate;
        }
      }

      if (typeof cmd.fullscreen === 'boolean') {
        applyTheaterMode(cmd.fullscreen);
      }
    } catch(e) {
      sendMessage({ type: 'LOG', msg: '指令执行报错: ' + e.message });
    }
  };

  function applyTheaterMode(enable) {
    try {
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
    if (!pollVideo()) {
      pollIframe();
    }
  }, 1500);

})();
true;
`;

export interface RoomWebViewRef {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  togglePlayPause: () => void;
  seekRelative: (seconds: number) => void;
  seekTo: (time: number) => void;
  setPaused: (paused: boolean) => void;
  setRate: (rate: number) => void;
  setPlaybackRate: (rate: number) => void;
}

interface RoomWebViewProps {
  initialUrl: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onNavigationStateChange?: (canGoBack: boolean, canGoForward: boolean, currentUrl: string, title?: string) => void;
  onLampPress?: () => void;
  isPortraitPanelExpanded?: boolean;
  onVideoStateChange?: (state: { currentTime: number; duration: number; paused: boolean }) => void;
  isHost?: boolean;
  onShowToast?: (msg: string) => void;
}

const PLAYBACK_RATES = [0.75, 1.0, 1.25, 1.5, 2.0];

const RoomWebView = React.forwardRef((
  { initialUrl, isFullscreen, onToggleFullscreen, onNavigationStateChange, onLampPress, isPortraitPanelExpanded, onVideoStateChange, isHost = true, onShowToast }: RoomWebViewProps,
  ref: React.ForwardedRef<RoomWebViewRef>
) => {
  const webviewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const actualUrlRef = useRef(initialUrl);
  const [videoTitle, setVideoTitle] = useState('当前视频');
  const [headers, setHeaders] = useState<any>({});
  const [videoState, setVideoState] = useState({ currentTime: 0, duration: 0, paused: true });
  const [hasVideo, setHasVideo] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [slideValue, setSlideValue] = useState(0);

  // 全屏 HUD 控制栏显示状态
  const [showControls, setShowControls] = useState(true);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const currentPlaybackRate = useRoomStore(state => state.currentPlaybackRate);
  const setCurrentPlaybackRate = useRoomStore(state => state.setCurrentPlaybackRate);
  
  const roomState = useRoomStore(state => state.roomState);
  const memberLocalPause = useRoomStore(state => state.memberLocalPause);
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
  const lastTapRef = useRef<number>(0);
  const { voiceStatus, isMuted, toggleMute, stats } = useVoice();

  // 注册全局回传当前播放状态的 getter
  useEffect(() => {
    socketService.registerPlaybackGetter(() => ({
      currentTime: videoState.currentTime,
      paused: videoState.paused,
      playbackRate: currentPlaybackRate,
      duration: videoState.duration,
    }));
    return () => {
      socketService.unregisterPlaybackGetter();
    };
  }, [videoState, currentPlaybackRate]);

  useEffect(() => {
    webviewRef.current?.injectJavaScript(`window.__isHost = ${isHost}; true;`);
  }, [isHost]);

  // 重置控制条隐藏计时器
  const resetTimers = useCallback(() => {
    setShowControls(true);
    Animated.timing(hudOpacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    Animated.timing(lampOpacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    idleTimerRef.current = setTimeout(() => {
      setShowControls(false);
      setShowRateMenu(false);
      Animated.timing(hudOpacityAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      // 台灯淡化至 0.38 保持半透明常驻可点击，绝不隐藏至 0！
      Animated.timing(lampOpacityAnim, { toValue: 0.38, duration: 300, useNativeDriver: true }).start();
    }, 4500);
  }, [hudOpacityAnim, lampOpacityAnim]);

  const toggleControls = useCallback(() => {
    if (showControls) {
      setShowControls(false);
      setShowRateMenu(false);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      Animated.timing(hudOpacityAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
      Animated.timing(lampOpacityAnim, { toValue: 0.38, duration: 250, useNativeDriver: true }).start();
    } else {
      resetTimers();
    }
  }, [showControls, resetTimers, hudOpacityAnim, lampOpacityAnim]);

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
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4;
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
      onPanResponderRelease: () => {
        pan.flattenOffset();
        setTimeout(() => {
          isDraggingLamp.current = false;
        }, 100);
        resetTimers();
      },
    })
  ).current;

  // AppState 切后台与恢复
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        const state = useRoomStore.getState();
        if (state.roomState?.playback) {
          webviewRef.current?.injectJavaScript(`if(window.__syncCmd) window.__syncCmd({ paused: ${state.roomState.playback.paused}, currentTime: ${state.roomState.playback.currentTime} }); true;`);
        }
      }
      
      if (appState.current === 'active' && nextAppState.match(/inactive|background/)) {
        const state = useRoomStore.getState();
        if (state.isHost && state.roomState && state.roomState.members.length > 1) {
          const myId = socketService.getUserId();
          const nextHost = state.roomState.members.find(m => m.id !== myId);
          if (nextHost) {
            console.log(`[AppState] 房主切到后台，自动禅让给: ${nextHost.name}`);
            socketService.transferHost(state.roomState.id, nextHost.id);
          }
        }
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

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
      // 普通成员本地暂停或追赶
      if (videoState.paused) {
        // 恢复跟播
        setMemberLocalPause(false);
        const pb = roomState?.playback;
        if (pb) {
          applyLocalSync(pb.paused, pb.currentTime, currentPlaybackRate);
        }
        if (onShowToast) onShowToast('已恢复跟播房主进度');
      } else {
        // 本地暂停
        setMemberLocalPause(true);
        applyLocalSync(true, videoState.currentTime, currentPlaybackRate);
        if (onShowToast) onShowToast('已临时本地暂停，点击追赶即可同步');
      }
      return;
    }
    sendRemoteSync(!videoState.paused);
  };

  const handleCatchUpHost = () => {
    setMemberLocalPause(false);
    const pb = roomState?.playback;
    if (pb) {
      applyLocalSync(pb.paused, pb.currentTime, pb.playbackRate || 1);
      if (onShowToast) onShowToast('已同步对齐房主进度');
    }
  };

  const handleSelectPlaybackRate = (rate: number) => {
    setCurrentPlaybackRate(rate);
    setShowRateMenu(false);
    resetTimers();

    const script = `if(window.__syncCmd) window.__syncCmd({ playbackRate: ${rate} }); true;`;
    webviewRef.current?.injectJavaScript(script);

    if (isHost && roomState) {
      socketService.sendPlayerEvent({
        roomId: roomState.id,
        actorId: socketService.getUserId(),
        action: 'video_sync',
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
        applyLocalSync(paused, videoState.currentTime, currentPlaybackRate);
      }
    },
    setRate: handleSelectPlaybackRate,
    setPlaybackRate: handleSelectPlaybackRate,
  }));

  // 全屏指令
  useEffect(() => {
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

    // 如果当前成员处于本地暂停，且不是房主切新视频，暂不强制改变播放状态
    if (memberLocalPause && action !== 'load_url') {
      return;
    }
    
    const rate = typeof playbackRate === 'number' ? playbackRate : currentPlaybackRate;
    let script = '';
    if (action === 'play') {
      script = `if(window.__syncCmd) window.__syncCmd({ paused: false, currentTime: ${currentTime || 0}, playbackRate: ${rate} }); true;`;
    } else if (action === 'pause') {
      script = `if(window.__syncCmd) window.__syncCmd({ paused: true, currentTime: ${currentTime || 0}, playbackRate: ${rate} }); true;`;
    } else if (action === 'seek') {
      script = `if(window.__syncCmd) window.__syncCmd({ currentTime: ${currentTime || 0}, playbackRate: ${rate} }); true;`;
    } else if (action === 'video_sync') {
      script = `if(window.__syncCmd) window.__syncCmd({ paused: ${paused}, currentTime: ${currentTime || 0}, playbackRate: ${rate} }); true;`;
    }
    
    if (script) {
      webviewRef.current?.injectJavaScript(script);
    }
  }, [lastRemotePlayerEvent, isHost, memberLocalPause, currentPlaybackRate]);

  // URL 变更
  useEffect(() => {
    if (initialUrl && initialUrl !== actualUrlRef.current) {
      setCurrentUrl(initialUrl);
      actualUrlRef.current = initialUrl;
      setHasVideo(false);
      setMemberLocalPause(false);
    }
  }, [initialUrl, setMemberLocalPause]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'VIDEO_FOUND') {
        setHasVideo(true);
        if (data.title) setVideoTitle(data.title);
        
        if (!isHost) {
          const currentPlayback = useRoomStore.getState().roomState?.playback;
          if (currentPlayback) {
            const rate = typeof currentPlayback.playbackRate === 'number' ? currentPlayback.playbackRate : 1;
            const script = `if(window.__syncCmd) window.__syncCmd({ paused: ${currentPlayback.paused}, currentTime: ${currentPlayback.currentTime || 0}, playbackRate: ${rate} }); true;`;
            webviewRef.current?.injectJavaScript(script);
          }
        }
      } 
      else if (data.type === 'REQUEST_FULLSCREEN' || data.type === 'TOGGLE_FULLSCREEN') {
        onToggleFullscreen();
      } 
      else if (data.type === 'TOGGLE_CONTROLS' || data.type === 'TOUCH_INTERACT') {
        resetTimers();
      }
      else if (data.type === 'FOUND_IFRAME') {
        if (currentUrl === data.url || actualUrlRef.current === data.url) return;
        actualUrlRef.current = data.url;
        webviewRef.current?.injectJavaScript(`window.location.replace("${data.url}"); true;`);
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
        
        // 房主广播
        const storeState = useRoomStore.getState();
        if (storeState.isHost && storeState.roomState) {
          const eventName = data.payload.eventName;
          if (eventName === 'play' || eventName === 'pause' || eventName === 'seeked') {
            socketService.sendPlayerEvent({
              roomId: storeState.roomState.id,
              actorId: socketService.getUserId() || 'mobile-host',
              action: 'video_sync',
              currentTime: data.payload.currentTime,
              paused: data.payload.paused,
              playbackRate: currentPlaybackRate,
            });
          }
        }
      }
      else if (data.type === 'HOST_ONLY_WARNING') {
        if (onShowToast) onShowToast(data.message);
        else Alert.alert('提示', data.message);
      }
      else if (data.type === 'REQUEST_RESYNC') {
        const currentPlayback = useRoomStore.getState().roomState?.playback;
        if (currentPlayback) {
          const script = `if(window.__syncCmd) window.__syncCmd({ paused: ${currentPlayback.paused}, currentTime: ${currentPlayback.currentTime || 0} }); true;`;
          webviewRef.current?.injectJavaScript(script);
        }
      }
    } catch (e) {
      console.error('WebView msg error:', e);
    }
  };

  const applyLocalSync = (paused: boolean, currentTime: number, rate: number = currentPlaybackRate) => {
    const script = `if(window.__syncCmd) window.__syncCmd({ paused: ${paused}, currentTime: ${currentTime}, playbackRate: ${rate} }); true;`;
    webviewRef.current?.injectJavaScript(script);
    setVideoState(prev => ({ ...prev, paused, currentTime }));
  };

  const sendRemoteSync = (paused: boolean) => {
    applyLocalSync(paused, videoState.currentTime, currentPlaybackRate);
    if (!roomState) return;
    socketService.sendPlayerEvent({
      roomId: roomState.id,
      actorId: socketService.getUserId(),
      action: paused ? 'pause' : 'play',
      currentTime: videoState.currentTime,
      paused,
      playbackRate: currentPlaybackRate,
    });
  };

  const sendRemoteSeek = (time: number) => {
    applyLocalSync(videoState.paused, time, currentPlaybackRate);
    if (!roomState) return;
    socketService.sendPlayerEvent({
      roomId: roomState.id,
      actorId: socketService.getUserId(),
      action: 'seek',
      currentTime: time,
      paused: videoState.paused,
      playbackRate: currentPlaybackRate,
    });
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const displayTime = isSliding ? slideValue : videoState.currentTime;

  useEffect(() => {
    if (onVideoStateChange) {
      onVideoStateChange(videoState);
    }
  }, [videoState.currentTime, videoState.duration, videoState.paused]);

  const RNCWebView = WebView as any;

  return (
    <View style={styles.container}>
      {/* 核心 WebView 容器 */}
      <RNCWebView
        ref={webviewRef}
        source={{ uri: currentUrl, headers }}
        userAgent={PC_USER_AGENT}
        injectedJavaScript={`window.__isHost = ${isHost};\n${INJECTED_SCRIPT}`}
        onMessage={handleMessage}
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
          if (!isHost && request.isTopFrame && request.url !== 'about:blank' && request.url !== currentUrl && request.url !== actualUrlRef.current) {
             if (onShowToast) onShowToast('只有房主可以跳转页面');
             else Alert.alert('提示', '只有房主可以跳转页面');
             return false;
          }
          return true;
        }}
        onNavigationStateChange={(navState: any) => {
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
        onLoadProgress={({ nativeEvent }: any) => setLoadProgress(nativeEvent.progress)}
      />

      {/* 页面加载细进度条 */}
      {loadProgress < 1 && (
        <View style={[styles.progressBar, { width: `${loadProgress * 100}%` }]} />
      )}
      
      {/* 弹幕浮层 */}
      <DanmakuOverlay enabled={isFullscreen && isDanmakuEnabled} />

      {/* 辅助台灯悬浮按钮（全屏与竖屏均可用，拖拽移动，半透明常驻不消失） */}
      <Animated.View 
        {...lampPanResponder.panHandlers}
        style={[
          styles.draggableLampContainer, 
          isFullscreen ? styles.lampFullscreenPos : styles.lampPortraitPos,
          { 
            opacity: lampOpacityAnim, 
            transform: pan.getTranslateTransform()
          }
        ]}
      >
        <TouchableOpacity 
          style={[styles.lampButton, (showControls || isPortraitPanelExpanded) && styles.lampButtonActive]} 
          onPress={() => {
            if (isDraggingLamp.current) return;
            if (isFullscreen) {
              toggleControls();
            } else if (onLampPress) {
              onLampPress();
            }
          }}
          activeOpacity={0.7}
        >
          <Lamp color={(showControls || isPortraitPanelExpanded) ? "#F97316" : "#fff"} size={20} />
          {isFullscreen && !showControls && (
            <Text style={styles.lampTipText}>控制</Text>
          )}
        </TouchableOpacity>
      </Animated.View>

      {/* 全屏控制 HUD: 顶部导航条 */}
      {isFullscreen && (
        <Animated.View 
          pointerEvents={showControls ? 'box-none' : 'none'}
          style={[
            styles.fullscreenTopBar,
            { opacity: hudOpacityAnim }
          ]}
        >
          <TouchableOpacity 
            style={styles.hudIconBtn} 
            onPress={() => {
              onToggleFullscreen();
            }}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.6}
          >
            <ChevronLeft color="#fff" size={28} />
          </TouchableOpacity>

          <View style={styles.topBarTitleGroup}>
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

          {voiceStatus === 'connected' && (
            <TouchableOpacity 
              style={[
                styles.hudIconBtn, 
                isMuted ? styles.hudIconBtnMuted : stats.isLocalSpeaking ? styles.hudIconBtnSpeaking : null,
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

          <TouchableOpacity 
            style={[styles.hudIconBtn, isDanmakuEnabled && styles.hudIconBtnActive]} 
            onPress={() => {
              setIsDanmakuEnabled(!isDanmakuEnabled);
              resetTimers();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
          >
            <MessageSquare color={isDanmakuEnabled ? "#F97316" : "#aaa"} size={20} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* 普通成员本地暂停时的【追赶房主】胶囊提示 */}
      {!isHost && memberLocalPause && roomState && (
        <View style={[styles.catchUpBanner, isFullscreen ? styles.catchUpBannerFullscreen : styles.catchUpBannerPortrait]}>
          <Text style={styles.catchUpText}>已临时本地暂停</Text>
          <TouchableOpacity style={styles.catchUpBtn} onPress={handleCatchUpHost} activeOpacity={0.7}>
            <FastForward size={14} color="#fff" style={{ marginRight: 4 }} />
            <Text style={styles.catchUpBtnText}>追赶房主</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 全屏控制 HUD: 底部控制条 */}
      {isFullscreen && (
        <Animated.View 
          pointerEvents={showControls ? 'box-none' : 'none'}
          style={[
            styles.fullscreenBottomBar,
            { opacity: hudOpacityAnim }
          ]}
        >
          <View style={styles.controlsRow}>
            {/* 播放/暂停 */}
            <TouchableOpacity 
              style={styles.playPauseBtn} 
              onPress={() => { handleTogglePlayPause(); resetTimers(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              {videoState.paused ? <Play color="#fff" size={22} fill="#fff" /> : <Pause color="#fff" size={22} fill="#fff" />}
            </TouchableOpacity>

            {/* 快退 10s */}
            <TouchableOpacity 
              style={styles.smallHudBtn} 
              onPress={() => { sendRemoteSeek(Math.max(0, videoState.currentTime - 10)); resetTimers(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <SkipBack color="#ccc" size={18} />
            </TouchableOpacity>

            {/* 当前时间 */}
            <Text style={styles.timeLabel}>{formatTime(displayTime)}</Text>

            {/* 进度条 */}
            <Slider
              style={styles.hudSlider}
              minimumValue={0}
              maximumValue={videoState.duration || 1}
              value={displayTime}
              minimumTrackTintColor="#F97316"
              maximumTrackTintColor="rgba(255,255,255,0.2)"
              thumbTintColor="#F97316"
              onValueChange={(val) => {
                setIsSliding(true);
                setSlideValue(val);
                if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
              }}
              onSlidingComplete={(val) => {
                setIsSliding(false);
                sendRemoteSeek(val);
                resetTimers();
              }}
            />

            {/* 总时长 */}
            <Text style={styles.durationLabel}>{formatTime(videoState.duration)}</Text>

            {/* 快进 10s */}
            <TouchableOpacity 
              style={styles.smallHudBtn} 
              onPress={() => { sendRemoteSeek(Math.min(videoState.duration || 9999, videoState.currentTime + 10)); resetTimers(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <SkipForward color="#ccc" size={18} />
            </TouchableOpacity>

            {/* 倍速切换按钮 */}
            <TouchableOpacity 
              style={[styles.rateBtn, showRateMenu && styles.rateBtnActive]} 
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
              onPress={() => {
                onToggleFullscreen();
              }}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              activeOpacity={0.6}
            >
              <RotateToPortraitIcon color="#fff" size={20} />
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
  fullscreenGestureLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 35,
    backgroundColor: 'transparent',
  },
  draggableLampContainer: {
    position: 'absolute',
    zIndex: 60,
  },
  lampFullscreenPos: {
    bottom: 90,
    right: 28,
  },
  lampPortraitPos: {
    bottom: 16,
    right: 16,
  },
  lampButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(24, 24, 28, 0.88)',
    borderRadius: 22,
    paddingHorizontal: 12,
    height: 44,
    minWidth: 44,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  lampButtonActive: {
    borderColor: '#F97316',
    backgroundColor: 'rgba(32, 24, 20, 0.95)',
  },
  lampTipText: {
    color: '#ddd',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  fullscreenTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'rgba(10, 10, 14, 0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 50,
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
  fullscreenBottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 16,
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(10, 10, 14, 0.85)',
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
    backgroundColor: 'rgba(249, 115, 22, 0.9)',
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
