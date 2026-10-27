// Native orchestration. Browser runtime/build/bridge map: ../webview/README.md.
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, AppState, Alert, Platform, BackHandler } from 'react-native';
import { WebView } from 'react-native-webview';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useRoomStore } from '../store/useRoomStore';
import { socketService } from '../services/socket';
import { mobileSyncCommand, type RealtimePlayback } from '../utils/playback-sync';
import { Lightbulb, FastForward } from 'lucide-react-native';
import { DanmakuOverlay } from './app/danmaku-overlay';
import { LandscapeDrawer } from './app/landscape-drawer';
import { usePlaybackScrub } from '../hooks/use-playback-scrub';
import { FullscreenGestureLayer } from './app/fullscreen-gesture-layer';
import { clampSeekTime, readPlayerControl } from '../utils/fullscreen-gesture';
import { useVoice } from '../services/voice-service';
import { formatTime } from '../utils/time';
import { generateLocalVideoPlayerHtml } from '../utils/local-player-html';
import { PC_USER_AGENT } from '../utils/browser-user-agent';
import { createWebPlayerScript } from '../utils/web-player-script';
import { siteRuleService } from '../services/site-rules';
import { PlayerTransitionNotice } from './app/player-transition-notice';
import { PlayerTransition, type LocalMedia, type PlayerMode } from '../utils/player-transition';

import { parsePageMessage } from '../webview/messages';
import { usePlayerHud } from './room-player/usePlayerHud';
import { PlayerHeader } from './room-player/PlayerHeader';
import { PlayerTransport } from './room-player/PlayerTransport';
import { styles } from './room-player/styles';
import { INJECTED_BEFORE_LOAD_SCRIPT, INJECTED_SCRIPT } from '../webview/generated/scripts';

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
  onSiteIcon?: (pageUrl: string, siteIcon: string) => void;
  onNavigationStateChange?: (canGoBack: boolean, canGoForward: boolean, currentUrl: string, title?: string) => void;
  onLampPress?: () => void;
  isPortraitPanelExpanded?: boolean;
  onVideoStateChange?: (state: { currentTime: number; duration: number; paused: boolean }) => void;
  onPlayerPresentationChange?: (state: PlayerPresentationState) => void;
  isHost?: boolean;
  isFollowingHost?: boolean;
  onShowToast?: (msg: string, options?: { type?: 'success' | 'info' | 'none' }) => void;
}


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
  { initialUrl, isFullscreen, onToggleFullscreen, onNavigationStateChange, onSiteIcon, onLampPress, isPortraitPanelExpanded, onVideoStateChange, onPlayerPresentationChange, isHost = true, isFollowingHost = true, onShowToast }: RoomWebViewProps,
  ref: React.ForwardedRef<RoomWebViewRef>
) => {
  const webviewRef = useRef<WebView>(null);
  const playerSession = useRef('player-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const playerDocument = useRef<string | null>(null);
  const [siteRuleRevision, setSiteRuleRevision] = useState(0);
  useEffect(() => siteRuleService.subscribe(() => setSiteRuleRevision(value => value + 1)), []);
  // Updating the prop supplies the next document's bootstrap. An installed page
  // script refuses replacement, so a cache refresh cannot change an active page.
  const playerScript = useMemo(() => createWebPlayerScript(playerSession.current, siteRuleService.pageScript()), [siteRuleRevision]);
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
  const [videoState, setVideoState] = useState<{ currentTime: number; duration: number; paused: boolean; control?: unknown }>({ currentTime: 0, duration: 0, paused: true });
  const videoStateRef = useRef(videoState);
  videoStateRef.current = videoState;
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
  const [recoveryLag, setRecoveryLag] = useState<number | null>(null);
  const currentPlaybackRate = useRoomStore(state => state.currentPlaybackRate);
  const setCurrentPlaybackRate = useRoomStore(state => state.setCurrentPlaybackRate);
  
  const roomState = useRoomStore(state => state.roomState);
  const playerControl = readPlayerControl(videoState.control);
  const scrub = usePlaybackScrub({ currentTime: videoState.currentTime, duration: videoState.duration, enabled: isHost && isFullscreen && !switchPhase,
    mediaKey: `${roomState?.id || ''}|${currentUrl}|${roomState?.playback.media?.id || ''}|${playerControl?.key || ''}`,
    onSeek: time => { sendRemoteSeek(time); resetTimers(); } });
  const isConnected = useRoomStore(state => state.isConnected);
  const memberLocalPause = useRoomStore(state => state.memberLocalPause);
  const memberMediaPending = useRoomStore(state => state.memberMediaPending);
  const setMemberLocalPause = useRoomStore(state => state.setMemberLocalPause);
  const lastRemotePlayerEvent = useRoomStore(state => state.lastRemotePlayerEvent);
  useEffect(() => { setRecoveryLag(null); }, [isHost, memberLocalPause, memberMediaPending, roomState?.id, roomState?.hostId, roomState?.playback.media?.id]);

  const { showControls, showRateMenu, setShowRateMenu, isLandscapeDrawerOpen, setIsLandscapeDrawerOpen,
    hudOpacityAnim, lampOpacityAnim, idleTimerRef, pan, isDraggingLamp, resetTimers, toggleControls, gestureActivity, lampPanResponder }
    = usePlayerHud({ isFullscreen, scrub, videoStateRef, onLampPress });
  const [isDanmakuEnabled, setIsDanmakuEnabled] = useState(true);
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
  const cancelHostEpisode = () => {
    episodeAttempt.current = '';
    episodeNavigation.current = '';
    webviewRef.current?.injectJavaScript('if(window.__yiqikanPlayer)window.__yiqikanPlayer.cancelFollowMedia?.(); true;');
  };
  const reflectTransition = () => {
    const phase = transition.current.pending?.phase || null;
    setSwitchPhase(phase);
    const state = useRoomStore.getState();
    state.setMemberMediaPending(!state.isHost && Boolean(phase));
  };
  const suspendOldPlayer = (pause = true) => {
    cancelHostEpisode();
    reflectTransition();
    webviewRef.current?.injectJavaScript(`window.__followSyncEnabled=false;if(window.__resetVideoSync)window.__resetVideoSync();if(window.__yiqikanPlayer){${pause ? 'window.__yiqikanPlayer.pauseAll();' : ''}window.__yiqikanPlayer.restore();} true;`);
    setIsFloatingPlayer(false);
    if (isFullscreen) onToggleFullscreen(false);
  };
  const restorePresentation = (mode: PlayerMode) => {
    cancelHostEpisode();
    reflectTransition();
    const state = useRoomStore.getState();
    webviewRef.current?.injectJavaScript(`window.__followSyncEnabled=${!state.isHost && !state.memberLocalPause && !state.memberMediaPending && Boolean(state.roomState) && AppState.currentState === 'active'};if(window.__yiqikanPlayer)window.__yiqikanPlayer.present(${JSON.stringify(mode)}); true;`);
    if (mode === 'fullscreen') onToggleFullscreen(true);
    if (!isHost) requestLatestPlayback();
  };
  const observeHostMedia = () => {
    const state = useRoomStore.getState(), room = state.roomState;
    if (state.isHost || !room) { cancelHostEpisode(); return; }
    if (!isFollowingHost || transition.current.host?.room !== `${room.id}|${room.hostId}`) cancelHostEpisode();
    const wasPending = Boolean(transition.current.pending);
    const priorMode = transition.current.pending?.mode || presentationMode();
    if (!transition.current.observe(`${room.id}|${room.hostId}`, room.playback.url || '', room.playback.media,
      isFollowingHost && !isLocalVideoMode, presentationMode(), localMedia.current)) {
      if (wasPending && !transition.current.pending) restorePresentation(priorMode);
      return;
    }
    suspendOldPlayer();
    const pending = transition.current.pending;
    if (pending && !pending.newDocument) attemptHostEpisode();
  };
  const startPageTransition = (event?: { nativeEvent?: { url?: string; isHistoryUpdate?: boolean } }) => {
    // Android also reports pushState/replaceState/back-forward history through
    // onLoadStart. Only a real main-document load invalidates its media.
    if (event?.nativeEvent?.isHistoryUpdate) return;
    cancelHostEpisode();
    if (isLocalVideoMode) return;
    if (!localMedia.current && !hasVideo && !transition.current.pending && presentationMode() === 'page') { setHasVideo(false); return; }
    transition.current.loading(presentationMode(), localMedia.current, event?.nativeEvent?.url);
    suspendOldPlayer();
    setHasVideo(false);
    webviewRef.current?.injectJavaScript('if(window.__yiqikanPlayer)window.__yiqikanPlayer.invalidateContext(); true;');
  };
  const attemptHostEpisode = () => {
    const pending = transition.current.pending;
    const state = useRoomStore.getState();
    if (state.isHost || !state.roomState || !isFollowingHost || isLocalVideoMode || AppState.currentState !== 'active'
      || transition.current.host?.room !== `${state.roomState.id}|${state.roomState.hostId}` || !playerDocument.current
      || pending?.phase !== 'loading' || !pending.media?.episode
      || (pending.newDocument && playerDocument.current === pending.documentId)) return;
    const key = `${pending.media.id}|${playerDocument.current}`;
    if (episodeAttempt.current === key) return;
    episodeAttempt.current = key;
    webviewRef.current?.injectJavaScript(`if(window.__yiqikanPlayer)window.__yiqikanPlayer.followMedia(${JSON.stringify(pending.media)}); true;`);
  };
  const failMediaTransition = () => {
    cancelHostEpisode();
    transition.current.fail();
    reflectTransition();
    if (isFullscreen) onToggleFullscreen(false);
  };
  const confirmMemberMedia = () => {
    if (isHost || useRoomStore.getState().isHost || isFollowingHost) return;
    if (!hasVideo || !localMedia.current?.ready) { onShowToast?.('请先在网页中打开对应视频'); return; }
    const mode = transition.current.confirm();
    setMemberLocalPause(false);
    restorePresentation(mode);
  };

  // Publish the role/navigation policy before an episode attempt in this render.
  // Returning from free browsing otherwise makes the WebView reject the attempt
  // under its previous permission, while native dedup prevents another attempt.
  useEffect(() => {
    if (canNavigate) cancelHostEpisode();
    webviewRef.current?.injectJavaScript(`
      window.__canNavigate = ${canNavigate};
      window.__isHost = ${isHost};
      if (typeof window.__updateHostRole === 'function') {
        window.__updateHostRole(${isHost});
      }
      true;
    `);
  }, [canNavigate, isHost]);

  useEffect(() => {
    observeHostMedia();
  }, [roomState?.id, roomState?.hostId, roomState?.playback.url, roomState?.playback.media?.id, isFollowingHost]);

  useEffect(() => {
    // A host SPA can finish decoding before its later navigation/load_url
    // clears room media. Ask the current document to publish readiness again.
    if (!isHost || !roomState?.playback.url || roomState.playback.media) return;
    hostMediaKey.current = '';
    webviewRef.current?.injectJavaScript('if(window.__yiqikanPlayer)window.__yiqikanPlayer.invalidateContext(); true;');
  }, [isHost, roomState?.playback.url, roomState?.playback.media?.id]);

  useEffect(() => {
    if (!isHost) return;
    cancelHostEpisode();
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

  useEffect(() => () => { cancelHostEpisode(); useRoomStore.getState().setMemberMediaPending(false); }, []);

  useEffect(() => {
    if (isConnected) lastHostReportRef.current = null; // Publish one live state after reconnect.
  }, [isConnected]);

  useEffect(() => {
    socketService.registerPlaybackGetter(() => {
      if (transition.current.pending || siteRuleService.privatePlaybackPage(actualUrlRef.current)) return Promise.resolve(null);
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
    if (scrub.seekFailed) {
      scrub.dismissSeekFailure();
      onShowToast?.('未能跳转，请重试');
    }
  }, [scrub.seekFailed, onShowToast]);

  // AppState 切后台与恢复
  const appState = useRef(AppState.currentState);
  const wasHostPlayingBeforeBackground = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState.match(/inactive|background/)) {
        cancelHostEpisode();
        webviewRef.current?.injectJavaScript('window.__followSyncEnabled = false; if(window.__resetVideoSync) window.__resetVideoSync(); true;');
      }
      // 1. 切入后台：若房主正在播放，自动暂停房间，防止切到后台时视频不同步或倒带
      if (appState.current === 'active' && nextAppState.match(/inactive|background/)) {
        const state = useRoomStore.getState();
        if (state.isHost && !transition.current.pending && !siteRuleService.privatePlaybackPage(actualUrlRef.current)
          && state.roomState?.id && !videoStateRef.current.paused) {
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
            attemptHostEpisode();
            socketService.requestPlaybackSync(state.roomState.id);
          }
        }
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [onShowToast, isFollowingHost, isLocalVideoMode]);

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
    setRecoveryLag(null);
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

    if (isHost && roomState && !siteRuleService.privatePlaybackPage(actualUrlRef.current)) {
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
    goBack: () => { cancelHostEpisode(); webviewRef.current?.goBack(); },
    goForward: () => { cancelHostEpisode(); webviewRef.current?.goForward(); },
    reload: () => { cancelHostEpisode(); webviewRef.current?.reload(); },
    stopLoading: () => { cancelHostEpisode(); webviewRef.current?.stopLoading(); },
    navigateTo: (url: string) => {
      if (!url) return;
      cancelHostEpisode();
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

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      let data = parsePageMessage(event.nativeEvent.data);
      if (!data) return;
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
      if (data.type === 'PAGE_SITE_ICON') {
        if (data.session === playerSession.current && typeof data.pageUrl === 'string' && typeof data.siteIcon === 'string' && data.siteIcon.length <= 12000) onSiteIcon?.(data.pageUrl, data.siteIcon);
        return;
      }
      if (data.type === 'SYNC_RECOVERY') {
        const state = useRoomStore.getState();
        if (state.isHost || state.memberLocalPause || state.memberMediaPending) return;
        setRecoveryLag(data.phase === 'limited' && typeof data.gap === 'number' && Number.isFinite(data.gap) ? Math.max(0, data.gap) : null);
        return;
      }
      if (data.type === 'MEDIA_CONTEXT') {
        if (isLocalVideoMode || typeof data.key !== 'string') return;
        const state = useRoomStore.getState();
        if (isHost && data.privatePage) {
          const shareUrl = data.ready && siteRuleService.publicPlaybackUrl(actualUrlRef.current, data.shareUrl);
          if (shareUrl && currentUrl !== shareUrl) {
            setCurrentUrl(shareUrl);
            onNavigationStateChange?.(false, false, shareUrl, data.title);
          }
          return;
        }
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
        // Solo playback owns its player too; the room store intentionally has
        // isHost=false when no room exists. Use the effective component role.
        const mode = transition.current.ready(media, isHost);
        if (mode !== null) restorePresentation(mode);
        else { attemptHostEpisode(); if (!isHost) requestLatestPlayback(); }
        return;
      }
      if (data.type === 'PLAYER_EPISODE_NAVIGATION') {
        if (transition.current.pending?.phase === 'loading' && typeof data.url === 'string') episodeNavigation.current = data.url;
        return;
      }
      if (data.type === 'TOUCH_INTERACT') {
        // Legacy frame scripts may still send this. Floating controls own their
        // DOM click toggle; native touch wakeups race it on Android and hide
        // the controls again as soon as the finger is released.
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
        // A new source can report ready before the old selection expires.
        // Re-request after invalidation so reportMedia's dedup cannot strand us.
        if (data.type === 'PLAYER_EXPIRED' || data.reason === 'navigation') {
          webviewRef.current?.injectJavaScript('if(window.__yiqikanPlayer)window.__yiqikanPlayer.invalidateContext(); true;');
        }
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
          const mode = transition.current.ready(media, isHost);
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
          duration: data.payload.duration ?? videoStateRef.current.duration,
          paused: data.payload.paused,
          control: data.payload.control,
        });

        if (data.payload.videoTitle) {
          setVideoTitle(data.payload.videoTitle);
        }
        
        const storeState = useRoomStore.getState();
        const payload = data.payload;
        // Web controls and the native full-screen HUD share the host/solo rate.
        // Follower correction rates are temporary, not a new baseline.
        if (isHost && typeof payload.playbackRate === 'number' && Number.isFinite(payload.playbackRate) && payload.playbackRate > 0) {
          setCurrentPlaybackRate(payload.playbackRate);
        }
        const buffering = Boolean(payload.buffering || payload.seeking);
        const memberBuffering = Boolean(payload.buffering);
        if (!storeState.isHost && wasBufferingRef.current && !memberBuffering) requestLatestPlayback(false);
        wasBufferingRef.current = memberBuffering;
        if (!storeState.isHost && storeState.memberMediaPending && !payload.paused) applyLocalPause();
        if (storeState.isHost && !payload.seeking && !transition.current.pending && !siteRuleService.privatePlaybackPage(actualUrlRef.current)
          && storeState.roomState && storeState.isConnected !== false) {
          const eventName = payload.eventName;
          const effectivePaused = Boolean(payload.paused || buffering || payload.ended);
          const rate = typeof payload.playbackRate === 'number' && Number.isFinite(payload.playbackRate) && payload.playbackRate > 0 ? payload.playbackRate : currentPlaybackRate;
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
          pending.resolve(p && !siteRuleService.privatePlaybackPage(actualUrlRef.current) && Number.isFinite(p.currentTime) && Number.isFinite(p.playbackRate)
            ? { ...p, currentTime: p.currentTime!, playbackRate: p.playbackRate!, paused: p.paused ?? true, duration: p.duration ?? 0, sampledAt: p.sampledAt ?? Date.now() } : null);
        }
        if (data.payload) {
          if (isHost && typeof data.payload.playbackRate === 'number' && Number.isFinite(data.payload.playbackRate) && data.payload.playbackRate > 0) {
            setCurrentPlaybackRate(data.payload.playbackRate);
          }
          setVideoState(prev => ({
            ...prev,
            currentTime: typeof data.payload!.currentTime === 'number' ? data.payload!.currentTime : prev.currentTime,
            duration: typeof data.payload!.duration === 'number' ? data.payload!.duration : prev.duration,
            paused: typeof data.payload!.paused === 'boolean' ? data.payload!.paused : prev.paused,
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
    if (transition.current.pending || siteRuleService.privatePlaybackPage(actualUrlRef.current)) return;
    webviewRef.current?.injectJavaScript(`if(window.__syncCmd) window.__syncCmd({ paused: ${paused}, playbackRate: ${currentPlaybackRate} }); true;`);
    setVideoState(prev => ({ ...prev, paused }));
    socketService.publishCurrentPlayback(paused ? 'pause' : 'play');
  };

  const sendRemoteSeek = (time: number, controlKey?: string) => {
    if (!isHost || transition.current.pending || siteRuleService.privatePlaybackPage(actualUrlRef.current)) return;
    if (controlKey) {
      webviewRef.current?.injectJavaScript(`if(window.__syncCmd)window.__syncCmd(${JSON.stringify({ currentTime: time, paused: videoState.paused,
        playbackRate: currentPlaybackRate, controlKey })});true;`);
    } else applyLocalSync(videoState.paused, time, currentPlaybackRate);
    // The player's completed seek is the only authoritative room broadcast.
  };

  const commitGestureSeek = (time: number) => {
    // Room role can change before React has rendered the new props.
    const state = useRoomStore.getState();
    if ((state.roomState && !state.isHost) || !isHost || !isFullscreen || transition.current.pending || !playerControl?.ready) { scrub.cancel(); return; }
    const target = clampSeekTime(time, playerControl.ranges);
    if (target === null) { scrub.cancel(); return; }
    // The bridge rechecks the key/ranges in the actual selected child document.
    sendRemoteSeek(target, playerControl.key);
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

  const exitFullscreen = () => {
    if (transition.current.pending) transition.current.pending.mode = isFloatingPlayer ? 'floating' : 'page';
    onToggleFullscreen(false);
  };

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
          // The added Android document-start signal is for invalidation only.
          // Publish URL/history at commit (the history notification) or finish,
          // as before; a provisional/cancelled load must not change the room URL.
          if (Platform.OS === 'android' && navState.isHistoryUpdate === false) return;
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

      {isFullscreen && hasVideo && playerControl && (
        <FullscreenGestureLayer
          enabled={playerControl.ready && !switchPhase && !showRateMenu && !isLandscapeDrawerOpen}
          contextKey={`${roomState?.id || ''}|${roomState?.hostId || ''}|${currentUrl}|${playerDocument.current}|${localMedia.current?.key || ''}|${playerControl.key}|${isHost}`}
          isHost={isHost} canSeek={scrub.canSeek && playerControl.ranges.length > 0}
          currentTime={displayTime} duration={videoState.duration} ranges={playerControl.ranges} isSeeking={scrub.isSeeking}
          onBeginSeek={scrub.beginSurface} onPreviewSeek={scrub.previewSurface}
          onCommitSeek={time => scrub.onSlidingComplete(time, commitGestureSeek)} onCancelSeek={scrub.cancel}
          onTap={toggleControls} onActivity={gestureActivity}
        />
      )}

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
        <PlayerHeader {...{ showControls, hudOpacityAnim, videoTitle, roomState, voiceStatus, isMuted, stats,
          toggleMute, resetTimers, isDanmakuEnabled, setIsDanmakuEnabled, isLandscapeDrawerOpen, setIsLandscapeDrawerOpen }}
          onExitFullscreen={exitFullscreen} />
      )}

      {/* 普通成员本地暂停时的【追赶房主】胶囊提示 */}
      {!isHost && (memberLocalPause || recoveryLag !== null) && !switchPhase && roomState && (
        <View style={[styles.catchUpBanner, isFullscreen ? styles.catchUpBannerFullscreen : styles.catchUpBannerPortrait]}>
          <Text style={styles.catchUpText}>{memberLocalPause ? '已临时本地暂停' : `仍落后约 ${Math.ceil(recoveryLag || 0)} 秒`}</Text>
          <TouchableOpacity testID="player-catch-up" style={styles.catchUpBtn} onPress={handleCatchUpHost} activeOpacity={0.7}>
            <FastForward size={14} color="#fff" style={{ marginRight: 4 }} />
            <Text style={styles.catchUpBtnText}>追赶房主</Text>
          </TouchableOpacity>
        </View>
      )}

      {switchPhase && <PlayerTransitionNotice phase={switchPhase} isHost={isHost} isFollowingHost={isFollowingHost} episodeLabel={roomState?.playback.media?.episode?.label} onConfirm={confirmMemberMedia} />}

      {/* 全屏控制 HUD: 底部控制条 */}
      {isFullscreen && hasVideo && (
        <PlayerTransport {...{ showControls, hudOpacityAnim, videoState, handleTogglePlayPause, resetTimers,
          scrub, displayTime, showHours, idleTimerRef, isHost, showRateMenu, setShowRateMenu, currentPlaybackRate,
          handleSelectPlaybackRate }} onExitFullscreen={exitFullscreen} />
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

export default RoomWebView;
