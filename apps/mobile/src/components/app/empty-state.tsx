import { roomInvite } from '../../services/room-invite';
import { useVoice } from '../../services/voice-service';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Image, Platform } from 'react-native';
import { User, Clipboard as ClipboardIcon, Compass, Sparkles, Film, ArrowRight, ArrowUpRight, Clock, Play, PlusCircle, LogIn, Copy, Users } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { socketService } from '../../services/socket';
import { useRoomStore } from '../../store/useRoomStore';
import { resolveWebUrl } from '../../services/environment';
import { formatTime } from '../../utils/time';
import { PlaybackHistoryItem } from '../../services/playback-history';
import { RoomActionButton } from './room-action-button';

interface EmptyStateProps {
  roomId: string;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  recentUrl: string;
  clipboardUrl?: string | null;
  onSearch: () => void;
  isInRoom: boolean;
  onOpenProfile: () => void;
  isRoomEntryOpen?: boolean;
  onRoomEntry: (mode: 'create' | 'join') => void;
  onManageRoom: () => void;
  isHost?: boolean;
  lastPlayback?: PlaybackHistoryItem | null;
  onContinuePlayback?: (item: PlaybackHistoryItem) => void;
}

export interface RecommendSite {
  name: string;
  url: string;
  color: string;
  tag: string;
}

export const DEFAULT_POPULAR_SITES: RecommendSite[] = [
  { name: '哔哩哔哩', url: 'https://www.bilibili.com', color: '#00AEEC', tag: 'B站' },
];


function getDomainFromUrl(urlStr: string): string {
  try {
    const formatted = urlStr.startsWith('http') ? urlStr : `https://${urlStr}`;
    const urlObj = new URL(formatted);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function getFaviconUrl(urlStr: string): string {
  try {
    const formatted = urlStr.startsWith('http') ? urlStr : `https://${urlStr}`;
    const urlObj = new URL(formatted);
    return `${urlObj.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

function RecommendSiteCard({
  site,
  disabled,
  onPress,
}: {
  site: RecommendSite;
  disabled: boolean;
  onPress: () => void;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const domain = getDomainFromUrl(site.url);
  const faviconUrl = getFaviconUrl(site.url);
  
  // 提取首字符（自动过滤开头的括号与空格，如 '【首推】Libvio' -> '首', 'Libvio' -> 'L'）
  const cleanName = (site.name || site.tag || '影').replace(/^[【\[\(（\s]+/, '');
  const firstChar = (cleanName.charAt(0) || '影').toUpperCase();

  // 净化 Tag 文字：去除全角/半角方括号与圆括号（如 'Lib【首推】' -> 'Lib首推'，'【首推】' -> '首推'）
  // 杜绝思源黑体（Android）在西文与全角括号拼接处自带的左侧大空白，并避免多余括号导致换行截断
  const displayTag = (site.tag || '').replace(/[【】\[\]（）\(\)]/g, '').trim();

  // 当网址改变时安全预加载图片，成功后才渲染 Image，彻底避免 Android Fresco opacity:0 渲染黑色占位方块的底层 Bug
  useEffect(() => {
    let isMounted = true;
    if (!faviconUrl) {
      setImageLoaded(false);
      setImageError(true);
      return;
    }
    setImageLoaded(false);
    setImageError(false);

    Image.prefetch(faviconUrl)
      .then(() => {
        if (isMounted) setImageLoaded(true);
      })
      .catch(() => {
        if (isMounted) setImageError(true);
      });

    return () => {
      isMounted = false;
    };
  }, [faviconUrl]);

  const siteColor = site.color || '#F97316';
  const glowId = `cardGlow_${cleanName.replace(/[^a-zA-Z0-9]/g, '_')}`;

  return (
    <TouchableOpacity
      testID={`推荐站点-${site.name}`}
      accessibilityLabel={`推荐站点-${site.name}`}
      style={[
        styles.quickNavCard, 
        disabled && styles.quickNavCardDisabled
      ]}
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.72}
    >
      {/* 卡片右上角极细腻的主题色柔光晕（真正径向渐变，零硬边缘） */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id={glowId} cx="95%" cy="5%" rx="75%" ry="75%">
            <Stop offset="0%" stopColor={siteColor} stopOpacity="0.2" />
            <Stop offset="45%" stopColor={siteColor} stopOpacity="0.06" />
            <Stop offset="100%" stopColor={siteColor} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${glowId})`} rx="16" />
      </Svg>

      {/* 站点 Logo 容器：毛玻璃渐变微发光底座 */}
      <View 
        style={[
          styles.quickNavBadge, 
          { 
            backgroundColor: `${siteColor}20`,
            borderColor: Platform.OS === 'android' ? `${siteColor}40` : undefined,
            borderTopColor: Platform.OS !== 'android' ? `${siteColor}60` : undefined,
            borderBottomColor: Platform.OS !== 'android' ? `${siteColor}25` : undefined,
            borderLeftColor: Platform.OS !== 'android' ? `${siteColor}40` : undefined,
            borderRightColor: Platform.OS !== 'android' ? `${siteColor}40` : undefined,
            shadowColor: siteColor,
          }
        ]}
      >
        {imageLoaded && !imageError && faviconUrl ? (
          <Image
            source={{ uri: faviconUrl }}
            style={styles.faviconImage}
            onError={() => {
              setImageError(true);
              setImageLoaded(false);
            }}
            resizeMode="contain"
          />
        ) : (
          <Text style={[styles.fallbackChar, { color: siteColor }]}>
            {firstChar}
          </Text>
        )}
      </View>

      {/* 站点详情：标题与自适应长 Tag 徽章 */}
      <View style={styles.siteInfoContainer}>
        <View style={styles.siteTitleRow}>
          <Text style={styles.quickNavName} numberOfLines={1}>
            {site.name}
          </Text>
        </View>
        
        <View style={styles.siteSubRow}>
          {displayTag ? (
            <View 
              style={[
                styles.tagBadge, 
                { 
                  backgroundColor: `${siteColor}18`,
                  borderColor: `${siteColor}35`,
                }
              ]}
            >
              <Text 
                style={[styles.tagBadgeText, { color: siteColor }]} 
                numberOfLines={1}
              >
                {displayTag}
              </Text>
            </View>
          ) : domain ? (
            <Text style={styles.domainText} numberOfLines={1}>
              {domain}
            </Text>
          ) : null}
        </View>
      </View>

      <ArrowUpRight size={13} color="rgba(255, 255, 255, 0.22)" style={styles.cardArrow} />
    </TouchableOpacity>
  );
}


export function EmptyState({
  roomId,
  searchQuery,
  setSearchQuery,
  recentUrl,
  clipboardUrl,
  onSearch,
  isInRoom,
  onOpenProfile,
  onRoomEntry,
  isRoomEntryOpen = false,
  onManageRoom,
  isHost = true,
  lastPlayback,
  onContinuePlayback,
}: EmptyStateProps) {
  const [dismissedClipboardUrl, setDismissedClipboardUrl] = useState<string | null>(null);
  const [recommendSites, setRecommendSites] = useState<RecommendSite[]>(DEFAULT_POPULAR_SITES);

  // 1. 加载本地缓存 & 同步后台最新配置的推荐站点
  useEffect(() => {
    let active = true;
    let remoteLoaded = false;
    AsyncStorage.getItem('@recommend_sites')
      .then((cached) => {
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (active && !remoteLoaded && Array.isArray(parsed)) {
              setRecommendSites(parsed);
            }
          } catch {}
        }
      })
      .catch(() => {});

    const webUrl = resolveWebUrl();
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    fetch(`${webUrl}/api/recommend-sites?platform=${platform}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && Array.isArray(data)) {
          remoteLoaded = true;
          setRecommendSites(data);
          AsyncStorage.setItem('@recommend_sites', JSON.stringify(data)).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);


  const handleNavigateUrl = async (url: string) => {
    if (!url) return;
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
            url,
          });
        } else if (state.error) {
          unsubscribe();
        }
      });
      return;
    }
    if (!isHost) return;
    socketService.sendPlayerEvent({
      roomId,
      actorId: socketService.getUserId(),
      action: 'load_url',
      url,
    });
  };

  const canControl = !isInRoom || isHost;
  const room = useRoomStore(state => state.roomState);
  const connected = useRoomStore(state => state.isConnected);
  const savedPassword = useRoomStore(state => state.savedPassword);
  const { voiceStatus } = useVoice();
  const voiceLabel = { idle: '语音未开启', connecting: '语音连接中', connected: '语音已连接', reconnecting: '语音重连中', error: '语音连接异常' }[voiceStatus];
  const invite = async () => {
    if (!room) return;
    try {
      await Clipboard.setStringAsync(roomInvite(room.id, room.hasPassword, savedPassword, resolveWebUrl()));
      useRoomStore.getState().showToast('邀请已复制，可发给 TA');
    } catch { useRoomStore.getState().showToast('复制失败，请从房间管理查看房间号'); }
  };

  return (
    <View style={styles.containerRoot}>
      {/* 沉浸式电影放映厅局部环境微光（零硬边缘，纯净克制） */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="heroBloom" cx="50%" cy="18%" rx="75%" ry="40%">
            <Stop offset="0%" stopColor="#F97316" stopOpacity="0.08" />
            <Stop offset="45%" stopColor="#F97316" stopOpacity="0.02" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#heroBloom)" />
      </Svg>

      <ScrollView contentContainerStyle={styles.emptyStateContainer} keyboardShouldPersistTaps="handled">

      {/* 顶部品牌与房间态 */}
      <View style={styles.headerSection}>
        <Text style={styles.emptyStateTitle}>{isInRoom ? (!connected ? '正在重新连接房间' : (room?.members.length ?? 0) <= 1 ? '房间已准备，等待 TA 加入' : '你们已在同一房间') : '千里同屏，与 TA 一起看'}</Text>
        <Text style={styles.emptyStateDesc}>
          {isInRoom 
            ? (isHost ? '输入视频网址或搜索，房间成员将实时跟播' : '正在等待房主选择并加载视频...')
            : '建好房间，邀请 TA，异地也能一起看'
          }
        </Text>
      </View>

      {isInRoom && <View style={styles.roomCard}>
        <View style={styles.roomWaitingInfo}>
          <Text style={styles.roomStatus}>
            房间 <Text style={styles.roomCode}>{roomId}</Text> · {room?.members.length ?? 0} 位成员
          </Text>
          <View style={styles.roomDetailRow}>
            <View style={styles.roomVoiceStatus}>
              <View style={[styles.roomVoiceDot, voiceStatus === 'connected' && styles.roomVoiceDotActive]} />
              <Text style={styles.roomDetailText}>{voiceLabel}</Text>
            </View>
            <Text style={styles.roomDetailText}>{room?.hasPassword ? '已设密码' : '未设密码'}</Text>
          </View>
        </View>
        <View style={styles.roomInlineActions}>
          <RoomActionButton
            primary
            compact
            icon={Copy}
            title="邀请"
            testID="home-copy-invite"
            accessibilityLabel="复制邀请给 TA"
            disabled={!connected}
            onPress={invite}
          />
          <RoomActionButton
            compact
            icon={Users}
            title="管理"
            testID="home-manage-room"
            accessibilityLabel="房间管理"
            onPress={onManageRoom}
          />
        </View>
      </View>}
      <View style={styles.actionSection}>
        {/* 搜索/网址栏 */}
        <View style={[styles.searchBox, !canControl && styles.searchBoxReadOnly]}>
          <View style={[StyleSheet.absoluteFill, styles.searchSurface]} pointerEvents="none">
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="homeSearchSurface" x1="0%" y1="0%" x2="100%" y2="100%">
                  <Stop offset="0" stopColor="#252526" />
                  <Stop offset="0.5" stopColor="#1B1B1D" />
                  <Stop offset="1" stopColor="#151517" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#homeSearchSurface)" />
            </Svg>
          </View>
          <Film size={18} color={canControl ? "#F97316" : "#666"} style={{ marginLeft: 14, marginRight: 8 }} />
          <TextInput
            accessibilityLabel="视频网址或搜索输入框"
            style={styles.searchInput}
            placeholder={canControl ? "输入直接网址，或输入关键词搜索..." : "等待房主导航..."}
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={onSearch}
            autoCapitalize="none"
            autoCorrect={false}
            editable={canControl}
          />
          {canControl && (
            <TouchableOpacity 
              accessibilityLabel="搜索或前往按钮"
              style={[styles.searchButton, !searchQuery.trim() && styles.searchButtonDisabled]} 
              onPress={onSearch} 
              disabled={!searchQuery.trim()}
              activeOpacity={0.8}
            >
              <View style={[StyleSheet.absoluteFill, styles.searchButtonSurface]} pointerEvents="none">
                <Svg width="100%" height="100%">
                  <Defs>
                    <LinearGradient id="homeSearchButton" x1="0%" y1="0%" x2="100%" y2="100%">
                      <Stop offset="0" stopColor="#FF8A28" />
                      <Stop offset="0.55" stopColor="#FF7412" />
                      <Stop offset="1" stopColor="#F56608" />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height="100%" fill="url(#homeSearchButton)" />
                </Svg>
              </View>
              <Text style={styles.searchButtonText}>
                {(() => {
                  const trimmed = searchQuery.trim();
                  const isUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') || /^[^\s]+\.[^\s]+$/.test(trimmed);
                  return isUrl ? '前往' : '搜索';
                })()}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 房间入口紧接搜索栏，保持与推荐站点一致的双列布局 */}
        {!isInRoom && !isRoomEntryOpen && <View style={[styles.roomActions, styles.homeRoomActions]}>
          <RoomActionButton primary icon={PlusCircle} testID="home-create-room" title="创建房间" subtitle="建好后邀请 TA 一起看" onPress={() => onRoomEntry('create')} />
          <RoomActionButton icon={LogIn} testID="home-join-room" title="加入房间" subtitle="输入房间号或邀请口令" onPress={() => onRoomEntry('join')} />
        </View>}

        {/* 智能剪贴板一键前往 */}
        {clipboardUrl && clipboardUrl !== dismissedClipboardUrl && canControl ? (
          <TouchableOpacity 
            style={styles.clipboardBanner}
            onPress={() => {
              handleNavigateUrl(clipboardUrl);
              setDismissedClipboardUrl(clipboardUrl);
            }}
            activeOpacity={0.8}
          >
            <ClipboardIcon size={14} color="#F97316" style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.clipboardHint}>检测到剪贴板中的链接：</Text>
              <Text style={styles.clipboardUrlText} numberOfLines={1}>{clipboardUrl}</Text>
            </View>
            <View style={styles.quickOpenBtn}>
              <Text style={styles.quickOpenBtnText}>打开</Text>
              <ArrowRight size={12} color="#fff" />
            </View>
          </TouchableOpacity>
        ) : null}

        {/* 上次观看 / 继续观看紧凑胶囊（优先展示上次播放进度，操作路径最短） */}
        {(lastPlayback || recentUrl) ? (
          <View style={[styles.recentCapsuleWrapper, !canControl && { opacity: 0.5 }]}>
            <TouchableOpacity
              testID="首页继续观看胶囊"
              accessibilityLabel="继续上次播放"
              style={styles.recentCapsule}
              disabled={!canControl}
              onPress={() => {
                if (lastPlayback && onContinuePlayback) {
                  onContinuePlayback(lastPlayback);
                } else if (recentUrl) {
                  handleNavigateUrl(recentUrl);
                }
              }}
              activeOpacity={0.78}
            >
              <View style={styles.recentCapsuleLeft}>
                <View style={styles.recentCapsuleIconBadge}>
                  <Clock size={12} color="#F97316" />
                </View>
                <View style={styles.recentCapsuleTextWrap}>
                  <Text style={styles.recentCapsuleTitle} numberOfLines={1}>
                    {lastPlayback?.title || recentUrl}
                  </Text>
                  {lastPlayback && lastPlayback.currentTime >= 10 ? (
                    <Text style={styles.recentCapsuleSub}>
                      {lastPlayback.isFinished 
                        ? '已看完' 
                        : `上次看到 ${formatTime(lastPlayback.currentTime)}${lastPlayback.progressPercent > 0 ? ` · 已看 ${lastPlayback.progressPercent}%` : ''}`}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.recentCapsuleAction}>
                <Text style={styles.recentCapsuleActionText}>
                  {lastPlayback?.isFinished ? '重看' : '继续'}
                </Text>
                <Play size={10} color="#F97316" fill="#F97316" style={{ marginLeft: 2 }} />
              </View>

              {/* 底部 2px 微进度条 */}
              {lastPlayback && lastPlayback.progressPercent > 0 ? (
                <View
                  style={[
                    styles.recentCapsuleProgress, 
                    { width: `${Math.min(100, lastPlayback.progressPercent)}%` }
                  ]} 
                />
              ) : null}
            </TouchableOpacity>
          </View>
        ) : null}

        {/* 推荐站点 */}
        {recommendSites.length > 0 && <View style={styles.quickNavSection}>
          <View style={styles.quickNavHeader}>
            <Compass size={14} color="#F97316" style={{ marginRight: 6 }} />
            <Text style={styles.quickNavTitle}>推荐站点</Text>
          </View>
          <View style={styles.quickNavGrid}>
            {recommendSites.map((site, idx) => (
              <RecommendSiteCard
                key={`${site.name}-${idx}`}
                site={site}
                disabled={!canControl}
                onPress={() => handleNavigateUrl(site.url)}
              />
            ))}
          </View>
        </View>}
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  roomActions: { flexDirection: 'row', gap: 10, width: '100%', maxWidth: 440, marginVertical: 12 },
  homeRoomActions: { marginTop: 16, marginBottom: 0 },
  roomCard: { width: '100%', maxWidth: 440, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, borderRadius: 14, backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff16' },
  roomWaitingInfo: { flex: 1, minWidth: 0 },
  roomStatus: { color: '#a1a1aa', fontSize: 12, lineHeight: 18 },
  roomCode: { color: '#e4e4e7', fontWeight: '600' },
  roomDetailRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2, marginTop: 4 },
  roomVoiceStatus: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  roomVoiceDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#71717a' },
  roomVoiceDotActive: { backgroundColor: '#4ade80' },
  roomDetailText: { color: '#90909a', fontSize: 11, lineHeight: 16 },
  roomInlineActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  containerRoot: {
    flex: 1,
    backgroundColor: 'transparent',
    position: 'relative',
  },
  emptyStateContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'transparent',
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 26,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.28)',
    paddingHorizontal: 13,
    paddingVertical: 5.5,
    borderRadius: 18,
    marginBottom: 14,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  brandBadgeText: {
    color: '#F97316',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  emptyStateTitle: {
    color: '#ffffff',
    fontSize: 23,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  emptyStateDesc: {
    color: '#9090a0',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 320,
  },
  profileBtn: {
    position: 'absolute',
    top: 20,
    right: 20,
    padding: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  actionSection: {
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#1B1B1D',
    borderRadius: 26,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderRightColor: 'rgba(255, 255, 255, 0.08)',
    paddingRight: 5,
    height: 52,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  searchSurface: {
    borderRadius: 25,
    overflow: 'hidden',
  },
  searchBoxReadOnly: {
    opacity: 0.6,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: '#fff',
    paddingHorizontal: 8,
    fontSize: 13.5,
    height: '100%',
  },
  searchButton: {
    backgroundColor: '#FF7412',
    borderRadius: 21,
    paddingHorizontal: 20,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Platform.OS === 'android' ? '#FFA65B' : undefined,
    borderTopColor: Platform.OS !== 'android' ? '#FFD0A0' : undefined,
    borderBottomColor: Platform.OS !== 'android' ? '#B95212' : undefined,
    borderLeftColor: Platform.OS !== 'android' ? '#FFA65B' : undefined,
    borderRightColor: Platform.OS !== 'android' ? '#F58A39' : undefined,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.42,
    shadowRadius: 10,
    elevation: Platform.OS === 'android' ? 0 : 4,
  },
  searchButtonSurface: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  searchButtonDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13.5,
  },
  clipboardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.28)',
  },
  clipboardHint: {
    color: '#aaa',
    fontSize: 11,
    marginBottom: 2,
  },
  clipboardUrlText: {
    color: '#F97316',
    fontSize: 12.5,
    fontWeight: '600',
  },
  quickOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F97316',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginLeft: 8,
    gap: 3,
  },
  quickOpenBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  quickNavSection: {
    width: '100%',
    marginTop: 12,
  },
  quickNavHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 6,
  },
  quickNavTitle: {
    color: '#aaa',
    fontSize: 12.5,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  quickNavGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  quickNavCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 145,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.10)' : undefined,
    borderTopColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.22)' : undefined,
    borderBottomColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.04)' : undefined,
    borderLeftColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.08)' : undefined,
    borderRightColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.06)' : undefined,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 12,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: Platform.OS === 'android' ? 0 : 3,
  },
  quickNavCardDisabled: {
    opacity: 0.5,
  },
  quickNavBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    overflow: 'hidden',
    position: 'relative',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: Platform.OS === 'android' ? 0 : 2,
  },
  faviconImage: {
    width: 22,
    height: 22,
    borderRadius: 4,
  },
  fallbackChar: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  siteInfoContainer: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  siteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  quickNavName: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: '600',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  siteSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  tagBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  domainText: {
    color: '#666',
    fontSize: 10.5,
    fontFamily: 'monospace',
  },
  cardArrow: {
    marginLeft: 4,
  },
  recentCapsuleWrapper: {
    marginTop: 16,
    width: '100%',
  },
  recentCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.16)',
    borderBottomColor: 'rgba(249, 115, 22, 0.22)',
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    borderRightColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: 'relative',
    overflow: 'hidden',
  },
  recentCapsuleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  recentCapsuleIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(249, 115, 22, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  recentCapsuleTextWrap: {
    flex: 1,
  },
  recentCapsuleTitle: {
    color: '#E4E4E7',
    fontSize: 12,
    fontWeight: '600',
  },
  recentCapsuleSub: {
    color: '#888',
    fontSize: 10,
    marginTop: 1,
  },
  recentCapsuleAction: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
  },
  recentCapsuleActionText: {
    color: '#F97316',
    fontSize: 11,
    fontWeight: '700',
  },
  recentCapsuleProgress: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2,
    backgroundColor: '#F97316',
  },
});
