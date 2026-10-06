import { parseRoomInvitation } from '../services/room-invite';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, StatusBar, Animated, Text, TouchableOpacity, ScrollView, Image, Keyboard, Platform, Linking, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Clipboard from 'expo-clipboard';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { User, Sparkles, LogIn, PlusCircle, CheckCircle2 } from 'lucide-react-native';
import { RootStackParamList } from '../navigation/AppNavigator';
import RoomWebView, { RoomWebViewRef } from '../components/RoomWebView';
import { useRoomStore } from '../store/useRoomStore';
import { socketService } from '../services/socket';
import { showConfirm } from '../store/useDialogStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BrowserToolbar } from '../components/app/browser-toolbar';
import { SafetySheet } from '../components/app/safety-sheet';
import { EmptyState } from '../components/app/empty-state';
import { BottomPanel } from '../components/app/bottom-panel';
import { ProfileModal } from '../components/app/profile-modal';
import { ConfirmDialog } from '../components/app/confirm-dialog';
import { MembersPanel, LAST_ROOM_ID_CACHE_KEY, LAST_ROOM_PASSWORD_CACHE_KEY } from '../components/app/members-panel';
import { ForceUpdateOverlay } from '../components/app/force-update-overlay';
import { VoiceProvider, useVoice } from '../services/voice-service';
import { otaService } from '../services/ota-service';
import { mobileTelemetry } from '../services/telemetry';
import { openAppUpdate } from '../services/app-update';
import { resolveWebUrl } from '../services/environment';
import { formatTime } from '../utils/time';
import { 
  getLatestPlayback, 
  getPlaybackProgress, 
  savePlaybackProgress, 
  flushPlaybackProgress,
  PlaybackHistoryItem 
} from '../services/playback-history';
import { ResumePlaybackPill } from '../components/app/resume-playback-pill';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect } from 'react-native-svg';


type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;


function RoomScreenContent({ route, navigation }: Props) {
  const roomState = useRoomStore((state) => state.roomState);
  const roomId = roomState?.id || '';
  const { leaveVoice } = useVoice();
  
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const clipboardReadRef = useRef({ busy: false, denied: false, lastRead: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [urlInputValue, setUrlInputValue] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatSendError, setChatSendError] = useState<string | null>(null);
  const chatSendingRef = useRef(false);
  const [videoState, setVideoState] = useState({ currentTime: 0, duration: 0, paused: true });
  const [roomEntryRequest, setRoomEntryRequest] = useState<{ mode: 'create' | 'join'; id: number }>();
  const roomEntryRequestIdRef = useRef(0);
  const [activeBottomTab, setActiveBottomTab] = useState<'video' | 'chat' | 'members'>('video');
  const [isProfileVisible, setIsProfileVisible] = useState(false);
  const [forceUpdateInfo, setForceUpdateInfo] = useState<{ releaseNotes: string; downloadUrl: string } | null>(null);

  // 软键盘状态
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  
  const webviewRef = useRef<RoomWebViewRef>(null);
  const isResettingUrlRef = useRef(false);
  const videoStateRef = useRef(videoState);
  const currentUrlRef = useRef('');
  const currentHistoryItemRef = useRef<PlaybackHistoryItem | null>(null);
  
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const isHost = useRoomStore((state) => state.isHost);
  const [soloUrl, setSoloUrl] = useState('');
  const roomUrl = roomState?.playback?.url || '';
  const currentUrl = roomId ? roomUrl : soloUrl;
  const effectiveIsHost = !roomId ? true : isHost;
  const [recentUrl, setRecentUrl] = useState('');
  const [lastPlayback, setLastPlayback] = useState<PlaybackHistoryItem | null>(null);
  const [currentHistoryItem, setCurrentHistoryItem] = useState<PlaybackHistoryItem | null>(null);
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
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    visible: false,
    title: '',
    onConfirm: () => {},
  });

  const [toastConfig, setToastConfig] = useState<{ message: string; type: 'success' | 'info' | 'none' } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, options?: { type?: 'success' | 'info' | 'none' }) => {
    if (!msg) {
      setToastConfig(null);
      return;
    }
    const type = options?.type ?? 'success';
    setToastConfig({ message: msg, type });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    Animated.timing(toastOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    toastTimeoutRef.current = setTimeout(() => {
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setToastConfig(null));
    }, 3000);
  };

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
    if (currentUrl && !currentUrl.startsWith('about:blank')) {
      AsyncStorage.setItem('@recent_url', currentUrl).catch(() => {});
      getPlaybackProgress(currentUrl).then((item) => {
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
  }, [currentUrl]);

  // 当加载并播放视频时，自动展开底部控制面板并锁定视频Tab；返回首页时，自动恢复收起
  const prevHasVideoRef = useRef(false);
  useEffect(() => {
    const hasVideo = Boolean(currentUrl && !currentUrl.startsWith('about:blank'));
    if (hasVideo && !prevHasVideoRef.current) {
      setIsPanelCollapsed(false);
      setActiveBottomTab('video');
    } else if (!hasVideo && prevHasVideoRef.current) {
      setIsPanelCollapsed(true);
    }
    prevHasVideoRef.current = hasVideo;
  }, [currentUrl]);

  // 屏蔽、被移出等退出路径也恢复首页入口，避免停在创建表单。
  const previousRoomId = useRef(roomId);
  useEffect(() => {
    if (roomId) setRoomEntryRequest(undefined);
    if (previousRoomId.current && !roomId) {
      Keyboard.dismiss();
      setIsPanelCollapsed(true);
      setActiveBottomTab(currentUrl ? 'video' : 'members');
    }
    previousRoomId.current = roomId;
  }, [roomId, currentUrl]);

  // 保持记录房间播放地址，以便离开房间或房间解散时平滑保留在当前页面继续看
  useEffect(() => {
    if (roomState?.playback?.url) {
      setSoloUrl(roomState.playback.url);
    }
  }, [roomState?.playback?.url]);

  // 从单人播放模式新建房间时，自动将单人播放地址带入新房间
  useEffect(() => {
    if (roomId && isHost && soloUrl && !roomState?.playback?.url) {
      socketService.sendPlayerEvent({
        roomId,
        actorId: socketService.getUserId(),
        action: 'load_url',
        url: soloUrl,
      });
    }
  }, [roomId, isHost, soloUrl, roomState?.playback?.url]);

  // Connect socket on mount
  useEffect(() => {
    socketService.connect();
  }, []);

  useEffect(() => {
    mobileTelemetry.setRoomState(Boolean(roomId), roomId || null);
    if (roomId) {
      AsyncStorage.setItem(LAST_ROOM_ID_CACHE_KEY, roomId).catch(() => {});
      const pwd = useRoomStore.getState().savedPassword;
      if (pwd) {
        AsyncStorage.setItem(LAST_ROOM_PASSWORD_CACHE_KEY, pwd).catch(() => {});
      } else if (roomState?.hasPassword === false) {
        AsyncStorage.removeItem(LAST_ROOM_PASSWORD_CACHE_KEY).catch(() => {});
      }
    }
  }, [roomId, roomState?.hasPassword]);

  // 深度链接（Deep Link）与剪贴板邀请口令监听
  const lastCheckedTokenRef = useRef<string>('');

  const handleDeepLinkUrl = async (rawUrl: string | null) => {
    if (!rawUrl) return;
    const parsed = parseRoomInvitation(rawUrl);
    if (!parsed) return;
    const { roomId: targetRoomId, password: targetPassword } = parsed;

    if (useRoomStore.getState().roomState?.id === targetRoomId) {
      return;
    }

    const storedName = (await AsyncStorage.getItem('@yiqikan_username')) || '影迷';
    showToast(`正在通过专属链接加入房间: ${targetRoomId}`);
    if (targetPassword) {
      useRoomStore.getState().setSavedPassword(targetPassword);
      AsyncStorage.setItem(LAST_ROOM_PASSWORD_CACHE_KEY, targetPassword).catch(() => {});
    }
    AsyncStorage.setItem(LAST_ROOM_ID_CACHE_KEY, targetRoomId).catch(() => {});
    await socketService.connect();
    socketService.joinRoom(storedName, targetRoomId, targetPassword);
  };

  const checkClipboardForRoomInvite = async () => {
    const read = clipboardReadRef.current;
    if (read.busy || read.denied || Date.now() - read.lastRead < 2000) return;
    read.busy = true;
    read.lastRead = Date.now();
    try {
      const hasString = await Clipboard.hasStringAsync();
      if (!hasString) return;

      const content = await Clipboard.getStringAsync();
      if (!content) { read.denied = true; return; }
      if (content === lastCheckedTokenRef.current) return;

      const parsed = parseRoomInvitation(content);
      if (!parsed) {
        const text = content.trim();
        setClipboardUrl(/^https?:\/\/\S+$/i.test(text) ? text : null);
        return;
      }
      setClipboardUrl(null);

      lastCheckedTokenRef.current = content;

      if (useRoomStore.getState().roomState?.id === parsed.roomId) {
        return;
      }

      setConfirmDialogConfig({
        visible: true,
        title: '发现房间邀请',
        message: `检测到好友邀请口令，是否立即加入放映房间「${parsed.roomId}」？`,
        confirmText: '立即加入',
        cancelText: '忽略',
        type: 'info',
        icon: 'info',
        onConfirm: async () => {
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
          const storedName = (await AsyncStorage.getItem('@yiqikan_username')) || '影迷';
          if (parsed.password) {
            useRoomStore.getState().setSavedPassword(parsed.password);
            AsyncStorage.setItem(LAST_ROOM_PASSWORD_CACHE_KEY, parsed.password).catch(() => {});
          }
          AsyncStorage.setItem(LAST_ROOM_ID_CACHE_KEY, parsed.roomId).catch(() => {});
          await socketService.connect();
          socketService.joinRoom(storedName, parsed.roomId, parsed.password);
          showToast(`正在加入房间: ${parsed.roomId}`);
        },
      });
    } catch {
      // A denied automatic read is not retried during this app session; manual paste stays available.
      read.denied = true;
    } finally { read.busy = false; }
  };

  const lastUpdateCheckTimeRef = useRef<number>(0);
  const isCheckingUpdateRef = useRef<boolean>(false);

  const checkOtaUpdateAuto = async () => {
    const now = Date.now();
    // 3分钟内节流，避免在频繁切后台时重复检查
    if (otaService.isDownloading() || isCheckingUpdateRef.current || now - lastUpdateCheckTimeRef.current < 180000) {
      return;
    }
    isCheckingUpdateRef.current = true;
    lastUpdateCheckTimeRef.current = now;

    try {
      const res = await otaService.checkUpdate();
      if (res.status === 'OTA_UPDATE_AVAILABLE' && res.latestBundleVersion) {
        showConfirm({
          title: '发现新版本',
          message: `新版本 v${res.latestBundleVersion}\n\n${res.releaseNotes || '优化体验与修复已知问题'}\n\n是否立即更新？`,
          confirmText: '立即更新',
          cancelText: '稍后',
          type: 'info',
          icon: 'info',
          onConfirm: async () => {
            try {
              showToast('正在下载更新资源...');
              await otaService.downloadAndApply(res.bundleUrl, res.latestBundleVersion, res.bundleHash);
              showConfirm({
                title: '更新就绪',
                message: `新版本 v${res.latestBundleVersion} 已下载就绪，是否立即重启生效？`,
                confirmText: '立即重启',
                cancelText: '稍后生效',
                type: 'info',
                icon: 'info',
                onConfirm: async () => {
                  try {
                    await otaService.reloadApp();
                  } catch (error: any) {
                    showToast(`自动重启失败，请关闭并重新打开应用使更新生效：${error?.message || '重启失败'}`);
                  }
                },
              });
            } catch (err: any) {
              showToast('更新下载失败: ' + (err?.message || '网络异常'));
            }
          },
        });
      } else if (res.status === 'APP_UPDATE_REQUIRED') {
        if (res.forceAppUpdate) {
          setForceUpdateInfo({
            releaseNotes: res.releaseNotes || '当前版本已不再支持，请更新至最新版本以继续使用。',
            downloadUrl: res.appDownloadUrl || '',
          });
        } else {
          showConfirm({
            title: '发现新版本',
            message: res.releaseNotes || '建议更新到最新版本以获得最佳体验',
            confirmText: Platform.OS === 'ios' ? '前往 App Store' : '前往更新',
            cancelText: '稍后',
            type: 'info',
            icon: 'info',
            onConfirm: () => {
              openAppUpdate(res.appDownloadUrl).catch(error => showToast(error.message));
            },
          });
        }
      }
    } catch (e) {
      console.warn('[OTA] 自动更新检查异常:', e);
    } finally {
      isCheckingUpdateRef.current = false;
    }
  };

  useEffect(() => {
    // 1. 处理启动时的 Deep Link
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLinkUrl(url);
    });

    const linkSub = Linking.addEventListener('url', (e) => {
      if (e.url) handleDeepLinkUrl(e.url);
    });

    // 2. 延迟检查剪贴板口令（等 Socket 与界面初始化完成）
    const clipTimer = setTimeout(() => {
      checkClipboardForRoomInvite();
    }, 1000);

    // 2.1 延迟 1.2s 自动检查热更新（等待网络就绪）
    const otaTimer = setTimeout(() => {
      checkOtaUpdateAuto();
    }, 1200);

    // 3. 监听 AppState（切后台与切回前台事件）
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState.match(/inactive|background/)) {
        // 用户按 Home 键返回桌面、上滑进多任务或锁屏时，立即强行将当前播放进度刷入磁盘
        const curUrl = currentUrlRef.current;
        const curVideo = videoStateRef.current;
        if (curUrl && !curUrl.startsWith('about:blank') && curVideo.currentTime >= 5) {
          savePlaybackProgress({
            url: curUrl,
            currentTime: curVideo.currentTime,
            duration: curVideo.duration,
            title: currentHistoryItemRef.current?.title,
          }, true);
        } else {
          flushPlaybackProgress();
        }
      } else if (nextState === 'active') {
        checkClipboardForRoomInvite();
        checkOtaUpdateAuto();
      }
    });

    return () => {
      linkSub.remove();
      clearTimeout(clipTimer);
      clearTimeout(otaTimer);
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

  const searchTemplateRef = useRef('https://yandex.com/search/?text=%s');

  useEffect(() => {
    fetch(`${resolveWebUrl()}/api/search-config`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { templateUrl?: string }) => {
        if (data?.templateUrl) {
          searchTemplateRef.current = data.templateUrl;
        }
      })
      .catch(() => {});
  }, []);

  const formatInputToUrl = (input: string) => {
    const trimmed = input.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    if (/^[^\s]+\.[^\s]+$/.test(trimmed)) {
      return `https://${trimmed}`;
    }
    const template = searchTemplateRef.current || 'https://yandex.com/search/?text=%s';
    return template.includes('%s')
      ? template.replace(/%s/g, encodeURIComponent(trimmed))
      : `${template}${encodeURIComponent(trimmed)}`;
  };

  const handleSearch = async () => {
    if (searchQuery.trim()) {
      const finalUrl = formatInputToUrl(searchQuery);
      if (!roomId) {
        const storedName = (await AsyncStorage.getItem('@yiqikan_username')) || '影迷';
        socketService.createRoom(storedName, undefined, undefined);
        const unsubscribe = useRoomStore.subscribe((state) => {
          if (state.roomState?.id) {
            unsubscribe();
            socketService.sendPlayerEvent({
              roomId: state.roomState.id,
              actorId: socketService.getUserId(),
              action: 'load_url',
              url: finalUrl,
            });
          } else if (state.error) {
            unsubscribe();
          }
        });
      } else {
        socketService.sendPlayerEvent({
          roomId,
          actorId: socketService.getUserId(),
          action: 'load_url',
          url: finalUrl,
        });
      }
      setSearchQuery('');
    }
  };

  const handleUrlSubmit = () => {
    if (!urlInputValue.trim()) return;
    const finalUrl = formatInputToUrl(urlInputValue);
    if (!roomId) {
      setSoloUrl(finalUrl);
      return;
    }
    if (isHost) {
      socketService.sendPlayerEvent({
        roomId,
        actorId: socketService.getUserId(),
        action: 'load_url',
        url: finalUrl,
      });
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
    const finalUrl = formatInputToUrl(item.url);
    setUrlInputValue(finalUrl);
    if (!roomId) {
      setSoloUrl(finalUrl);
    } else if (isHost) {
      socketService.sendPlayerEvent({
        roomId,
        actorId: socketService.getUserId(),
        action: 'load_url',
        url: finalUrl,
      });
    }
    // 展开底部面板，锁定到视频 Tab！
    setActiveBottomTab('video');
    setIsPanelCollapsed(false);
    if (item.currentTime >= 10 && !item.isFinished) {
      setCurrentHistoryItem(item);
      setTargetResumeTime(item.currentTime);
      setTargetResumePercent(item.progressPercent);
      setShowResumePill(true);
    }
  };

  const handleVideoStateChange = (state: { currentTime: number; duration: number; paused: boolean }) => {
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
        title: currentHistoryItem?.title,
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
    if (roomId && !isHost) {
      showToast('只有房主可以关闭正在播放的页面返回首页');
      return;
    }

    // 0. 点击左上角 Home 按钮返回大厅前，立即强行保存最新进度
    if (currentUrl && !currentUrl.startsWith('about:blank') && videoState.currentTime >= 5) {
      savePlaybackProgress({
        url: currentUrl,
        currentTime: videoState.currentTime,
        duration: videoState.duration,
        title: currentHistoryItem?.title,
      }, true);
    }

    // 1. 立即停止 WebView 继续加载或重定向
    webviewRef.current?.stopLoading?.();

    // 2. 设置重置锁，避免后续异步 navigationStateChange 事件将重定向地址再次回传同步
    isResettingUrlRef.current = true;
    setTimeout(() => {
      isResettingUrlRef.current = false;
    }, 1500);

    // 3. 清空地址栏与单人播放地址
    setUrlInputValue('');
    setSoloUrl('');
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

  const handleToggleFullscreen = async (force?: boolean) => {
    const nextFullscreen = force !== undefined ? force : !isFullscreen;
    setIsFullscreen(nextFullscreen);

    if (nextFullscreen) {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      StatusBar.setHidden(true, 'fade');
    } else {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      StatusBar.setHidden(false, 'fade');
    }
  };

  // 当播放地址被清空时（如房主点击 Home 返回首页），自动退出全屏恢复竖屏
  useEffect(() => {
    if (!currentUrl && isFullscreen) {
      handleToggleFullscreen(false);
    }
  }, [currentUrl, isFullscreen]);

  useEffect(() => {
    // 成功启动进入首页业务，重置原生崩溃熔断计数器
    otaService.markOtaSuccess().catch(() => {});

    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
      StatusBar.setHidden(false, 'fade');
    };
  }, []);

  return (
    <>
      {/* 强制更新全屏遮罩（不可跳过） */}
      <ForceUpdateOverlay
        visible={forceUpdateInfo !== null}
        releaseNotes={forceUpdateInfo?.releaseNotes || ''}
        downloadUrl={forceUpdateInfo?.downloadUrl || ''}
      />
      <View style={styles.container}>
      {/* 统一全屏深空微光渐变画布（贯穿全局，解决切片黑块断层） */}
      {!isFullscreen && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg height="100%" width="100%">
            <Defs>
              <LinearGradient id="globalScreenBg" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor="#0c0d12" stopOpacity="1" />
                <Stop offset="30%" stopColor="#090a0e" stopOpacity="1" />
                <Stop offset="70%" stopColor="#06070a" stopOpacity="1" />
                <Stop offset="100%" stopColor="#040406" stopOpacity="1" />
              </LinearGradient>
              {/* 仅在内容主视区渲染极其克制柔和的暖调微光（原点设在25%，严禁上溢污染状态栏与通知栏） */}
              <RadialGradient id="globalContentAura" cx="50%" cy="25%" rx="70%" ry="30%">
                <Stop offset="0%" stopColor="#F97316" stopOpacity="0.08" />
                <Stop offset="50%" stopColor="#F97316" stopOpacity="0.02" />
                <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#globalScreenBg)" />
            <Rect width="100%" height="100%" fill="url(#globalContentAura)" />
          </Svg>
        </View>
      )}
      <SafeAreaView style={styles.safeArea} edges={isFullscreen ? [] : ['top', 'bottom', 'left', 'right']}>
      {/* Toast Notification */}
      {toastConfig?.message ? (
        <Animated.View style={[styles.toastContainer, { opacity: toastOpacity }]} pointerEvents="none">
          {toastConfig.type === 'success' && (
            <CheckCircle2 size={15} color="#34D399" style={styles.toastIcon} />
          )}
          <Text style={styles.toastText}>{toastConfig.message}</Text>
        </Animated.View>
      ) : null}

      {!isFullscreen && currentUrl ? (
        <BrowserToolbar 
          currentUrl={currentUrl}
          urlInputValue={urlInputValue}
          setUrlInputValue={setUrlInputValue}
          onGoBack={() => webviewRef.current?.goBack()}
          onGoForward={() => webviewRef.current?.goForward()}
          onReload={() => webviewRef.current?.reload()}
          onHome={handleHome}
          onSubmit={handleUrlSubmit}
          isHost={effectiveIsHost}
        />
      ) : !isFullscreen ? (
        <TouchableOpacity 
          style={styles.lobbyHeader} 
          activeOpacity={1}
          onPress={() => {
            if (isKeyboardVisible) Keyboard.dismiss();
          }}
        >
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
            <TouchableOpacity 
              style={styles.lobbyProfileBtn} 
              onPress={() => setIsProfileVisible(true)}
              activeOpacity={0.7}
              testID="个人中心按钮"
              accessibilityLabel="个人中心按钮"
            >
              <User color="#ddd" size={17} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      ) : null}

      <View 
        style={[
          styles.videoContainer, 
          isFullscreen && styles.fullscreenVideo,
        ]}
      >
        {currentUrl ? (
          <>
            <RoomWebView 
              ref={webviewRef}
              initialUrl={currentUrl} 
              isFullscreen={isFullscreen}
              isHost={effectiveIsHost}
              onShowToast={showToast}
              onLampPress={() => setIsPanelCollapsed(prev => !prev)}
              isPortraitPanelExpanded={!isPanelCollapsed}
              onToggleFullscreen={handleToggleFullscreen} 
              onNavigationStateChange={(canGoBack, canGoForward, navUrl) => {
                if (isResettingUrlRef.current) return;
                if (navUrl && !navUrl.startsWith('about:blank')) {
                  setUrlInputValue(navUrl);
                  if (!roomId) {
                    setSoloUrl(navUrl);
                  } else if (isHost && navUrl !== currentUrl) {
                    socketService.sendPlayerEvent({
                      roomId,
                      actorId: socketService.getUserId(),
                      action: 'load_url',
                      url: navUrl,
                    });
                  }
                }
              }}
              onVideoStateChange={handleVideoStateChange}
            />
            <ResumePlaybackPill
              visible={showResumePill && !isFullscreen}
              targetTime={targetResumeTime}
              progressPercent={targetResumePercent}
              onJump={() => handleJumpToResume(targetResumeTime)}
              onDismiss={() => setShowResumePill(false)}
            />
          </>
        ) : (
          <EmptyState 
            roomId={roomId}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            recentUrl={recentUrl}
            clipboardUrl={clipboardUrl}
            onSearch={handleSearch}
            isInRoom={!!roomState}
            onOpenProfile={() => setIsProfileVisible(true)}
            isRoomEntryOpen={!isPanelCollapsed && activeBottomTab === 'members'}
            onRoomEntry={(mode) => { setRoomEntryRequest({ mode, id: ++roomEntryRequestIdRef.current }); setActiveBottomTab('members'); setIsPanelCollapsed(false); }}
            onManageRoom={() => {
              if (isPanelCollapsed) setActiveBottomTab('members');
              setIsPanelCollapsed(prev => !prev);
            }}
            isHost={effectiveIsHost}
            lastPlayback={lastPlayback}
            onContinuePlayback={handleContinuePlayback}
          />
        )}
      </View>

      {!isFullscreen && (
        <BottomPanel 
          isPanelCollapsed={isPanelCollapsed}
          setIsPanelCollapsed={setIsPanelCollapsed}
          onToggleFullscreen={() => handleToggleFullscreen(true)}
          hasVideo={!!currentUrl}
          isInRoom={!!roomState}
          isHost={effectiveIsHost}
          activeTab={activeBottomTab}
          onTabChange={setActiveBottomTab}
          roomEntryRequest={roomEntryRequest}
          onEntryFormClose={() => { setRoomEntryRequest(undefined); if (!currentUrl) setIsPanelCollapsed(true); }}
          videoState={videoState}
          lastHistory={currentHistoryItem}
          onPlayPause={() => {
            if (!effectiveIsHost) {
              if (videoState.paused) {
                showToast('已恢复跟播房主');
                handleCatchUp();
                return;
              } else {
                useRoomStore.getState().setMemberLocalPause(true);
                webviewRef.current?.setPaused(true);
                showToast('已临时本地暂停');
                return;
              }
            }
            webviewRef.current?.setPaused(!videoState.paused);
          }}
          onSeek={(time) => {
            if (!effectiveIsHost) {
              showToast('只有房主可以调整房间进度');
              return;
            }
            webviewRef.current?.seekTo(time);
            if (showResumePill) setShowResumePill(false);
          }}
          onCatchUp={handleCatchUp}
          onRateChange={handleRateChange}
          chatMessages={chatMessages}
          chatInput={chatInput}
          setChatInput={value => { setChatInput(value); setChatSendError(null); }}
          chatSendError={chatSendError}
          onSendChat={handleSendChat}
          members={roomState?.members || []}
          hostId={roomState?.hostId || ''}
          myUserId={socketService.getUserId()}
          onLeaveRoom={handleExitRoom}
        />
      )}

      <ProfileModal
        visible={isProfileVisible}
        onClose={() => setIsProfileVisible(false)}
        onForceUpdate={(info) => setForceUpdateInfo(info)}
      />

      <ConfirmDialog
        visible={confirmDialogConfig.visible}
        title={confirmDialogConfig.title}
        message={confirmDialogConfig.message}
        confirmText={confirmDialogConfig.confirmText}
        cancelText={confirmDialogConfig.cancelText}
        type={confirmDialogConfig.type}
        icon={confirmDialogConfig.icon}
        onConfirm={confirmDialogConfig.onConfirm}
        onCancel={() => {
          confirmDialogConfig.onCancel?.();
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
        }}
      />
    </SafeAreaView>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#040406',
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  lobbyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(12, 13, 18, 0.75)',
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
  lobbyProfileBtn: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
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
    height: '100%',
  },
  toastContainer: {
    position: 'absolute',
    top: 54,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
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
  toastIcon: {
    marginRight: 7,
  },
  toastText: {
    color: '#F3F4F6',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default function RoomScreen(props: Props) {
  return (
    <VoiceProvider>
      <RoomScreenContent {...props} />
      <SafetySheet />
    </VoiceProvider>
  );
}
