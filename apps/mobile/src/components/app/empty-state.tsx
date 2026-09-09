import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Image } from 'react-native';
import { User, Clipboard as ClipboardIcon, Compass, Sparkles, Film, ArrowRight, ArrowUpRight } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { socketService } from '../../services/socket';
import { useRoomStore } from '../../store/useRoomStore';

interface EmptyStateProps {
  roomId: string;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  recentUrl: string;
  onSearch: () => void;
  isInRoom: boolean;
  onOpenProfile: () => void;
  isHost?: boolean;
}

export interface RecommendSite {
  name: string;
  url: string;
  color: string;
  tag: string;
}

export const DEFAULT_POPULAR_SITES: RecommendSite[] = [
  { name: '哔哩哔哩', url: 'https://www.bilibili.com', color: '#00AEEC', tag: 'B站' },
  { name: 'Libvio影视', url: 'https://www.libvio.app', color: '#F97316', tag: 'Libvio' },
];

const PROD_WEB_URL = 'https://yiqikan.cpolar.cn';

function resolveWebUrl(): string {
  if (process.env.EXPO_PUBLIC_WEB_URL) {
    return process.env.EXPO_PUBLIC_WEB_URL.replace(/\/+$/, '');
  }
  if (__DEV__) {
    const debuggerHost = Constants.expoConfig?.hostUri;
    if (debuggerHost) {
      const ip = debuggerHost.split(':')[0];
      if (ip) {
        return `http://${ip}:3000`;
      }
    }
  }
  return PROD_WEB_URL;
}

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

  // 当网址改变时重置状态
  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [site.url]);

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
            borderTopColor: `${siteColor}60`,
            borderBottomColor: `${siteColor}25`,
            borderLeftColor: `${siteColor}40`,
            borderRightColor: `${siteColor}40`,
            shadowColor: siteColor,
          }
        ]}
      >
        {!imageLoaded && (
          <Text style={[styles.fallbackChar, { color: siteColor }]}>
            {firstChar}
          </Text>
        )}

        {!imageError && faviconUrl ? (
          <Image
            source={{ uri: faviconUrl }}
            style={[styles.faviconImage, !imageLoaded && { opacity: 0 }]}
            onLoad={() => setImageLoaded(true)}
            onError={() => {
              setImageError(true);
              setImageLoaded(false);
            }}
            resizeMode="contain"
          />
        ) : null}
      </View>

      {/* 站点详情：标题与自适应长 Tag 徽章 */}
      <View style={styles.siteInfoContainer}>
        <View style={styles.siteTitleRow}>
          <Text style={styles.quickNavName} numberOfLines={1}>
            {site.name}
          </Text>
        </View>
        
        <View style={styles.siteSubRow}>
          {site.tag ? (
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
                {site.tag}
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
  onSearch,
  isInRoom,
  onOpenProfile,
  isHost = true,
}: EmptyStateProps) {
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const [recommendSites, setRecommendSites] = useState<RecommendSite[]>(DEFAULT_POPULAR_SITES);

  // 1. 加载本地缓存 & 同步后台最新配置的推荐站点
  useEffect(() => {
    AsyncStorage.getItem('@recommend_sites')
      .then((cached) => {
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setRecommendSites(parsed);
            }
          } catch {}
        }
      })
      .catch(() => {});

    const webUrl = resolveWebUrl();
    fetch(`${webUrl}/api/recommend-sites`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setRecommendSites(data);
          AsyncStorage.setItem('@recommend_sites', JSON.stringify(data)).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isInRoom || isHost) {
      Clipboard.getStringAsync().then((text) => {
        const trimmed = text?.trim();
        if (trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://')) && trimmed !== recentUrl) {
          setClipboardUrl(trimmed);
        }
      }).catch(() => {});
    }
  }, [isInRoom, isHost, recentUrl]);

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
        <View style={styles.brandBadge}>
          <Image 
            source={require('../../../assets/icon.png')} 
            style={{ width: 14, height: 14, borderRadius: 3, marginRight: 6 }} 
            resizeMode="contain"
          />
          <Text style={styles.brandBadgeText}>异起看 · YIQIKAN</Text>
        </View>
        <Text style={styles.emptyStateTitle}>开启跨地域同步视界</Text>
        <Text style={styles.emptyStateDesc}>
          {isInRoom 
            ? (isHost ? '输入视频网址或搜索，房间成员将实时跟播' : '正在等待房主选择并加载视频...')
            : '输入视频网址或点击推荐站点，即刻开启同步观影'
          }
        </Text>
      </View>

      <View style={styles.actionSection}>
        {/* 搜索/网址栏 */}
        <View style={[styles.searchBox, !canControl && styles.searchBoxReadOnly]}>
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

        {/* 智能剪贴板一键前往 */}
        {clipboardUrl && canControl ? (
          <TouchableOpacity 
            style={styles.clipboardBanner}
            onPress={() => {
              handleNavigateUrl(clipboardUrl);
              setClipboardUrl(null);
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

        {/* 常用站点推荐 */}
        <View style={styles.quickNavSection}>
          <View style={styles.quickNavHeader}>
            <Compass size={14} color="#F97316" style={{ marginRight: 6 }} />
            <Text style={styles.quickNavTitle}>常用影视推荐站点</Text>
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
        </View>

        {/* 上次观看历史 */}
        {recentUrl ? (
          <View style={[styles.recentUrlContainer, !canControl && { opacity: 0.5 }]}>
            <Text style={styles.recentUrlLabel}>上次播放：</Text>
            <TouchableOpacity 
              accessibilityLabel="上次播放快捷键"
              style={styles.recentUrlTag} 
              disabled={!canControl}
              onPress={() => handleNavigateUrl(recentUrl)}
              activeOpacity={0.7}
            >
              <Text style={styles.recentUrlText} numberOfLines={1}>{recentUrl}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
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
  searchBoxReadOnly: {
    opacity: 0.6,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    paddingHorizontal: 8,
    fontSize: 13.5,
    height: '100%',
  },
  searchButton: {
    backgroundColor: '#F97316',
    borderRadius: 21,
    paddingHorizontal: 20,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomColor: 'rgba(0, 0, 0, 0.30)',
    borderLeftColor: 'rgba(255, 255, 255, 0.18)',
    borderRightColor: 'rgba(255, 255, 255, 0.18)',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.50,
    shadowRadius: 8,
    elevation: 4,
  },
  searchButtonDisabled: {
    backgroundColor: 'rgba(249, 115, 22, 0.35)',
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
    marginTop: 24,
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
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    borderRightColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 12,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
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
    elevation: 2,
  },
  faviconImage: {
    position: 'absolute',
    top: 7,
    left: 7,
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
  recentUrlContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    width: '100%',
  },
  recentUrlLabel: {
    color: '#777',
    fontSize: 12,
    marginRight: 8,
  },
  recentUrlTag: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.16)',
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    borderRightColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recentUrlText: {
    color: '#F97316',
    fontSize: 12.5,
  },
});
