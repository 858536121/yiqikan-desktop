import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { User, Clipboard as ClipboardIcon, Compass, Sparkles, Film, ArrowRight } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { socketService } from '../../services/socket';

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

const POPULAR_SITES = [
  { name: '哔哩哔哩', url: 'https://www.bilibili.com', color: '#00AEEC', tag: 'B站' },
  { name: '腾讯视频', url: 'https://v.qq.com', color: '#FF7000', tag: '企鹅' },
  { name: '爱奇艺', url: 'https://www.iqiyi.com', color: '#00CC36', tag: '奇艺' },
  { name: '优酷视频', url: 'https://www.youku.com', color: '#1482F0', tag: '优酷' },
  { name: '芒果TV', url: 'https://www.mgtv.com', color: '#FF5F00', tag: '芒果' },
  { name: '百度网盘', url: 'https://pan.baidu.com', color: '#06A7FF', tag: '网盘' },
];

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

  useEffect(() => {
    if (isInRoom && isHost) {
      Clipboard.getStringAsync().then((text) => {
        const trimmed = text?.trim();
        if (trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://')) && trimmed !== recentUrl) {
          setClipboardUrl(trimmed);
        }
      }).catch(() => {});
    }
  }, [isInRoom, isHost, recentUrl]);

  const handleNavigateUrl = (url: string) => {
    if (!isHost || !roomId || !url) return;
    socketService.sendPlayerEvent({
      roomId,
      actorId: socketService.getUserId(),
      action: 'load_url',
      url,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.emptyStateContainer} keyboardShouldPersistTaps="handled">
      {!isInRoom && (
        <TouchableOpacity style={styles.profileBtn} onPress={onOpenProfile}>
          <User color="#888" size={24} />
        </TouchableOpacity>
      )}

      {/* 顶部品牌与房间态 */}
      <View style={styles.headerSection}>
        <View style={styles.brandBadge}>
          <Sparkles size={12} color="#F97316" style={{ marginRight: 4 }} />
          <Text style={styles.brandBadgeText}>异起看 · YIQIKAN</Text>
        </View>
        <Text style={styles.emptyStateTitle}>开启跨地域同步视界</Text>
        <Text style={styles.emptyStateDesc}>
          {isInRoom 
            ? (isHost ? '输入视频网址或搜索，房间成员将实时跟播' : '正在等待房主选择并加载视频...')
            : '异起看提供极简流畅的跨端异地同步观影体验'
          }
        </Text>
      </View>

      {isInRoom ? (
        <View style={styles.actionSection}>
          {/* 房主搜索/网址栏 */}
          <View style={[styles.searchBox, !isHost && styles.searchBoxReadOnly]}>
            <Film size={18} color={isHost ? "#F97316" : "#666"} style={{ marginLeft: 14, marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder={isHost ? "输入直接网址，或输入关键词搜索..." : "等待房主导航..."}
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={onSearch}
              autoCapitalize="none"
              autoCorrect={false}
              editable={isHost}
            />
            {isHost && (
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
          {clipboardUrl && isHost ? (
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
              {POPULAR_SITES.map((site) => (
                <TouchableOpacity
                  key={site.name}
                  style={[styles.quickNavCard, !isHost && styles.quickNavCardDisabled]}
                  disabled={!isHost}
                  onPress={() => handleNavigateUrl(site.url)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.quickNavBadge, { backgroundColor: site.color }]}>
                    <Text style={styles.quickNavBadgeText}>{site.tag}</Text>
                  </View>
                  <Text style={styles.quickNavName}>{site.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* 上次观看历史 */}
          {recentUrl ? (
            <View style={[styles.recentUrlContainer, !isHost && { opacity: 0.5 }]}>
              <Text style={styles.recentUrlLabel}>上次播放：</Text>
              <TouchableOpacity 
                style={styles.recentUrlTag} 
                disabled={!isHost}
                onPress={() => handleNavigateUrl(recentUrl)}
                activeOpacity={0.7}
              >
                <Text style={styles.recentUrlText} numberOfLines={1}>{recentUrl}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}
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
    gap: 8,
  },
  quickNavCard: {
    width: '31.5%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  quickNavCardDisabled: {
    opacity: 0.5,
  },
  quickNavBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  quickNavBadgeText: {
    color: '#fff',
    fontSize: 10.5,
    fontWeight: 'bold',
  },
  quickNavName: {
    color: '#eee',
    fontSize: 12,
    fontWeight: '500',
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
