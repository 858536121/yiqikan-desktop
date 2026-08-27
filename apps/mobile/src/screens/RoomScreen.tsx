import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, StatusBar, Alert, Animated, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { User, Sparkles, LogIn, PlusCircle } from 'lucide-react-native';
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
import { VoiceProvider } from '../services/voice-service';
import { otaService } from '../services/ota-service';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

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
    // 启动时静默检查热更新与版本策略
    otaService.checkUpdate().then((res) => {
      if (res.status === 'OTA_UPDATE_AVAILABLE' && res.latestBundleVersion) {
        if (res.updateMode === 'prompt') {
          showToast(`✨ 发现新版 UI (v${res.latestBundleVersion})`);
        }
        otaService.recordAppliedVersion(res.latestBundleVersion);
      } else if (res.status === 'APP_UPDATE_REQUIRED') {
        if (res.forceAppUpdate) {
          Alert.alert('发现必须更新的新版本', res.releaseNotes || '请更新至最新版本继续使用', [
            { text: '确定' }
          ]);
        }
      }
    }).catch(() => {});

    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
      StatusBar.setHidden(false, 'fade');
    };
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={isFullscreen ? [] : ['top', 'bottom', 'left', 'right']}>
      {/* Toast Notification */}
      {toastMessage ? (
        <Animated.View style={[styles.toastContainer, { opacity: toastOpacity }]}>
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
        </View>
      ) : null}

      <View style={[styles.videoContainer, isFullscreen && styles.fullscreenVideo]}>
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
        />
      )}

      <ProfileModal visible={isProfileVisible} onClose={() => setIsProfileVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d10',
  },
  lobbyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: '#141418',
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
    backgroundColor: '#000',
  },
  fullscreenVideo: {
    flex: 1,
    height: '100%',
  },
  toastContainer: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.95)',
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  toastText: {
    color: '#fff',
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

