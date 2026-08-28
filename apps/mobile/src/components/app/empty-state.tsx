import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, Image } from 'react-native';
import { User, Clipboard as ClipboardIcon, Compass, Sparkles, Film, ArrowRight } from 'lucide-react-native';
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

  return (
    <TouchableOpacity
      style={[styles.quickNavCard, disabled && styles.quickNavCardDisabled]}
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* 站点 Logo 容器：图片加载成功时只展示纯净图片；图片失败或未加载完时展示首字徽章 */}
      <View 
        style={[
          styles.quickNavBadge, 
          { 
            backgroundColor: `${site.color || '#F97316'}20`,
            borderColor: `${site.color || '#F97316'}40`,
          }
        ]}
      >
        {!imageLoaded && (
          <Text style={[styles.fallbackChar, { color: site.color || '#F97316' }]}>
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
                  backgroundColor: `${site.color || '#F97316'}18`,
                  borderColor: `${site.color || '#F97316'}40`,
                }
              ]}
            >
              <Text 
                style={[styles.tagBadgeText, { color: site.color || '#F97316' }]} 
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
    <ScrollView contentContainerStyle={styles.emptyStateContainer} keyboardShouldPersistTaps="handled">
      {/* 顶部品牌与房间态 */}
      <View style={styles.headerSection}>
        <View style={styles.brandBadge}>
          <Image 
            source={require('../../../assets/icon.png')} 
            style={{ width: 14, height: 14, borderRadius: 3, marginRight: 5 }} 
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
  );
}

const styles = StyleSheet.create({
  emptyStateContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0d0d10',
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    marginBottom: 12,
  },
  brandBadgeText: {
    color: '#F97316',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  emptyStateTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateDesc: {
    color: '#8e8e98',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 320,
  },
  profileBtn: {
    position: 'absolute',
    top: 20,
    right: 20,
    padding: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
    height: 48,
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
    paddingHorizontal: 18,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonDisabled: {
    backgroundColor: 'rgba(249, 115, 22, 0.4)',
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
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(249, 115, 22, 0.1)',
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
    gap: 2,
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
  },
  quickNavTitle: {
    color: '#aaa',
    fontSize: 12.5,
    fontWeight: '600',
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
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 11,
  },
  quickNavCardDisabled: {
    opacity: 0.5,
  },
  quickNavBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 9,
    overflow: 'hidden',
    position: 'relative',
  },
  faviconImage: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  fallbackChar: {
    fontSize: 14,
    fontWeight: 'bold',
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
    color: '#eee',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  siteSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
    borderWidth: 0.5,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  tagBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  domainText: {
    color: '#666',
    fontSize: 10.5,
    fontFamily: 'monospace',
  },
  recentUrlContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    width: '100%',
  },
  recentUrlLabel: {
    color: '#777',
    fontSize: 12,
    marginRight: 8,
  },
  recentUrlTag: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  recentUrlText: {
    color: '#F97316',
    fontSize: 13,
  },
});
