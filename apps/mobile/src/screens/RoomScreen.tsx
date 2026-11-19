import { APP_ACCENT, APP_BACKGROUND, appControlColors as colors } from '../theme/colors';
import { getRoomEntryName } from '../services/account-auth';
import { siteRuleService } from '../services/site-rules';
import { SITE_ENTRY_TRIAL_TIMEOUT_MS, type SiteEntryTrial } from '../webview/site-entry-trial';
import type { CardEntryRule } from '@yiqikan/shared/site-entry';
import { useAndroidBackNavigation } from '../hooks/use-android-back-navigation';
import { useHomeConfig } from '../hooks/use-home-config';
import { useHomeRoomGuide } from '../hooks/use-home-room-guide';
import { useWatchActivity } from '../hooks/use-watch-activity';
import { usePlayerFullscreen } from '../hooks/use-player-fullscreen';
import { parseRoomInvitation, roomInvite } from '../services/room-invite';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Animated, Text, TouchableOpacity, Image, Keyboard, Platform, Linking, AppState, KeyboardAvoidingView, BackHandler } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { User, Users, PlusCircle, LogIn, ChevronRight, BookmarkCheck, CheckCircle2 } from 'lucide-react-native';
import { RootStackParamList } from '../navigation/AppNavigator';
import RoomWebView, { RoomWebViewRef, PlayerPresentationState, type WatchlistLaunch } from '../components/RoomWebView';
import { useRoomStore } from '../store/useRoomStore';
import { socketService } from '../services/socket';
import { showConfirm } from '../store/useDialogStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BrowserToolbar } from '../components/app/browser-toolbar';
import { SafetySheet } from '../components/app/safety-sheet';
import { EmptyState } from '../components/app/empty-state';
import { APP_TAB_BAR_HEIGHT, AppTabBar } from '../components/app/app-tab-bar';
import { AppActionRow, AppActionSheet, AppButton } from '../components/app/app-ui';
import { RoomGuideHint } from '../components/app/room-guide-hint';
import { ModuleShell, AppTab } from '../components/app/module-shell';
import { RoomModule } from '../components/app/room-module';
import { ChatPanel } from '../components/app/chat-panel';
import { ChatComposerHost } from '../components/app/chat-composer-layer';
import { WATCH_CAPSULE_BOTTOM_INSET, WATCH_CAPSULE_HEIGHT, WatchSessionControls } from '../components/app/watch-session-controls';
import { CompactPlaybackControls } from '../components/app/compact-playback-controls';
import { PlaybackHistoryPanel } from '../components/app/playback-history-panel';
import { WatchlistPanel, WatchlistPicker } from '../components/app/watchlist-panel';
import { WatchlistSelectionBar } from '../components/app/watchlist-ui';
import { hasWatchlistProgressTarget, loadWatchlists, nextWatchlistItem, recentWatchlist, recordWatchlistProgress,
  rememberWatchlist, removeWatchlistItem, saveWatchlistItem, useWatchlists, watchlistOpenUrl, type Watchlist, type WatchlistItem } from '../services/watchlists';
import { isWatchlistLinkForMedia, sameWatchlistMedia, watchlistUrl, type WatchlistSample } from '../utils/watchlist-media';
import { getUnreadChatCount } from '../utils/chat-unread';
import { ProfileModal } from '../components/app/profile-modal';
import { ConfirmDialog } from '../components/app/confirm-dialog';
import { LAST_ROOM_ID_CACHE_KEY, LAST_ROOM_PASSWORD_CACHE_KEY } from '../components/app/members-panel';
import { ForceUpdateOverlay } from '../components/app/force-update-overlay';
import { useVoice } from '../services/voice-service';
import { otaService } from '../services/ota-service';
import { mobileTelemetry } from '../services/telemetry';
import { automaticUpdates, registerUpdateHome } from '../services/automatic-updates';
import { resolveWebUrl } from '../services/environment';
import { formatTime } from '../utils/time';
import { 
  getLatestPlayback, 
  getPlaybackProgress, 
  savePlaybackProgress, 
  cleanHistoryTitle,
  resolvePlaybackHistoryTitle,
  flushPlaybackProgress,
  PlaybackHistoryItem 
} from '../services/playback-history';
import { ResumePlaybackPill } from '../components/app/resume-playback-pill';


type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;


function RoomScreenContent({ route, navigation }: Props) {
  const roomState = useRoomStore((state) => state.roomState);
  const roomConnected = useRoomStore((state) => state.isConnected);
  const savedRoomPassword = useRoomStore((state) => state.savedPassword);
  const roomId = roomState?.id || '';
  const { leaveVoice, voiceStatus } = useVoice();
  const voiceAttempt = useRef<number | null>(null);
  useEffect(() => {
    if (voiceStatus === 'connecting' && voiceAttempt.current === null) {
      voiceAttempt.current = Date.now();
      void mobileTelemetry.track('voice:result', { outcome: 'request' });
    } else if (voiceAttempt.current !== null && ['connected', 'error', 'idle'].includes(voiceStatus)) {
      void mobileTelemetry.track('voice:result', { outcome: voiceStatus === 'connected' ? 'success' : voiceStatus === 'error' ? 'failure' : 'cancelled',
        elapsedMs: Date.now() - voiceAttempt.current });
      voiceAttempt.current = null;
    }
  }, [voiceStatus]);
  
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);
  const [watchDockHeight, setWatchDockHeight] = useState(0);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const clipboardReadRef = useRef({ busy: false, denied: false, lastRead: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [urlInputValue, setUrlInputValue] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [androidPip, setAndroidPip] = useState(false);
  const videoFillsScreen = isFullscreen || androidPip;
  usePlayerFullscreen(isFullscreen);
  const [chatInput, setChatInput] = useState('');
  const [chatSendError, setChatSendError] = useState<string | null>(null);
  const chatSendingRef = useRef(false);
  const [videoState, setVideoState] = useState({ currentTime: 0, duration: 0, paused: true });
  const [roomEntryRequest, setRoomEntryRequest] = useState<{ mode: 'create' | 'join'; id: number }>();
  const roomEntryRequestIdRef = useRef(0);
  const [roomChoicesOpen, setRoomChoicesOpen] = useState(false);
  const entryAfterDismiss = useRef<'create' | 'join' | undefined>(undefined);
  const manualRoomEntryOpen = useRef(false);
  manualRoomEntryOpen.current = roomChoicesOpen || !!roomEntryRequest;
  const { step: roomGuideStep, finishEntry, finishInvite } = useHomeRoomGuide();
  const [activeAppTab, setActiveAppTab] = useState<AppTab>('watch');
  const [hasVisitedProfile, setHasVisitedProfile] = useState(false);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [watchlistPage, setWatchlistPage] = useState<{ listId?: string } | null>(null);
  const [watchlistSelection, setWatchlistSelection] = useState<{ listId: string } | null>(null);
  const watchlistSelectionRef = useRef(watchlistSelection);
  const [savingSelection, setSavingSelection] = useState(false);
  const [watchlistPicker, setWatchlistPicker] = useState<WatchlistSample | null>(null);
  const [watchlistSource, setWatchlistSource] = useState<WatchlistSample | null>(null);
  const [watchlistLaunch, setWatchlistLaunch] = useState<WatchlistLaunch | null>(null);
  const selectedWatchlistItem = useRef<WatchlistItem | null>(null);
  const savingBookmark = useRef(false);
  const lastWatchlistSample = useRef<{ sample: WatchlistSample; recordedAt: number } | null>(null);
  const watchlistBackHandler = useRef<(() => void) | null>(null);
  const registerWatchlistBack = React.useCallback((handler: (() => void) | null) => { watchlistBackHandler.current = handler; }, []);
  const { data: watchlistData, status: watchlistStatus } = useWatchlists();
  const defaultWatchlist = recentWatchlist(watchlistData);
  const selectionList = watchlistSelection && watchlistData.lists.find(list => list.id === watchlistSelection.listId);
  const nextSavedVideo = watchlistStatus === 'ready' ? nextWatchlistItem(defaultWatchlist) : undefined;
  useEffect(() => { void loadWatchlists(); }, []);
  const [isQuickChatOpen, setIsQuickChatOpen] = useState(false);
  const chatSelectionBackHandler = useRef<(() => boolean) | null>(null);
  const registerChatSelectionBack = React.useCallback((handler: (() => boolean) | null) => {
    chatSelectionBackHandler.current = handler;
  }, []);
  const profileBackHandler = useRef<(() => boolean) | null>(null);
  const registerProfileBackHandler = React.useCallback((handler: (() => boolean) | null) => {
    profileBackHandler.current = handler;
  }, []);
  const [playerPresentation, setPlayerPresentation] = useState<PlayerPresentationState>({ hasVideo: false, mode: 'page' });
  const [chatReadMark, setChatReadMark] = useState<{ roomId: string; id: string | null }>({ roomId: '', id: null });
  const [forceUpdateInfo, setForceUpdateInfo] = useState<{ releaseNotes: string; downloadUrl: string } | null>(null);

  // 软键盘状态
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const editingAddress = isAddressFocused && activeAppTab === 'watch' && !isFullscreen && !isQuickChatOpen;
  const quickChatVisible = isQuickChatOpen && activeAppTab === 'watch' && !isFullscreen;
  
  const webviewRef = useRef<RoomWebViewRef>(null);
  const isResettingUrlRef = useRef(false);
  const videoStateRef = useRef(videoState);
  const currentUrlRef = useRef('');
  const browserCanGoBackRef = useRef(false);
  const currentHistoryItemRef = useRef<PlaybackHistoryItem | null>(null);
  const pageMetadataRef = useRef<{ url: string; title?: string; siteIcon?: string }>({ url: '' });
  const getPlaybackTitle = (url: string) => resolvePlaybackHistoryTitle(url, pageMetadataRef.current, currentHistoryItemRef.current);
  
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const myUserId = socketService.getUserId();
  const unreadCount = roomId && chatReadMark.roomId === roomId ? getUnreadChatCount(chatMessages, chatReadMark.id, myUserId) : 0;
  const markMessagesRead = React.useCallback((id: string) => {
    setChatReadMark(mark => mark.roomId === roomId && mark.id === id ? mark : { roomId, id });
  }, [roomId]);
  const changeWatchlistSelection = (selection: typeof watchlistSelection) => {
    watchlistSelectionRef.current = selection;
    setWatchlistSelection(selection);
  };
  const selectAppTab = (tab: AppTab) => {
    automaticUpdates.interaction();
    if (tab !== activeAppTab) void mobileTelemetry.track('app:entry', { action: tab });
    Keyboard.dismiss();
    setIsAddressFocused(false);
    setIsQuickChatOpen(false);
    if (tab !== 'watch') {
      setWatchlistLaunch(null);
      changeWatchlistSelection(null);
    }
    if (tab === 'room') finishEntry();
    if (tab === 'profile') setHasVisitedProfile(true);
    setActiveAppTab(tab);
  };
  useEffect(() => {
    setChatReadMark({ roomId, id: chatMessages[chatMessages.length - 1]?.id || null });
    setChatInput('');
    setChatSendError(null);
    setIsQuickChatOpen(false);
  }, [roomId]);
  const isHost = useRoomStore((state) => state.isHost);
  const [soloUrl, setSoloUrl] = useState('');
  const [isFollowingHost, setIsFollowingHost] = useState(true);
  const [browserHint, setBrowserHint] = useState<'address' | 'link' | null>(null);
  const [memberCustomUrl, setMemberCustomUrl] = useState('');
  const roomUrl = roomState?.playback?.url || '';
  const roomNavigationKey = isHost && roomState ? `${roomState.id}|${roomState.instanceId ?? ''}|${roomState.hostId}` : '';
  const [localRoomPage, setLocalRoomPage] = useState<{
    roomKey: string; url: string; trial?: SiteEntryTrial & { fallbackUrl: string };
  } | null>(null);
  const activeLocalRoomPage = localRoomPage?.roomKey === roomNavigationKey ? localRoomPage : null;
  const entryTrialSequence = useRef(0);
  const completedEntryTrial = useRef({ id: 0, ready: false });
  const entryTrial = activeLocalRoomPage?.trial;
  const activeEntryTrial = entryTrial && entryTrial.id > completedEntryTrial.current.id ? entryTrial : undefined;
  const pendingRoomPage = useRef<{ page: typeof localRoomPage; url: string } | null>(null);
  useEffect(() => {
    if (localRoomPage && (!activeLocalRoomPage ||
      (pendingRoomPage.current?.page === localRoomPage && pendingRoomPage.current.url === roomUrl))) {
      pendingRoomPage.current = null;
      setLocalRoomPage(null);
    }
  }, [localRoomPage, activeLocalRoomPage, roomUrl]);
  const effectiveMemberUrl = isFollowingHost ? roomUrl : memberCustomUrl;
  // Creating a room carries solo playback asynchronously. Keep its document
  // alive while the initial room snapshot still has an empty playback URL.
  const currentUrl = roomId ? (isHost ? activeLocalRoomPage?.url || roomUrl || soloUrl : effectiveMemberUrl) : soloUrl;
  const effectiveIsHost = !roomId ? true : isHost;
  const canBrowseOwnPages = Boolean(roomId && !isHost && !isFollowingHost);
  const retryHostVideo = playerPresentation.sourceRecoveryMediaId && playerPresentation.sourceRecoveryMediaId === roomState?.playback.media?.id
    ? () => webviewRef.current?.retryMediaTransition() : undefined;
  useEffect(() => { setBrowserHint(null); }, [roomId, currentUrl, isFollowingHost, isHost, isFullscreen, activeAppTab]);
  const [recentUrl, setRecentUrl] = useState('');
  const [lastPlayback, setLastPlayback] = useState<PlaybackHistoryItem | null>(null);
  const [currentHistoryItem, setCurrentHistoryItem] = useState<PlaybackHistoryItem | null>(null);
  const playbackTitle = currentUrl ? getPlaybackTitle(currentUrl) : undefined;
  const displayPlaybackTitle = playbackTitle === cleanHistoryTitle(undefined, currentUrl) ? undefined : playbackTitle;
  const savedMedia = watchlistSource && watchlistSource.location.url === watchlistUrl(currentUrl) ? watchlistSource.location : null;
  const isBookmarked = Boolean(savedMedia && watchlistData.lists.some(list => list.items.some(item =>
    sameWatchlistMedia(item, savedMedia) || isWatchlistLinkForMedia(item, savedMedia))));
  const [showResumePill, setShowResumePill] = useState(false);
  const [targetResumeTime, setTargetResumeTime] = useState(0);
  const [targetResumePercent, setTargetResumePercent] = useState(0);
  
  const [confirmDialogConfig, setConfirmDialogConfig] = useState<{
    visible: boolean;
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
    icon?: 'alert' | 'logout' | 'info';
    clipboardInvite?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    visible: false,
    title: '',
    onConfirm: () => {},
  });

  type ToastAction = { label: string; run: () => void };
  const [toastConfig, setToastConfig] = useState<{ message: string; type: 'success' | 'info' | 'none'; actions?: ToastAction[] } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, options?: { type?: 'success' | 'info' | 'none'; actions?: ToastAction[] }) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastOpacity.stopAnimation();
    if (!msg) {
      setToastConfig(null);
      return;
    }
    const type = options?.type ?? 'success';
    const actionable = Boolean(options?.actions?.length);
    setToastConfig({ message: msg, type, actions: options?.actions });
    Animated.timing(toastOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    toastTimeoutRef.current = setTimeout(() => {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: actionable ? 160 : 300,
        useNativeDriver: true,
      }).start(({ finished }) => { if (finished) setToastConfig(null); });
    }, actionable ? 3200 : 3000);
  };

  const hasWatchUpdate = useWatchActivity(roomState, isHost, activeAppTab, message => showToast(message, { type: 'info' }));

  // 全局响应跨组件轻量 Tip 派发
  const storeToastMessage = useRoomStore(s => s.toastMessage);
  useEffect(() => {
    if (storeToastMessage) {
      showToast(storeToastMessage);
      useRoomStore.getState().showToast('');
    }
  }, [storeToastMessage]);

  // 1. 初始化加载最近播放记录与历史
  useEffect(() => {
    getLatestPlayback().then((item) => {
      if (item) {
        setLastPlayback(item);
        setRecentUrl(item.url);
      } else {
        AsyncStorage.getItem('@recent_url').then(url => {
          if (url) setRecentUrl(url);
        }).catch(() => {});
      }
    }).catch(e => console.log('Failed to load playback history', e));
  }, []);

  // 2. 监听当前 URL 变更，匹配断点记忆并唤起续播提醒
  useEffect(() => {
    currentUrlRef.current = currentUrl;
    let stale = false;
    if (currentUrl && !currentUrl.startsWith('about:blank')) {
      AsyncStorage.setItem('@recent_url', currentUrl).catch(() => {});
      getPlaybackProgress(currentUrl).then((item) => {
        if (stale || selectedWatchlistItem.current) return;
        if (item && item.currentTime >= 10 && !item.isFinished) {
          setCurrentHistoryItem(item);
          currentHistoryItemRef.current = item;
          setTargetResumeTime(item.currentTime);
          setTargetResumePercent(item.progressPercent);
          setShowResumePill(true);
        } else {
          setCurrentHistoryItem(null);
          currentHistoryItemRef.current = null;
          setShowResumePill(false);
        }
      }).catch(() => {
        if (stale) return;
        setCurrentHistoryItem(null);
        currentHistoryItemRef.current = null;
        setShowResumePill(false);
      });
    } else {
      setCurrentHistoryItem(null);
      currentHistoryItemRef.current = null;
      setShowResumePill(false);
      // 返回大厅时刷新最新记录
      getLatestPlayback().then((item) => {
        if (item) {
          setLastPlayback(item);
          setRecentUrl(item.url);
        }
      }).catch(() => {});
    }
    return () => { stale = true; };
  }, [currentUrl]);

  // Browser navigation is independent of module navigation and playback controls.
  // A URL alone is not evidence of a playable video.
  useEffect(() => { setIsPanelCollapsed(true); }, [currentUrl]);

  // 屏蔽、被移出等退出路径也恢复首页入口，避免停在创建表单。
  const previousRoomId = useRef(roomId);
  useEffect(() => {
    if (roomId) setRoomEntryRequest(undefined);
    if (previousRoomId.current && !roomId) {
      Keyboard.dismiss();
      setIsPanelCollapsed(true);
      if (!currentUrl) setActiveAppTab('room');
    }
    previousRoomId.current = roomId;
  }, [roomId, currentUrl]);

  // 保持记录房间播放地址，以便离开房间或房间解散时平滑保留在当前页面继续看
  useEffect(() => {
    if (roomState?.playback?.url) {
      setSoloUrl(roomState.playback.url);
    }
  }, [roomState?.playback?.url]);

  // 成员在跟随模式下，房主切换 URL 时自动同步输入框显示
  useEffect(() => {
    if (roomId && !isHost && isFollowingHost && roomUrl) {
      setUrlInputValue(roomUrl);
    }
  }, [roomId, isHost, isFollowingHost, roomUrl]);

  // 离开房间或房间重置时，恢复跟随模式与重置自定义 URL
  useEffect(() => {
    if (!roomId) {
      setIsFollowingHost(true);
      setMemberCustomUrl('');
    }
  }, [roomId]);

  // 从单人播放模式新建房间时，自动将单人播放地址带入新房间
  useEffect(() => {
    if (roomId && isHost && soloUrl && !activeLocalRoomPage && !roomUrl
      && !siteRuleService.localRoomNavigation(soloUrl) && !siteRuleService.privatePlaybackPage(soloUrl)) {
      socketService.sendPlayerEvent({
        roomId,
        actorId: socketService.getUserId(),
        action: 'load_url',
        url: soloUrl,
      });
    }
  }, [roomId, isHost, soloUrl, activeLocalRoomPage, roomUrl]);

  // Connect socket on mount
  useEffect(() => {
    socketService.setRoomEntryObserver(event => mobileTelemetry.observeRoomEntry(event), () => mobileTelemetry.measurementEnabled());
    void socketService.connect().catch(error => socketService.reportConnectionError(error));
    return () => socketService.setRoomEntryObserver(null);
  }, []);

  useEffect(() => {
    mobileTelemetry.setRoomState(Boolean(roomId), roomId || null, roomState?.members.length || 0, isHost);
  }, [roomId, roomState?.hasPassword, roomState?.members.length, isHost]);

  useEffect(() => {
    if (!roomId) return;
    finishEntry();
    setClipboardUrl(null);
    setConfirmDialogConfig(dialog => dialog.clipboardInvite && dialog.visible ? { ...dialog, visible: false } : dialog);
  }, [roomId]);

  useEffect(() => {
    if (!roomId || (roomState?.hasPassword !== false && !savedRoomPassword)) return;
    const password = roomState?.hasPassword === false ? '' : savedRoomPassword;
    void AsyncStorage.multiSet([[LAST_ROOM_ID_CACHE_KEY, roomId], [LAST_ROOM_PASSWORD_CACHE_KEY, password]]).catch(() => {});
  }, [roomId, roomState?.hasPassword, savedRoomPassword]);

  // 深度链接（Deep Link）与剪贴板邀请口令监听
  const lastCheckedTokenRef = useRef<string>('');
  const initialLinkResolved = useRef(false);
  const [initialLinkStatus, setInitialLinkStatus] = useState<'pending' | 'ready' | 'invite'>('pending');

  const handleDeepLinkUrl = async (rawUrl: string | null) => {
    if (!rawUrl) return;
    automaticUpdates.interaction();
    const parsed = parseRoomInvitation(rawUrl);
    if (!parsed) return;
    setInitialLinkStatus('invite');
    entryAfterDismiss.current = undefined;
    setRoomChoicesOpen(false);
    const { roomId: targetRoomId, password: targetPassword } = parsed;

    if (useRoomStore.getState().roomState?.id === targetRoomId) {
      return;
    }

    const storedName = await getRoomEntryName();
    showToast(`正在通过专属链接加入房间: ${targetRoomId}`);
    void mobileTelemetry.track('invite:action', { source: 'deep_link', action: 'open' });
    socketService.joinRoom(storedName, targetRoomId, targetPassword, 'deep_link');
  };

  const checkClipboardForRoomInvite = async () => {
    const read = clipboardReadRef.current;
    const entryInProgress = () => manualRoomEntryOpen.current || !!entryAfterDismiss.current ||
      !!useRoomStore.getState().roomState || socketService.hasRoomActivity();
    if (entryInProgress() || read.busy || read.denied || Date.now() - read.lastRead < 2000) return;
    read.busy = true;
    read.lastRead = Date.now();
    try {
      const hasString = await Clipboard.hasStringAsync();
      if (!hasString || entryInProgress()) return;

      const content = await Clipboard.getStringAsync();
      if (entryInProgress()) return;
      if (!content) { read.denied = true; return; }
      if (content === lastCheckedTokenRef.current) return;

      const parsed = parseRoomInvitation(content);
      if (!parsed) {
        const text = content.trim();
        setClipboardUrl(/^https?:\/\/\S+$/i.test(text) ? text : null);
        return;
      }
      setClipboardUrl(null);

      automaticUpdates.interaction();
      lastCheckedTokenRef.current = content;

      void mobileTelemetry.track('invite:action', { source: 'clipboard', action: 'open' });

      setConfirmDialogConfig({
        visible: true,
        title: '发现房间邀请',
        message: `检测到好友邀请口令，是否立即加入放映房间「${parsed.roomId}」？`,
        confirmText: '立即加入',
        cancelText: '忽略',
        type: 'info',
        icon: 'info',
        clipboardInvite: true,
        onConfirm: async () => {
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
          const storedName = await getRoomEntryName();
          if (useRoomStore.getState().roomState) return;
          void mobileTelemetry.track('invite:action', { source: 'clipboard', action: 'accept' });
          socketService.joinRoom(storedName, parsed.roomId, parsed.password, 'clipboard');
          showToast(`正在加入房间: ${parsed.roomId}`);
        },
      });
    } catch {
      // A denied automatic read is not retried during this app session; manual paste stays available.
      read.denied = true;
    } finally { read.busy = false; }
  };

  useEffect(() => {
    // 1. 处理启动时的 Deep Link
    void Linking.getInitialURL().then(handleDeepLinkUrl).catch(error => socketService.reportConnectionError(error))
      .finally(() => {
        initialLinkResolved.current = true;
        setInitialLinkStatus(status => status === 'pending' ? 'ready' : status);
        automaticUpdates.safetyChanged();
      });

    const linkSub = Linking.addEventListener('url', (e) => {
      if (e.url) void handleDeepLinkUrl(e.url).catch(error => socketService.reportConnectionError(error));
    });

    // 2. 延迟检查剪贴板口令（等 Socket 与界面初始化完成）
    const clipTimer = setTimeout(() => {
      checkClipboardForRoomInvite();
    }, 1000);

    // 3. 监听 AppState（切后台与切回前台事件）
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState.match(/inactive|background/)) {
        flushWatchlistProgress();
        // 用户按 Home 键返回桌面、上滑进多任务或锁屏时，立即强行将当前播放进度刷入磁盘
        const curUrl = currentUrlRef.current;
        const curVideo = videoStateRef.current;
        if (curUrl && !curUrl.startsWith('about:blank') && curVideo.currentTime >= 5) {
          savePlaybackProgress({
            url: curUrl,
            currentTime: curVideo.currentTime,
            duration: curVideo.duration,
            title: getPlaybackTitle(curUrl),
            siteIcon: pageMetadataRef.current.url === curUrl ? pageMetadataRef.current.siteIcon : undefined,
          }, true);
        } else {
          flushPlaybackProgress();
        }
      } else if (nextState === 'active') {
        void socketService.recoverRoom().catch(error => socketService.reportConnectionError(error));
        checkClipboardForRoomInvite();
      }
    });

    return () => {
      linkSub.remove();
      clearTimeout(clipTimer);
      appStateSub.remove();
      flushPlaybackProgress();
    };
  }, []);

  // 监听软键盘弹出与隐藏
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (currentUrl && !urlInputValue) {
      setUrlInputValue(currentUrl);
    }
  }, [currentUrl]);

  const homeConfig = useHomeConfig(!currentUrl && activeAppTab === 'watch');
  const { searchTemplate } = homeConfig;

  const formatInputToUrl = (input: string) => {
    const trimmed = input.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    if (trimmed.startsWith('yiqikan://') || trimmed.startsWith('local://')) {
      return trimmed;
    }
    if (/^[^\s]+\.[^\s]+$/.test(trimmed)) {
      return `https://${trimmed}`;
    }
    const template = searchTemplate || 'https://www.baidu.com/s?wd=%s';
    return template.includes('%s')
      ? template.replace(/%s/g, encodeURIComponent(trimmed))
      : `${template}${encodeURIComponent(trimmed)}`;
  };

  const openMemberPage = (url: string) => {
    setMemberCustomUrl(url);
    setUrlInputValue(url);
    webviewRef.current?.navigateTo?.(url);
  };

  const publishRoomPage = (targetRoomId: string, url: string) => {
    if (activeLocalRoomPage) {
      if (pendingRoomPage.current?.page === activeLocalRoomPage && pendingRoomPage.current.url === url) return;
      pendingRoomPage.current = { page: activeLocalRoomPage, url };
    }
    socketService.sendPlayerEvent({ roomId: targetRoomId, actorId: socketService.getUserId(), action: 'load_url', url });
  };

  const openRoomPage = (targetRoomId: string, url: string, immediately = false, entryRule?: CardEntryRule) => {
    const { roomState: room, isHost: ownsRoom } = useRoomStore.getState();
    if (!ownsRoom || !room || room.id !== targetRoomId) return;
    if (activeEntryTrial && activeEntryTrial.id > completedEntryTrial.current.id) {
      completedEntryTrial.current = { id: activeEntryTrial.id, ready: false };
    }
    if (siteRuleService.localRoomNavigation(url) || siteRuleService.privatePlaybackPage(url)) {
      // Keep the WebView mounted while the site completes its own routing.
      const candidate = siteRuleService.trialRoomEntry(url, entryRule);
      const trial = candidate ? { ...candidate, id: ++entryTrialSequence.current, fallbackUrl: url } : undefined;
      const targetUrl = trial?.url ?? url;
      pendingRoomPage.current = null;
      setLocalRoomPage({ roomKey: `${room.id}|${room.instanceId ?? ''}|${room.hostId}`, url: targetUrl, trial });
      setUrlInputValue(url);
      webviewRef.current?.navigateTo?.(targetUrl);
      return;
    }
    publishRoomPage(targetRoomId, url);
    if (immediately || activeLocalRoomPage) webviewRef.current?.navigateTo?.(url);
    if (activeLocalRoomPage && room.playback.url === url) setLocalRoomPage(null);
  };

  const settleEntryTrial = (id: number, ready: boolean) => {
    if (!activeEntryTrial || activeEntryTrial.id !== id || id <= completedEntryTrial.current.id || isResettingUrlRef.current) return;
    const { roomState: room, isHost: ownsRoom } = useRoomStore.getState();
    if (!ownsRoom || !room || room.id !== roomId || room.instanceId !== roomState?.instanceId || room.hostId !== roomState?.hostId) return;
    completedEntryTrial.current = { id, ready };
    if (!ready) {
      webviewRef.current?.stopLoading?.();
      openRoomPage(roomId, activeEntryTrial.fallbackUrl);
      return;
    }
    setUrlInputValue(activeEntryTrial.url);
    if (room.playback.url === activeEntryTrial.url) setLocalRoomPage(null);
    else publishRoomPage(roomId, activeEntryTrial.url);
  };
  useEffect(() => {
    if (!activeEntryTrial) return;
    const timer = setTimeout(() => settleEntryTrial(activeEntryTrial.id, false), activeEntryTrial.timeoutMs ?? SITE_ENTRY_TRIAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [activeEntryTrial]);

  const openWatchlistVideoUrl = (input: string) => {
    if (!watchlistSelectionRef.current || useRoomStore.getState().roomState || socketService.hasRoomActivity()) return;
    const url = watchlistUrl(input);
    if (!url) {
      showToast('请输入可打开的视频网页链接', { type: 'info' });
      return;
    }
    Keyboard.dismiss();
    isResettingUrlRef.current = false;
    setUrlInputValue(url);
    setSoloUrl(url);
    webviewRef.current?.navigateTo?.(url);
  };

  const handleSearch = async () => {
    if (searchQuery.trim()) {
      cancelWatchlistLaunch();
      const finalUrl = formatInputToUrl(searchQuery);
      void mobileTelemetry.track('app:entry', { source: 'search' });
      if (watchlistSelectionRef.current) {
        openWatchlistVideoUrl(finalUrl);
      } else if (!roomId) {
        const storedName = await getRoomEntryName();
        socketService.createRoom(storedName, undefined, undefined, 'search', { reuseLastRoomId: true });
        const unsubscribe = useRoomStore.subscribe((state) => {
          if (state.roomState?.id) {
            unsubscribe();
            openRoomPage(state.roomState.id, finalUrl);
          } else if (state.error) {
            unsubscribe();
          }
        });
      } else if (isHost) {
        openRoomPage(roomId, finalUrl);
      } else if (canBrowseOwnPages) {
        Keyboard.dismiss();
        openMemberPage(finalUrl);
      }
      setSearchQuery('');
    }
  };

  const handleUrlSubmit = () => {
    if (!urlInputValue.trim()) return;
    cancelWatchlistLaunch();
    void mobileTelemetry.track('app:entry', { source: 'address' });
    const finalUrl = formatInputToUrl(urlInputValue);
    if (watchlistSelectionRef.current) {
      openWatchlistVideoUrl(finalUrl);
      return;
    }
    if (!roomId) {
      setSoloUrl(finalUrl);
      webviewRef.current?.navigateTo?.(finalUrl);
      return;
    }
    if (isHost) {
      openRoomPage(roomId, finalUrl, true);
    } else if (canBrowseOwnPages) {
      openMemberPage(finalUrl);
    }
  };

  const handleToggleFollowingHost = () => {
    cancelWatchlistLaunch();
    if (isFollowingHost) {
      setIsFollowingHost(false);
      setMemberCustomUrl(currentUrl || roomUrl);
    } else {
      setIsFollowingHost(true);
      setMemberCustomUrl('');
      const targetUrl = roomUrl;
      if (targetUrl) {
        setUrlInputValue(targetUrl);
        if (targetUrl !== currentUrlRef.current) {
          webviewRef.current?.navigateTo?.(targetUrl);
        }
      }
    }
  };

  const handleJumpToResume = (time?: number) => {
    const target = time ?? targetResumeTime;
    if (target > 0) {
      if (!effectiveIsHost) {
        showToast('只有房主可以调整房间进度');
        return;
      }
      webviewRef.current?.seekTo(target);
      setShowResumePill(false);
      showToast(`已恢复至上次进度 ${formatTime(target)}`);
    }
  };

  const handleContinuePlayback = (item: PlaybackHistoryItem) => {
    cancelWatchlistLaunch();
    void mobileTelemetry.track('app:entry', { source: 'history' });
    const finalUrl = formatInputToUrl(item.url);
    setUrlInputValue(finalUrl);
    if (!roomId) {
      setSoloUrl(finalUrl);
    } else if (isHost) {
      openRoomPage(roomId, finalUrl);
    } else if (canBrowseOwnPages) {
      openMemberPage(finalUrl);
    }
    selectAppTab('watch');
    setIsPanelCollapsed(true);
    if (item.currentTime >= 10 && !item.isFinished) {
      setCurrentHistoryItem(item);
      setTargetResumeTime(item.currentTime);
      setTargetResumePercent(item.progressPercent);
      setShowResumePill(true);
    }
  };

  function cancelWatchlistLaunch() {
    flushWatchlistProgress();
    selectedWatchlistItem.current = null;
    setWatchlistLaunch(null);
  }

  function flushWatchlistProgress() {
    const sample = lastWatchlistSample.current?.sample;
    const itemId = selectedWatchlistItem.current?.id;
    if (sample && hasWatchlistProgressTarget(sample, itemId)) void recordWatchlistProgress(sample, itemId).catch(() => {});
  }

  const openWatchlists = (listId?: string) => {
    setIsHistoryVisible(false);
    setWatchlistPage({ listId });
    selectAppTab('profile');
  };

  const handleBrowseForWatchlist = (list: Watchlist) => {
    if (useRoomStore.getState().roomState || socketService.hasRoomActivity()) {
      showToast('房间正在使用中，可用播放器的收藏按钮保存当前视频，或粘贴新链接', { type: 'info' });
      return;
    }
    cancelWatchlistLaunch();
    changeWatchlistSelection({ listId: list.id });
    selectAppTab('watch');
  };

  const closeWatchlistSelection = () => {
    const selection = watchlistSelectionRef.current;
    if (!selection) return false;
    openWatchlists(selection.listId);
    return true;
  };

  useEffect(() => {
    if (!watchlistSelection) return;
    if (roomId) {
      changeWatchlistSelection(null);
    } else if (watchlistStatus === 'ready' && !selectionList) {
      openWatchlists();
    }
  }, [roomId, selectionList, watchlistSelection, watchlistStatus]);

  const watchlistSampleTitle = (sample: WatchlistSample) => resolvePlaybackHistoryTitle(sample.location.url,
    { url: sample.location.url, title: sample.title }, pageMetadataRef.current);

  const confirmWatchlistSelection = async () => {
    const selection = watchlistSelectionRef.current;
    if (!selection || savingBookmark.current || useRoomStore.getState().roomState || socketService.hasRoomActivity()) return;
    const sample = webviewRef.current?.getWatchlistSample();
    if (!sample || !savedMedia || !sameWatchlistMedia(sample.location, savedMedia) || !sameWatchlistMedia(savedMedia, sample.location)) {
      showToast('视频正在切换，请稍后再保存', { type: 'info' });
      return;
    }
    savingBookmark.current = true;
    setSavingSelection(true);
    try {
      const result = await saveWatchlistItem(sample.location, watchlistSampleTitle(sample), sample, selection.listId);
      if (watchlistSelectionRef.current === selection) openWatchlists(result.listId);
      showToast(result.added ? `已存到「${result.listName}」` : `已在「${result.listName}」中`);
    } catch { showToast('片单保存失败，请重试', { type: 'info' }); }
    finally { savingBookmark.current = false; setSavingSelection(false); }
  };

  const storeBookmark = async (sample: WatchlistSample, listId?: string) => {
    if (savingBookmark.current) return;
    savingBookmark.current = true;
    try {
      const result = await saveWatchlistItem(sample.location, watchlistSampleTitle(sample), sample, listId);
      showToast(`已存到「${result.listName}」`, { actions: [
        { label: '查看片单', run: () => openWatchlists(result.listId) },
        ...(result.added ? [{ label: '撤销', run: () => {
          void removeWatchlistItem(result.listId, result.item.id).then(() => showToast('已撤销保存'))
            .catch(() => showToast('撤销失败，请重试', { type: 'info' }));
        } }] : []),
      ] });
    } catch { showToast('片单保存失败，请重试', { type: 'info' }); }
    finally { savingBookmark.current = false; }
  };

  const handleBookmark = () => {
    const sample = webviewRef.current?.getWatchlistSample();
    if (!sample) { showToast('视频正在切换，请稍后再保存', { type: 'info' }); return; }
    if (useWatchlists.getState().data.lists.some(list => list.items.some(item =>
      sameWatchlistMedia(item, sample.location) || isWatchlistLinkForMedia(item, sample.location)))) {
      setWatchlistPicker(sample);
    } else void storeBookmark(sample);
  };

  const handleWatchlistSample = (sample: WatchlistSample) => {
    const previous = lastWatchlistSample.current;
    const same = previous && sameWatchlistMedia(previous.sample.location, sample.location) &&
      sameWatchlistMedia(sample.location, previous.sample.location);
    if (!same) setWatchlistSource(sample);
    const timestamp = Date.now();
    const itemId = selectedWatchlistItem.current?.id;
    if (!same || timestamp - previous.recordedAt > 5000 || (!previous.sample.paused && sample.paused) || (!previous.sample.ended && sample.ended)) {
      if (hasWatchlistProgressTarget(sample, itemId)) void recordWatchlistProgress(sample, itemId).catch(() => {});
      lastWatchlistSample.current = { sample, recordedAt: timestamp };
    } else {
      lastWatchlistSample.current = { sample, recordedAt: same ? previous.recordedAt : 0 };
    }
  };

  const handleWatchlistPlay = (item: WatchlistItem, listId: string) => {
    const url = watchlistOpenUrl(item);
    const before = useRoomStore.getState();
    const room = before.roomState;
    const start = () => {
      const latest = useRoomStore.getState();
      if (latest.roomState?.id !== room?.id || latest.roomState?.instanceId !== room?.instanceId || latest.isHost !== before.isHost ||
        latest.roomState?.playback.url !== room?.playback.url || latest.roomState?.playback.media?.id !== room?.playback.media?.id) {
        showToast('房间已变化，请重新选择视频', { type: 'info' });
        return;
      }
      if (room && before.isHost && !latest.isConnected) {
        showToast('房间正在重连，请稍后播放', { type: 'info' });
        return;
      }
      flushWatchlistProgress();
      isResettingUrlRef.current = false;
      selectedWatchlistItem.current = item;
      setShowResumePill(false);
      setTargetResumeTime(0);
      setUrlInputValue(url);
      selectAppTab('watch');
      setIsPanelCollapsed(true);
      void rememberWatchlist(listId).catch(() => {});
      if (room && !before.isHost) {
        setWatchlistLaunch(null);
        setIsFollowingHost(false);
        openMemberPage(url);
        return;
      }
      setWatchlistLaunch({ item, roomId: room?.id, roomInstanceId: room?.instanceId });
      if (!room) {
        setSoloUrl(url);
        webviewRef.current?.navigateTo?.(url);
      } else if (room.playback.url !== url) {
        openRoomPage(room.id, url);
      }
    };
    if (room && before.isHost && room.members.length > 1 && room.playback.url) {
      showConfirm({ title: '在当前房间播放？', message: `播放「${item.title}」会改变全房片源或进度。`, confirmText: '一起播放', onConfirm: start });
    } else if (room && !before.isHost && isFollowingHost) {
      showConfirm({ title: '在自己的网页打开？', message: '网页只在本机切换，房间播放仍由房主控制。', confirmText: '打开网页', onConfirm: start });
    } else start();
  };

  useEffect(() => {
    if (!watchlistLaunch) return;
    const timer = setTimeout(() => {
      setWatchlistLaunch(null);
      showToast(watchlistLaunch.item.episode ? `请在网页选择「${watchlistLaunch.item.episode}」并播放` : '请在网页中手动开始播放', { type: 'info' });
    }, 15000);
    return () => clearTimeout(timer);
  }, [watchlistLaunch]);

  const handleVideoStateChange = (state: { currentTime: number; duration: number; paused: boolean }) => {
    mobileTelemetry.samplePlayback(state.currentTime, state.paused);
    const wasPaused = videoStateRef.current.paused;
    videoStateRef.current = state;
    setVideoState(state);
    if (currentUrl && !currentUrl.startsWith('about:blank') && state.currentTime >= 5) {
      // 若刚从播放切换为暂停，说明用户主动停住，立即强制落盘；常态播放中按3秒节流存盘
      const isJustPaused = !wasPaused && state.paused;
      savePlaybackProgress({
        url: currentUrl,
        currentTime: state.currentTime,
        duration: state.duration,
        title: getPlaybackTitle(currentUrl),
        siteIcon: pageMetadataRef.current.url === currentUrl ? pageMetadataRef.current.siteIcon : undefined,
      }, isJustPaused);
    }
    // 当播放进度已经越过或对齐续播目标点时，自动收起浮条
    if (targetResumeTime > 0 && Math.abs(state.currentTime - targetResumeTime) < 5) {
      setShowResumePill(false);
    }
  };

  const performExitRoom = () => {
    leaveVoice();
    if (currentUrl) {
      setSoloUrl(currentUrl);
      setUrlInputValue(currentUrl);
    }
    socketService.leaveRoom(roomId);
    setIsPanelCollapsed(true);
    setIsFollowingHost(true);
    setMemberCustomUrl('');
    showToast(isHost ? '已解散房间' : '已退出房间');
  };

  const handleExitRoom = () => {
    if (isHost) {
      setConfirmDialogConfig({
        visible: true,
        title: '解散房间',
        message: '确认要解散当前观影房间吗？解散后所有成员将立即退出观影。',
        confirmText: '确定',
        cancelText: '取消',
        type: 'danger',
        icon: 'logout',
        onConfirm: () => {
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
          performExitRoom();
        },
      });
    } else {
      setConfirmDialogConfig({
        visible: true,
        title: '退出房间',
        message: '确认要退出当前观影房间吗？',
        confirmText: '确定',
        cancelText: '取消',
        type: 'danger',
        icon: 'logout',
        onConfirm: () => {
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
          performExitRoom();
        },
      });
    }
  };

  const handleSendChat = async () => {
    const draft = chatInput;
    if (!draft.trim() || !roomId || chatSendingRef.current) return false;
    chatSendingRef.current = true;
    setChatSendError(null);
    try {
      await socketService.sendChatMessage(roomId, draft.trim());
      if (useRoomStore.getState().roomState?.id !== roomId) return false;
      setChatInput(current => current === draft ? '' : current);
      return true;
    } catch (error) {
      setChatSendError((error as Error).message);
      return false;
    } finally { chatSendingRef.current = false; }
  };

  const handleHome = () => {
    if (watchlistSelectionRef.current && (useRoomStore.getState().roomState || socketService.hasRoomActivity())) return;
    if (!effectiveIsHost && !canBrowseOwnPages) return;
    cancelWatchlistLaunch();
    if (activeEntryTrial) completedEntryTrial.current = { id: activeEntryTrial.id, ready: false };

    Keyboard.dismiss();
    setIsAddressFocused(false);
    browserCanGoBackRef.current = false;
    // 0. 返回首页前立即保存最新进度
    if (currentUrl && !currentUrl.startsWith('about:blank') && videoState.currentTime >= 5) {
      savePlaybackProgress({
        url: currentUrl,
        currentTime: videoState.currentTime,
        duration: videoState.duration,
        title: getPlaybackTitle(currentUrl),
        siteIcon: pageMetadataRef.current.url === currentUrl ? pageMetadataRef.current.siteIcon : undefined,
      }, true);
    }

    // 1. 立即停止 WebView 继续加载或重定向
    webviewRef.current?.stopLoading?.();

    if (canBrowseOwnPages) {
      setMemberCustomUrl('');
      setUrlInputValue('');
      setIsPanelCollapsed(true);
      setPlayerPresentation({ hasVideo: false, mode: 'page' });
      return;
    }

    // 2. 设置重置锁，避免后续异步 navigationStateChange 事件将重定向地址再次回传同步
    isResettingUrlRef.current = true;
    setTimeout(() => {
      isResettingUrlRef.current = false;
    }, 1500);

    // 3. 清空地址栏与单人播放地址
    setUrlInputValue('');
    setSoloUrl('');
    setLocalRoomPage(null);
    setIsPanelCollapsed(true);

    // 4. 乐观更新本地状态，立即切回首页，不依赖网络/Socket往返延迟
    const currentRoom = useRoomStore.getState().roomState;
    if (currentRoom) {
      useRoomStore.getState().setRoomState({
        ...currentRoom,
        playback: {
          ...currentRoom.playback,
          url: '',
          pageTitle: '',
        },
      });
    }

    // 5. 同步给服务端通知房间所有成员
    if (roomId) {
      socketService.sendPlayerEvent({
        roomId,
        actorId: socketService.getUserId(),
        action: 'load_url',
        url: '',
      });
    }
  };

  const handleRateChange = (rate: number) => {
    useRoomStore.getState().setCurrentPlaybackRate(rate);
    webviewRef.current?.setPlaybackRate(rate);
    if (isHost && roomId) {
      socketService.sendPlayerEvent({
        roomId,
        actorId: socketService.getUserId(),
        action: 'rate_change',
        playbackRate: rate,
        currentTime: videoState.currentTime,
      });
    }
  };

  const handleCatchUp = () => {
    useRoomStore.getState().setMemberLocalPause(false);
    if (roomId) {
      socketService.requestPlaybackSync(roomId);
      showToast('正在追赶房主播放进度...');
    }
  };

  const handleToggleFullscreen = (force?: boolean) => {
    const nextFullscreen = force !== undefined ? force : !isFullscreen;
    if (nextFullscreen) selectAppTab('watch');
    setIsFullscreen(nextFullscreen);
  };

  useAndroidBackNavigation({
    fullscreen: isFullscreen, keyboardVisible: isKeyboardVisible, addressEditing: isAddressFocused,
    quickChatOpen: isQuickChatOpen, activeTab: activeAppTab, historyVisible: isHistoryVisible,
    floatingPlayer: !!currentUrl && playerPresentation.mode === 'floating', canNavigate: effectiveIsHost || !isFollowingHost,
    canGoBack: () => !!currentUrl && browserCanGoBackRef.current,
    closeChatSelection: () => chatSelectionBackHandler.current?.() ?? false,
    closeQuickChat: () => setIsQuickChatOpen(false), closeHistory: () => setIsHistoryVisible(false),
    profileBack: () => {
      if (watchlistPage) { watchlistBackHandler.current?.(); return true; }
      return profileBackHandler.current?.() || false;
    },
    closeWatchlistSelection,
    watch: () => selectAppTab('watch'), browserBack: () => { cancelWatchlistLaunch(); webviewRef.current?.goBack(); },
    requestExit: () => setConfirmDialogConfig({
      visible: true, title: '退出应用', message: roomId ? '你还在观影房间中，确定退出应用吗？' : '确定退出应用吗？',
      confirmText: '退出', cancelText: '继续使用', type: 'warning', icon: 'logout',
      onConfirm: () => { setConfirmDialogConfig(previous => ({ ...previous, visible: false })); BackHandler.exitApp(); },
    }),
  });

  // 当播放地址被清空时（如房主点击 Home 返回首页），自动退出全屏恢复竖屏
  useEffect(() => {
    if (!currentUrl && isFullscreen) {
      handleToggleFullscreen(false);
    }
  }, [currentUrl, isFullscreen]);

  // Read current render state again immediately before reloading; a paused player is still busy.
  const updateSafety = useRef<() => boolean>(() => false);
  updateSafety.current = () => initialLinkResolved.current && activeAppTab === 'watch' && !roomId && !currentUrl &&
    !socketService.hasRoomActivity() &&
    voiceStatus === 'idle' && !searchQuery.trim() && !urlInputValue.trim() && !chatInput.trim() &&
    !isKeyboardVisible && !isAddressFocused && !isQuickChatOpen && !isHistoryVisible && !watchlistPage && !watchlistPicker && !watchlistSelection &&
    !roomEntryRequest && !roomChoicesOpen && !entryAfterDismiss.current && !confirmDialogConfig.visible && !forceUpdateInfo && !clipboardReadRef.current.busy;
  useEffect(() => registerUpdateHome(() => updateSafety.current(), result => {
    setForceUpdateInfo({ releaseNotes: result.releaseNotes || '请更新应用以继续使用。', downloadUrl: result.appDownloadUrl || '' });
  }), []);

  const selectionVideo = playerPresentation.hasVideo && savedMedia && watchlistSource
    ? [savedMedia.episode, watchlistSampleTitle(watchlistSource)].filter(Boolean).join(' · ') : undefined;
  const selectionBar = selectionList && !roomId ? <WatchlistSelectionBar listName={selectionList.name}
    video={selectionVideo} saving={savingSelection} onCancel={closeWatchlistSelection} onConfirm={confirmWatchlistSelection}
    playback={selectionVideo ? { paused: videoState.paused, onToggle: () => {
      if (!socketService.hasRoomActivity()) webviewRef.current?.setPaused(!videoState.paused);
    } } : undefined} /> : null;

  const hasHomeEntry = !roomId && !watchlistSelection && !currentUrl;
  const openRoomForm = (mode: 'create' | 'join') => {
    if (!useRoomStore.getState().roomState) setRoomEntryRequest({ mode, id: ++roomEntryRequestIdRef.current });
  };
  const chooseRoomAction = (mode: 'create' | 'join') => {
    automaticUpdates.interaction();
    setRoomChoicesOpen(false);
    if (Platform.OS === 'ios') entryAfterDismiss.current = mode;
    else openRoomForm(mode);
  };
  const inviteGuide = (label: string) => roomGuideStep === 'invite' && roomConnected && isHost && roomState?.members.length === 1
    ? <RoomGuideHint message={`点「${label}」，把房间发给好友。`} onDismiss={finishInvite} testID="first-room-invite-guide" /> : null;
  const copyWatchInvitation = async () => {
    const { roomState: room, savedPassword, isConnected } = useRoomStore.getState();
    if (!room || !isConnected) return;
    try {
      if (!await Clipboard.setStringAsync(roomInvite(room.id, room.hasPassword, savedPassword, resolveWebUrl()))) {
        showToast('复制失败，请重试', { type: 'info' });
        return;
      }
      finishInvite();
      showToast('邀请已复制，可发给 TA');
    } catch {
      showToast('复制失败，请重试', { type: 'info' });
    }
  };
  const hideWatchCapsule = videoFillsScreen || editingAddress || isKeyboardVisible || quickChatVisible;
  const roomControls = roomState ? <WatchSessionControls key={roomId} floating={!!currentUrl}
    hidden={hideWatchCapsule} members={roomState.members} myUserId={myUserId} roomConnected={roomConnected}
    unreadCount={unreadCount} onInvite={copyWatchInvitation}
    onOpenChat={() => { Keyboard.dismiss(); setIsQuickChatOpen(true); }} /> : null;
  const bookmarkToastBottom = bottomInset + APP_TAB_BAR_HEIGHT + (currentUrl ? watchDockHeight : 0) + 12
    + (roomControls && !hideWatchCapsule ? WATCH_CAPSULE_HEIGHT + WATCH_CAPSULE_BOTTOM_INSET : 0);
  const homeCapsule = !hideWatchCapsule && (roomControls || (hasHomeEntry && (
    <AppButton label="一起看" icon={Users} tone="accent" testID="home-room-entry" onPress={() => {
      if (entryAfterDismiss.current || roomEntryRequest) return;
      Keyboard.dismiss();
      finishEntry();
      setRoomChoicesOpen(true);
    }} />
  )));
  const showEntryGuide = hasHomeEntry && initialLinkStatus === 'ready' && roomGuideStep === 'entry' && !confirmDialogConfig.visible && !forceUpdateInfo;
  const homeGuide = roomState ? inviteGuide('邀请好友') : showEntryGuide
    ? <RoomGuideHint message="点「一起看」建房，或用好友发来的邀请加入。" onDismiss={finishEntry} testID="home-room-guide" /> : null;

  return (
    <>
      {/* 强制更新全屏遮罩（不可跳过） */}
      <ForceUpdateOverlay
        visible={forceUpdateInfo !== null}
        releaseNotes={forceUpdateInfo?.releaseNotes || ''}
        downloadUrl={forceUpdateInfo?.downloadUrl || ''}
      />
      <View style={[styles.container, videoFillsScreen && styles.fullscreenContainer]}>
      <ChatComposerHost>
      <SafeAreaView style={styles.safeArea}
        edges={videoFillsScreen ? [] : editingAddress && isKeyboardVisible ? ['top', 'left', 'right'] : ['top', 'left', 'right', 'bottom']}>
      {/* Toast Notification */}
      {!androidPip && toastConfig?.message ? (
        <Animated.View testID={toastConfig.actions?.length ? 'watchlist-save-toast' : undefined}
          style={[styles.toastContainer, toastConfig.actions && activeAppTab === 'watch' && !videoFillsScreen && !isKeyboardVisible &&
          [styles.bookmarkToast, { bottom: bookmarkToastBottom }], { opacity: toastOpacity }]}
          pointerEvents={toastConfig.actions?.length ? 'auto' : 'none'} accessibilityLiveRegion="polite">
          <View style={[styles.toastBody, toastConfig.actions && styles.bookmarkToastBody]}>
            {toastConfig.actions ? <View style={styles.bookmarkToastMark}><BookmarkCheck size={17} strokeWidth={1.8} color={APP_ACCENT} /></View> :
              toastConfig.type === 'success' && <CheckCircle2 size={15} color="#34D399" />}
            <Text style={styles.toastText}>{toastConfig.message}</Text>
          </View>
          {toastConfig.actions && <View style={styles.toastActions}>
            {toastConfig.actions.map((action, index) => <TouchableOpacity key={action.label}
              activeOpacity={0.7} style={[styles.toastAction, index === 0 && styles.toastPrimary]} accessibilityRole="button" onPress={() => {
                showToast('');
                action.run();
              }}><Text style={[styles.toastActionText, index === 0 && styles.toastPrimaryText]}>{action.label}</Text></TouchableOpacity>)}
          </View>}
        </Animated.View>
      ) : null}

      <KeyboardAvoidingView style={styles.moduleContent} behavior="padding"
        enabled={editingAddress} accessibilityElementsHidden={quickChatVisible}
        importantForAccessibility={quickChatVisible ? 'no-hide-descendants' : 'auto'}>
      <ModuleShell activeTab={videoFillsScreen ? 'watch' : activeAppTab}
        watch={<>
      {!isFullscreen && !currentUrl ? (
        <View style={styles.lobbyHeader}>
          <View style={styles.brandTitleGroup}>
            <Image 
              source={require('../../assets/icon.png')} 
              style={styles.brandLogo} 
              resizeMode="contain" 
            />
            <Text style={styles.lobbyBrandTitle}>异起看</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {roomState?.id && (
              <View style={styles.roomStatusBadge}>
                <Text style={styles.roomStatusText} numberOfLines={1}>房号 {roomState.id}</Text>
              </View>
            )}
            <TouchableOpacity style={styles.lobbyProfileBtn} hitSlop={8} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel="个人中心" testID="个人中心按钮"
              onPress={() => selectAppTab('profile')}>
              <User color="#ddd" size={17} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View 
        style={[
          styles.videoContainer, 
          videoFillsScreen && styles.fullscreenVideo,
        ]}
      >
        {currentUrl ? (
          <>
            <RoomWebView 
              ref={webviewRef}
              initialUrl={currentUrl} 
              siteEntryTrial={activeEntryTrial}
              onSiteEntryTrialResult={settleEntryTrial}
              entryLoadingMessage={activeEntryTrial ? '正在连接访问线路' :
                siteRuleService.localRoomNavigation(currentUrl) ? '正在分配访问线路' : undefined}
              isFullscreen={isFullscreen}
              allowPictureInPicture={activeAppTab === 'watch' && !editingAddress && !quickChatVisible && !watchlistPicker && !watchlistSelection && !confirmDialogConfig.visible && !forceUpdateInfo}
              onAndroidPictureInPicture={setAndroidPip}
              isHost={effectiveIsHost}
              isFollowingHost={isFollowingHost}
              onShowToast={showToast}
              onBrowserNavigationBlocked={() => setBrowserHint(hint => hint ?? 'link')}
              onToggleFullscreen={handleToggleFullscreen} 
              onNavigationStateChange={(canGoBack, canGoForward, navUrl, navTitle) => {
                if (isResettingUrlRef.current) return;
                if (watchlistSelection && (useRoomStore.getState().roomState || socketService.hasRoomActivity())) return;
                browserCanGoBackRef.current = canGoBack;
                if (entryTrial && (completedEntryTrial.current.id !== entryTrial.id || !completedEntryTrial.current.ready)) return;
                if (navUrl && !navUrl.startsWith('about:blank')) {
                  if (siteRuleService.localRoomNavigation(navUrl)) return;
                  // Keep titles tied to their URL so a delayed callback or old
                  // history item cannot label the next movie incorrectly.
                  pageMetadataRef.current = { ...(pageMetadataRef.current.url === navUrl ? pageMetadataRef.current : {}), url: navUrl, title: resolvePlaybackHistoryTitle(navUrl, { url: navUrl, title: navTitle }, pageMetadataRef.current) };
                  if (!isAddressFocused) setUrlInputValue(navUrl);
                  if (!roomId) {
                    setSoloUrl(navUrl);
                  } else if (isHost && siteRuleService.privatePlaybackPage(navUrl)) {
                    // Search stays local until the selected movie opens its public player.
                    return;
                  } else if (isHost) {
                    if (navUrl !== (activeLocalRoomPage ? roomUrl : currentUrl)) publishRoomPage(roomId, navUrl);
                    else if (activeLocalRoomPage && !pendingRoomPage.current) setLocalRoomPage(null);
                  } else if (!isHost && !isFollowingHost) {
                    setMemberCustomUrl(url => url ? navUrl : url);
                  }
                }
              }}
              onSiteIcon={(pageUrl, siteIcon) => {
                if (pageMetadataRef.current.url === pageUrl) pageMetadataRef.current = { ...pageMetadataRef.current, siteIcon };
              }}
              onVideoStateChange={handleVideoStateChange}
              onPlayerPresentationChange={setPlayerPresentation}
              watchlistLaunch={watchlistLaunch}
              onWatchlistSample={handleWatchlistSample}
              onWatchlistResumed={launch => setWatchlistLaunch(current => current === launch ? null : current)}
            />
            <ResumePlaybackPill
              visible={showResumePill && effectiveIsHost && !videoFillsScreen && !watchlistSelection}
              targetTime={targetResumeTime}
              progressPercent={targetResumePercent}
              onJump={() => handleJumpToResume(targetResumeTime)}
              onDismiss={() => setShowResumePill(false)}
            />
          </>
        ) : (
          <EmptyState 
            homeConfig={homeConfig}
            onRetryHomeConfig={homeConfig.retry}
            roomId={roomId}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            recentUrl={watchlistSelection ? '' : recentUrl}
            clipboardUrl={clipboardUrl}
            onSearch={handleSearch}
            isInRoom={!!roomState}
            entryAction={homeCapsule}
            entryGuide={homeGuide}
            onManageRoom={() => selectAppTab('room')}
            isHost={effectiveIsHost}
            onBrowseUrl={canBrowseOwnPages ? openMemberPage : undefined}
              onOpenRoomPage={(id, url, source, rule) => openRoomPage(id, url, false, source === 'recommendation' ? rule : undefined)}
            onSelectVideoUrl={watchlistSelection ? openWatchlistVideoUrl : undefined}
            lastPlayback={watchlistSelection ? null : lastPlayback}
            onContinuePlayback={handleContinuePlayback}
            watchlistResume={!watchlistSelection && !roomId && nextSavedVideo ? { item: nextSavedVideo, onPlay: () => handleWatchlistPlay(nextSavedVideo, defaultWatchlist.id) } : undefined}
          />
        )}
        {currentUrl ? roomControls : null}
      </View>


          {!videoFillsScreen && !currentUrl && selectionBar}
          {!videoFillsScreen && (currentUrl || canBrowseOwnPages) && <View style={styles.watchDock} testID="观看底部工具区"
            onLayout={event => setWatchDockHeight(event.nativeEvent.layout.height)}>
            <BrowserToolbar
              currentUrl={currentUrl} urlInputValue={urlInputValue} setUrlInputValue={setUrlInputValue}
              onGoBack={() => { cancelWatchlistLaunch(); webviewRef.current?.goBack(); }}
              onGoForward={() => { cancelWatchlistLaunch(); webviewRef.current?.goForward(); }}
              onReload={retryHostVideo ?? (() => webviewRef.current?.reload())} onHome={handleHome}
              onSubmit={() => { Keyboard.dismiss(); setIsAddressFocused(false); handleUrlSubmit(); }}
              onFocusChange={setIsAddressFocused} isHost={effectiveIsHost}
              browseHint={browserHint} onAddressBlocked={() => setBrowserHint('address')}
              onRetryVideo={retryHostVideo}
              isFollowingHost={isFollowingHost} onToggleFollowing={handleToggleFollowingHost}
              renderPlayback={selectionBar ? () => selectionBar : currentUrl && playerPresentation.hasVideo && playerPresentation.mode === 'page' ? sourceAction => (
                <CompactPlaybackControls title={displayPlaybackTitle} paused={videoState.paused} currentTime={videoState.currentTime} duration={videoState.duration}
                  mediaKey={`${roomState?.id || ''}|${currentUrl}|${roomState?.playback.media?.id || ''}`}
                  isHost={effectiveIsHost} expanded={!isPanelCollapsed} sourceAction={sourceAction}
                  bookmark={!watchlistSelection && savedMedia && watchlistStatus === 'ready' ? { saved: isBookmarked, onPress: handleBookmark } : undefined}
                  onExpand={() => setIsPanelCollapsed(value => !value)}
                  onPlayPause={() => {
                    setWatchlistLaunch(null);
                    if (!effectiveIsHost && videoState.paused) { handleCatchUp(); return; }
                    webviewRef.current?.setPaused(!videoState.paused);
                  }}
                  onSeek={time => { if (effectiveIsHost) { setWatchlistLaunch(null); webviewRef.current?.seekTo(time); setShowResumePill(false); } }}
                  onFullscreen={() => handleToggleFullscreen(true)} />
              ) : undefined} />
          </View>}
        </>}
        room={<>
          <RoomModule room={roomState} myUserId={myUserId} active={activeAppTab === 'room' && !isFullscreen}
            messages={chatMessages} chatInput={chatInput} setChatInput={value => { setChatInput(value); setChatSendError(null); }}
            onSend={handleSendChat} sendError={chatSendError} onMessagesRead={markMessagesRead} onSelectionBackChange={registerChatSelectionBack}
            onLeaveRoom={handleExitRoom}
            entryRequest={roomEntryRequest} onEntryFormClose={() => setRoomEntryRequest(undefined)}
            inviteGuide={inviteGuide('邀请')} onInviteCopied={finishInvite} />
        </>}
        profile={hasVisitedProfile ? <>
          <View style={{ flex: 1 }}>
            <View style={[StyleSheet.absoluteFill, (isHistoryVisible || watchlistPage) && { opacity: 0 }]} pointerEvents={isHistoryVisible || watchlistPage ? 'none' : 'auto'}
              accessibilityElementsHidden={isHistoryVisible || !!watchlistPage} importantForAccessibility={isHistoryVisible || watchlistPage ? 'no-hide-descendants' : 'auto'}>
              <ProfileModal embedded visible active={activeAppTab === 'profile' && !isHistoryVisible && !watchlistPage} onBackHandlerChange={registerProfileBackHandler}
                onClose={() => {}} onOpenHistory={() => setIsHistoryVisible(true)} onOpenWatchlists={() => openWatchlists()} onForceUpdate={info => setForceUpdateInfo(info)}
                onCreateInviteRoom={() => {
                  selectAppTab('room');
                  openRoomForm('create');
                }} />
            </View>
            {isHistoryVisible && <PlaybackHistoryPanel active={activeAppTab === 'profile'} onBack={() => setIsHistoryVisible(false)} onPlay={item => {
              if (roomId && !isHost) {
                setIsFollowingHost(false);
                setMemberCustomUrl(formatInputToUrl(item.url));
              }
              handleContinuePlayback(item);
            }} />}
            {watchlistPage && <WatchlistPanel listId={watchlistPage.listId} onSelect={listId => setWatchlistPage({ listId })}
              onClose={() => setWatchlistPage(null)} onPlay={handleWatchlistPlay} onBrowse={handleBrowseForWatchlist}
              registerBack={registerWatchlistBack} />}
          </View>
        </> : null}
      />
      </KeyboardAvoidingView>
      <AppActionSheet visible={roomChoicesOpen && hasHomeEntry} heading="一起看" tone="accent" closeTestID="home-room-entry-close"
        onClose={() => setRoomChoicesOpen(false)} onDismiss={() => {
          const mode = entryAfterDismiss.current;
          entryAfterDismiss.current = undefined;
          if (mode) openRoomForm(mode);
        }}>
        <AppActionRow title="创建房间" description="建好后，把邀请发给好友" icon={PlusCircle} trailingIcon={ChevronRight} tone="accentPrimary"
          testID="home-create-room" onPress={() => chooseRoomAction('create')} />
        <AppActionRow title="加入房间" description="输入房间号，或粘贴好友的邀请" icon={LogIn} trailingIcon={ChevronRight} tone="accent"
          testID="home-join-room" onPress={() => chooseRoomAction('join')} />
      </AppActionSheet>
      {!videoFillsScreen && !editingAddress && !selectionBar && <View style={styles.tabDock} accessibilityElementsHidden={quickChatVisible}
        importantForAccessibility={quickChatVisible ? 'no-hide-descendants' : 'auto'}>
        <AppTabBar activeTab={activeAppTab} onChange={selectAppTab} unreadCount={unreadCount} hasWatchUpdate={hasWatchUpdate} />
      </View>}
      {/* Keep the sheet mounted so iOS can finish dismissing its input modal. */}
      {roomState && <View style={[styles.quickChatOverlay, !quickChatVisible && styles.quickChatHidden]}
        pointerEvents={quickChatVisible ? 'auto' : 'none'} accessibilityViewIsModal={quickChatVisible}
        accessibilityElementsHidden={!quickChatVisible} importantForAccessibility={quickChatVisible ? 'auto' : 'no-hide-descendants'}>
        <View style={styles.quickChatBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} accessibilityLabel="关闭快捷聊天" onPress={() => setIsQuickChatOpen(false)} />
          <SafeAreaView style={styles.quickChatSheet} edges={['bottom']}>
            <View style={styles.quickChatHeader}><Text style={styles.quickChatTitle}>房间聊天</Text><TouchableOpacity style={styles.quickChatClose} accessibilityLabel="收起快捷聊天" onPress={() => setIsQuickChatOpen(false)}><Text style={styles.quickChatLink}>收起</Text></TouchableOpacity></View>
            <ChatPanel key={JSON.stringify([roomId, roomState.instanceId])} roomId={roomId} members={roomState.members} messages={chatMessages}
              chatInput={chatInput} setChatInput={value => { setChatInput(value); setChatSendError(null); }}
              onSend={handleSendChat} onSent={() => setIsQuickChatOpen(false)} sendError={chatSendError} isActive={quickChatVisible}
              onReadMessages={markMessagesRead} onSelectionBackChange={registerChatSelectionBack}
              enableMemory memoryTitle={roomState.playback?.media?.title || roomState.playback?.pageTitle || undefined} />
          </SafeAreaView>
        </View>
      </View>}

      <WatchlistPicker target={watchlistPicker?.location ?? null} title={watchlistPicker?.title} onClose={() => setWatchlistPicker(null)}
        onSelect={list => {
          if (!watchlistPicker) return;
          setWatchlistPicker(null);
          void storeBookmark(watchlistPicker, list.id);
        }}
        onRemove={list => {
          const target = watchlistPicker?.location;
          const item = target && list.items.find(entry => sameWatchlistMedia(entry, target) || isWatchlistLinkForMedia(entry, target));
          if (!item) return;
          setWatchlistPicker(null);
          void removeWatchlistItem(list.id, item.id).then(() => showToast('已移出片单')).catch(() => showToast('移出失败，请重试', { type: 'info' }));
        }} />

      <ConfirmDialog
        visible={confirmDialogConfig.visible}
        title={confirmDialogConfig.title}
        message={confirmDialogConfig.message}
        confirmText={confirmDialogConfig.confirmText}
        cancelText={confirmDialogConfig.cancelText}
        type={confirmDialogConfig.type}
        icon={confirmDialogConfig.icon}
        onConfirm={() => { void Promise.resolve().then(() => confirmDialogConfig.onConfirm()).catch(error => socketService.reportConnectionError(error)); }}
        onCancel={() => {
          confirmDialogConfig.onCancel?.();
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
        }}
      />
    </SafeAreaView>
    </ChatComposerHost>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  moduleContent: { flex: 1 },
  tabDock: { flexShrink: 0 },
  watchDock: { backgroundColor: APP_BACKGROUND, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  quickChatOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 30 },
  quickChatHidden: { opacity: 0 },
  quickChatBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  quickChatSheet: { height: '58%', backgroundColor: APP_BACKGROUND, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  quickChatHeader: { height: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quickChatTitle: { color: '#e5e7eb', fontSize: 16, fontWeight: '500' },
  quickChatClose: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  quickChatLink: { color: '#fb923c', fontSize: 13 },
  container: {
    flex: 1,
    backgroundColor: APP_BACKGROUND,
  },
  fullscreenContainer: { backgroundColor: '#000' },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  lobbyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 52,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: APP_BACKGROUND,
  },
  brandTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogo: {
    width: 22,
    height: 22,
    borderRadius: 5,
    marginRight: 7,
  },
  lobbyBrandTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  lobbyProfileBtn: { padding: 6, borderRadius: 10, backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  roomStatusBadge: {
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
    flexShrink: 0,
  },
  roomStatusText: {
    color: '#F97316',
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  lobbyContent: {
    flex: 1,
  },
  videoContainer: {
    flex: 1,
    minHeight: 250,
    backgroundColor: 'transparent',
  },
  fullscreenVideo: {
    flex: 1,
    minHeight: 0,
    height: '100%',
  },
  toastContainer: {
    position: 'absolute',
    top: 54,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    maxWidth: '94%',
    backgroundColor: 'rgba(22, 23, 31, 0.98)',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'rgba(0, 0, 0, 0.50)',
    borderLeftColor: 'rgba(255, 255, 255, 0.12)',
    borderRightColor: 'rgba(255, 255, 255, 0.12)',
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 10,
  },
  toastBody: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bookmarkToastBody: { flex: 1, minWidth: 125 },
  bookmarkToast: { top: undefined, left: 14, right: 14, maxWidth: undefined, alignSelf: 'stretch', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.watchControls.edge, borderBottomColor: colors.watchControls.edge,
    borderLeftColor: colors.watchControls.edge, borderRightColor: colors.watchControls.edge,
    backgroundColor: colors.watchControls.surface, justifyContent: 'flex-start',
    shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.24, shadowRadius: 8, elevation: 5 },
  bookmarkToastMark: { backgroundColor: colors.watchControls.accentSurface, height: 30, width: 30, borderRadius: 9,
    justifyContent: 'center', alignItems: 'center' },
  toastText: {
    flexShrink: 1,
    color: '#F3F4F6',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'left',
  },
  toastAction: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  toastActions: { marginLeft: 'auto', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end',
    alignItems: 'center', gap: 2 },
  toastPrimary: { borderRadius: 11, backgroundColor: colors.watchControls.accentSurface, paddingHorizontal: 10 },
  toastActionText: { color: colors.watchControls.secondary, fontSize: 13, fontWeight: '600' },
  toastPrimaryText: { color: APP_ACCENT, fontWeight: '700' },
});

export default function RoomScreen(props: Props) {
  return (
    <>
      <RoomScreenContent {...props} />
      <SafetySheet />
    </>
  );
}
