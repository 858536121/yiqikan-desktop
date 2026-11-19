import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ArrowUpRight, Bookmark, Pause, Play, X } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { appControlColors as colors } from '../../theme/colors';
import { AppButton, AppIconButton } from './app-ui';

const cinemaCover = require('../../../assets/watchlist-cinema.jpg');

export function WatchlistCover({ children, tall = false }: { children: React.ReactNode; tall?: boolean }) {
  return <View style={[styles.cover, tall && styles.tallCover]}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
      <Image source={cinemaCover} resizeMode="cover" accessible={false} style={styles.coverImage} />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="coverFade" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor="#191019" stopOpacity={0.06} />
            <Stop offset="0.48" stopColor="#191019" stopOpacity={0.13} />
            <Stop offset="1" stopColor="#171117" stopOpacity={0.93} />
          </LinearGradient>
          <LinearGradient id="coverTextShade" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0" stopColor="#161017" stopOpacity={0.72} />
            <Stop offset="0.65" stopColor="#161017" stopOpacity={0.26} />
            <Stop offset="1" stopColor="#161017" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#coverTextShade)" />
        <Rect width="100%" height="100%" fill="url(#coverFade)" />
      </Svg>
    </View>
    {children}
  </View>;
}

export function WatchlistProfileEntry({ onPress }: { onPress: () => void }) {
  return <Pressable testID="watchlist-profile-entry" accessibilityRole="button" accessibilityLabel="片单"
    onPress={onPress} android_ripple={{ color: '#FFFFFF1B' }} style={({ pressed }) => [styles.profileEntry, pressed && styles.pressed]}>
    <WatchlistCover>
      <View style={styles.profileContent}>
        <View style={styles.profileMark}><Bookmark size={19} strokeWidth={1.8} color={colors.accent} /></View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>片单</Text>
          <Text style={styles.profileSubtitle}>想看的，留到下次</Text>
        </View>
        <ArrowUpRight size={20} strokeWidth={1.9} color={colors.paper} />
      </View>
    </WatchlistCover>
  </Pressable>;
}

export function WatchlistSelectionBar({ listName, video, saving, playback, onConfirm, onCancel }: {
  listName: string;
  video?: string;
  saving: boolean;
  playback?: { paused: boolean; onToggle: () => void };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = !!video && width / fontScale < 320;
  const cancel = <AppIconButton label="取消选片" icon={X} color={colors.warmMuted} onPress={onCancel} testID="watchlist-select-cancel" />;
  const confirm = video ? <AppButton label="加入并返回" tone="primary" busy={saving} onPress={onConfirm} testID="watchlist-select-confirm" /> : null;
  return <View style={styles.selection} testID="watchlist-selection">
    <View style={styles.selectionRow}>
      {playback && <AppIconButton label={playback.paused ? '播放视频' : '暂停视频'} icon={playback.paused ? Play : Pause}
        onPress={playback.onToggle} color={colors.accent} />}
      <View style={styles.selectionCopy}>
        <Text accessibilityRole="header" style={styles.selectionTitle} numberOfLines={2} textBreakStrategy="simple">选片存入 · {listName}</Text>
        <Text style={styles.selectionVideo} numberOfLines={1}>{video || '打开视频或对应剧集'}</Text>
      </View>
      {!stacked && confirm}
      {cancel}
    </View>
    {stacked && <View style={styles.selectionActions}>{confirm}</View>}
  </View>;
}

const styles = StyleSheet.create({
  selection: { backgroundColor: '#1E1820', paddingLeft: 8, paddingRight: 4, paddingVertical: 5 },
  selectionRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 4 },
  selectionCopy: { flex: 1, minWidth: 0, gap: 3, paddingHorizontal: 6, paddingVertical: 2 },
  selectionTitle: { color: colors.paper, fontSize: 13, fontWeight: '700' },
  selectionVideo: { color: colors.warmMuted, fontSize: 12 },
  selectionActions: { alignItems: 'flex-end', paddingRight: 8, paddingTop: 3 },
  cover: { minHeight: 80, borderRadius: 22, overflow: 'hidden', backgroundColor: '#2B1924' },
  tallCover: { minHeight: 226 },
  coverImage: { width: '100%', height: '100%' },
  pressed: { opacity: 0.77 },
  profileEntry: { marginBottom: 8, borderRadius: 22, overflow: 'hidden' },
  profileContent: { minHeight: 84, paddingHorizontal: 15, paddingVertical: 11, gap: 12, flexDirection: 'row', alignItems: 'center' },
  profileMark: { height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14,
    backgroundColor: '#FCB38424', borderWidth: StyleSheet.hairlineWidth, borderColor: '#F9BD8E55' },
  profileCopy: { flex: 1, minWidth: 0, gap: 4 },
  profileTitle: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  profileSubtitle: { color: colors.warmMuted, fontSize: 12 },
});
