import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, StatusBar, Alert, Animated, Text, TouchableOpacity, ScrollView, Image, Keyboard, Platform, Linking, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Clipboard from 'expo-clipboard';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { User, Sparkles, LogIn, PlusCircle, CheckCircle2 } from 'lucide-react-native';
import { RootStackParamList } from '../navigation/AppNavigator';
import RoomWebView, { RoomWebViewRef } from '../components/RoomWebView';
import { useRoomStore } from '../store/useRoomStore';
import { socketService } from '../services/socket';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BrowserToolbar } from '../components/app/browser-toolbar';
import { EmptyState } from '../components/app/empty-state';
import { BottomPanel } from '../components/app/bottom-panel';
import { ProfileModal } from '../components/app/profile-modal';
import { MembersPanel } from '../components/app/members-panel';
import { ForceUpdateOverlay } from '../components/app/force-update-overlay';
import { VoiceProvider } from '../services/voice-service';
import { otaService } from '../services/ota-service';
import { mobileTelemetry } from '../services/telemetry';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect } from 'react-native-svg';


type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

function parseRoomInvitation(text: string): { roomId: string; password?: string } | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  let roomId: string | null = null;
  let password: string | undefined = undefined;

  // 1. 口令格式：￥0808￥ 或 #0808#
  const tokenMatch = trimmed.match(/[￥#]([a-zA-Z0-9_-]{2,32})[￥#]/);
  if (tokenMatch) {
    roomId = tokenMatch[1];
  } else {
    // 2. URL 格式：yiqikan://room/0808 或 https://.../join/0808 或 .../room/0808
    const urlMatch = trimmed.match(/(?:yiqikan:\/\/room\/|https?:\/\/[^\/]+\/(?:room|join)\/)([a-zA-Z0-9_-]{2,32})/i);
    if (urlMatch) {
      roomId = urlMatch[1];
    }
  }

  if (!roomId) return null;

  // 提取密码（优先 URL 参数 ?password=xxx，其次 中文 "密码：xxx" 或 "password: xxx"）
  const urlPwdMatch = trimmed.match(/[?&]password=([^&\s#￥]+)/i);
  if (urlPwdMatch) {
    password = decodeURIComponent(urlPwdMatch[1]);
  } else {
    const textPwdMatch = trimmed.match(/(?:密码|pwd|password)[：:\s=]+([a-zA-Z0-9_-]+)/i);
    if (textPwdMatch) {
      password = textPwdMatch[1];
    }
  }

  return { roomId, password };
}

function RoomScreenContent({ route, navigation }: Props) {
  const roomState = useRoomStore((state) => state.roomState);
  const roomId = roomState?.id || '';
  
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [urlInputValue, setUrlInputValue] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [videoState, setVideoState] = useState({ currentTime: 0, duration: 0, paused: true });
  const [isProfileVisible, setIsProfileVisible] = useState(false);
  const [forceUpdateInfo, setForceUpdateInfo] = useState<{ releaseNotes: string; downloadUrl: string } | null>(null);

  // 软键盘状态与底部表单焦点追踪
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isBottomFormFocused, setIsBottomFormFocused] = useState(false);
  
  const webviewRef = useRef<RoomWebViewRef>(null);
  
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const isHost = useRoomStore((state) => state.isHost);
  const currentUrl = roomState?.playback?.url || '';
  const [recentUrl, setRecentUrl] = useState('');
  
  const [toastMessage, setToastMessage] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
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
      }).start(() => setToastMessage(''));
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

  // Load recent URL on mount
  useEffect(() => {
    AsyncStorage.getItem('@recent_url').then(url => {
      if (url) setRecentUrl(url);
    }).catch(e => console.log('Failed to load recent url', e));
  }, []);

  // Save current URL when it changes
  useEffect(() => {
    if (currentUrl && !currentUrl.startsWith('about:blank')) {
      AsyncStorage.setItem('@recent_url', currentUrl).catch(e => console.log('Failed to save recent url', e));
    }
  }, [currentUrl]);

  // Connect socket on mount
  useEffect(() => {
    socketService.connect();
  }, []);

  useEffect(() => {
    mobileTelemetry.setRoomState(Boolean(roomId), roomId || null);
  }, [roomId]);

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
    await socketService.connect();
    socketService.joinRoom(storedName, targetRoomId, targetPassword);
  };

  const checkClipboardForRoomInvite = async () => {
    try {
      const hasString = await Clipboard.hasStringAsync();
      if (!hasString) return;

      const content = await Clipboard.getStringAsync();
      if (!content || content === lastCheckedTokenRef.current) return;

      const parsed = parseRoomInvitation(content);
      if (!parsed) return;

      lastCheckedTokenRef.current = content;

      if (useRoomStore.getState().roomState?.id === parsed.roomId) {
        return;
      }

      Alert.alert(
        '发现房间邀请',
        `检测到好友邀请口令，是否立即加入放映房间「${parsed.roomId}」？`,
        [
          { text: '忽略', style: 'cancel' },
          {
            text: '立即加入',
            onPress: async () => {
              const storedName = (await AsyncStorage.getItem('@yiqikan_username')) || '影迷';
              await socketService.connect();
              socketService.joinRoom(storedName, parsed.roomId, parsed.password);
              showToast(`正在加入房间: ${parsed.roomId}`);
            },
          },
        ]
      );
    } catch {
      // 忽略剪贴板读取失败
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

    // 3. 监听从后台切回前台事件
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkClipboardForRoomInvite();
      }
    });

    return () => {
      linkSub.remove();
      clearTimeout(clipTimer);
      appStateSub.remove();
    };
  }, []);

  // 监听软键盘弹出与隐藏
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
      setIsBottomFormFocused(false);
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
    fetch('https://yiqikan.cpolar.cn/api/search-config', { cache: 'no-store' })
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
    if (urlInputValue.trim() && isHost && roomId) {
      const finalUrl = formatInputToUrl(urlInputValue);
      socketService.sendPlayerEvent({
        roomId,
        actorId: socketService.getUserId(),
        action: 'load_url',
        url: finalUrl,
      });
    }
  };

  const handleExitRoom = () => {
    socketService.leaveRoom(roomId);
    setUrlInputValue('');
    setSearchQuery('');
  };

  const handleSendChat = () => {
    if (chatInput.trim()) {
      socketService.sendChatMessage(roomId, chatInput.trim());
      setChatInput('');
    }
  };

  const handleHome = () => {
    if (isHost && roomId) {
      socketService.sendPlayerEvent({
        roomId,
        actorId: socketService.getUserId(),
        action: 'load_url',
        url: '',
      });
      setUrlInputValue('');
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

  useEffect(() => {
    // 成功启动进入首页业务，重置原生崩溃熔断计数器
    otaService.markOtaSuccess().catch(() => {});

    // 启动时自动检查热更新与下载安装
    otaService.checkUpdate().then(async (res) => {
      if (res.status === 'OTA_UPDATE_AVAILABLE' && res.latestBundleVersion && res.bundleUrl) {
        try {
          // 真正执行后台下载、MD5 完整性校验与解压安装
          await otaService.downloadAndApply(res.bundleUrl, res.latestBundleVersion, res.bundleHash);
          if (res.updateMode === 'prompt') {
            Alert.alert(
              'UI 热更新就绪',
              `已成功下载最新版本 (v${res.latestBundleVersion})。\n${res.releaseNotes || '优化体验与修复已知问题'}\n\n是否立即重启应用生效？`,
              [
                { text: '稍后生效' },
                {
                  text: '立即重启',
                  onPress: () => {
                    otaService.reloadApp();
                  },
                },
              ]
            );
          } else {
            showToast(`✨ 新版 UI (v${res.latestBundleVersion}) 已就绪，下次启动生效`);
          }
        } catch (e) {
          console.warn('[OTA] 自动热更下载失败:', e);
        }
      } else if (res.status === 'APP_UPDATE_REQUIRED') {
        if (res.forceAppUpdate) {
          // 全屏遮罩，不可跳过
          setForceUpdateInfo({
            releaseNotes: res.releaseNotes || '当前版本已不再支持，请更新至最新版本以继续使用。',
            downloadUrl: res.appDownloadUrl || '',
          });
        } else {
          // 非强制：弹窗提醒可跳过
          Alert.alert(
            '发现新版本',
            res.releaseNotes || '建议更新到最新版本以获得最佳体验',
            [
              { text: '稍后' },
              {
                text: '前往下载',
                onPress: () => {
                  if (res.appDownloadUrl) {
                    Linking.openURL(res.appDownloadUrl).catch(() => {});
                  }
                },
              },
            ]
          );
        }
      }
    }).catch(() => {});

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
      {toastMessage ? (
        <Animated.View style={[styles.toastContainer, { opacity: toastOpacity }]} pointerEvents="none">
          <CheckCircle2 size={15} color="#34D399" style={styles.toastIcon} />
          <Text style={styles.toastText}>{toastMessage}</Text>
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
          isHost={isHost}
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
                <Text style={styles.roomStatusText}>房号 {roomState.id}</Text>
              </View>
            )}
            <TouchableOpacity 
              style={styles.lobbyProfileBtn} 
              onPress={() => setIsProfileVisible(true)}
              activeOpacity={0.7}
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
          (!roomId && isBottomFormFocused && isKeyboardVisible) && { display: 'none' }
        ]}
      >
        {currentUrl ? (
          <RoomWebView 
            ref={webviewRef}
            initialUrl={currentUrl} 
            isFullscreen={isFullscreen}
            isHost={isHost}
            onShowToast={showToast}
            onLampPress={() => setIsPanelCollapsed(prev => !prev)}
            isPortraitPanelExpanded={!isPanelCollapsed}
            onToggleFullscreen={handleToggleFullscreen} 
            onNavigationStateChange={(canGoBack, canGoForward, navUrl) => {
              if (navUrl && !navUrl.startsWith('about:blank')) {
                setUrlInputValue(navUrl);
                if (isHost && navUrl !== currentUrl) {
                  socketService.sendPlayerEvent({
                    roomId,
                    actorId: socketService.getUserId(),
                    action: 'load_url',
                    url: navUrl,
                  });
                }
              }
            }}
            onVideoStateChange={setVideoState}
          />
        ) : (
          <EmptyState 
            roomId={roomId}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            recentUrl={recentUrl}
            onSearch={handleSearch}
            isInRoom={!!roomState}
            onOpenProfile={() => setIsProfileVisible(true)}
            isHost={isHost}
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
          isHost={isHost}
          videoState={videoState}
          onPlayPause={() => {
            if (!isHost) {
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
            if (!isHost) {
              showToast('只有房主可以调整房间进度');
              return;
            }
            webviewRef.current?.seekTo(time);
          }}
          onCatchUp={handleCatchUp}
          onRateChange={handleRateChange}
          chatMessages={chatMessages}
          chatInput={chatInput}
          setChatInput={setChatInput}
          onSendChat={handleSendChat}
          members={roomState?.members || []}
          hostId={roomState?.hostId || ''}
          myUserId={socketService.getUserId()}
          onLeaveRoom={handleExitRoom}
          isKeyboardVisible={isKeyboardVisible}
          onFormFocusChange={(focused) => setIsBottomFormFocused(focused)}
        />
      )}

      <ProfileModal
        visible={isProfileVisible}
        onClose={() => setIsProfileVisible(false)}
        onForceUpdate={(info) => setForceUpdateInfo(info)}
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
    </VoiceProvider>
  );
}

