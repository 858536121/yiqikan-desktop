import { APP_BACKGROUND } from '../../theme/colors';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft, Clock, ImagePlus, Play } from 'lucide-react-native';
import { cleanHistoryTitle, getRecentPlaybackList, historySiteName, isHistorySiteIcon, PlaybackHistoryItem } from '../../services/playback-history';
import { formatTime } from '../../utils/time';
import { AppButton } from './app-ui';
import { ViewingMemoryEditor } from './viewing-memory-editor';
import type { ViewingMemorySource } from '../../webview/viewing-memory-artwork';

function HistorySiteIcon({ item }: { item: PlaybackHistoryItem }) {
  const [failed, setFailed] = useState(false);
  const site = historySiteName(item.url);
  return <View style={styles.siteIcon} accessibilityLabel={site}>
    {!failed && isHistorySiteIcon(item.siteIcon) ? <Image testID="history-site-icon" source={{ uri: item.siteIcon }} style={styles.siteImage} resizeMode="contain" onError={() => setFailed(true)} /> : <Text style={styles.siteLetter}>{site === '本地视频' ? '影' : Array.from(site)[0]?.toUpperCase() || '影'}</Text>}
  </View>;
}

export function PlaybackHistoryPanel({ active, onBack, onPlay }: { active: boolean; onBack: () => void; onPlay: (item: PlaybackHistoryItem) => void }) {
  const [items, setItems] = useState<PlaybackHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [poster, setPoster] = useState<ViewingMemorySource | null>(null);
  useEffect(() => {
    if (!active) { setPoster(null); return; }
    let alive = true;
    getRecentPlaybackList(20).then(list => { if (alive) { setItems(list); setLoading(false); } });
    return () => { alive = false; };
  }, [active]);
  return <View style={styles.container}>
    <View style={styles.header}><TouchableOpacity onPress={onBack} style={styles.back} accessibilityLabel="返回我的"><ChevronLeft size={22} color="#fb923c" /></TouchableOpacity><Text style={styles.title}>观看历史</Text></View>
    {loading ? <ActivityIndicator style={styles.empty} color="#fb923c" /> : <ScrollView contentContainerStyle={[styles.list, !items.length && styles.empty]}>
      {!items.length ? <View style={styles.emptyContent}><Clock size={32} color="#687080" /><Text style={styles.emptyTitle}>还没有观看记录</Text><Text style={styles.subtitle}>观看后，进度会保存在这里</Text></View> : items.map((item, index) => {
        const title = cleanHistoryTitle(item.title, item.url);
        return <View key={item.url} style={styles.item}>
          <TouchableOpacity onPress={() => onPlay(item)} style={styles.play} accessibilityRole="button" accessibilityLabel={`继续观看 ${title}`}>
            <HistorySiteIcon item={item}/><View style={styles.info}><Text style={styles.itemTitle} numberOfLines={2}>{title}</Text>
              <Text style={styles.siteName} numberOfLines={1}>{historySiteName(item.url)}</Text>
              <Text style={styles.subtitle}>{item.isFinished ? '已看完' : `上次看到 ${formatTime(item.currentTime)}`}</Text>
            </View><Play size={18} color="#fb923c" />
          </TouchableOpacity>
          <AppButton icon={ImagePlus} label="海报" tone="quiet" testID={`history-poster-${index}`}
            onPress={() => setPoster({ kind: 'history', title: item.title ? title : '', date: item.updatedAt })} />
        </View>;
      })}
    </ScrollView>}
    {active && poster && <ViewingMemoryEditor source={poster} onClose={() => setPoster(null)} />}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: APP_BACKGROUND },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  back: { height: 44, width: 44, justifyContent: 'center', alignItems: 'center' },
  title: { color: '#f4f4f5', fontSize: 20, fontWeight: '600' },
  list: { padding: 20, gap: 12 },
  item: { minHeight: 80, backgroundColor: '#17191f', borderRadius: 14, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  play: { flex: 1, minWidth: 0, minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  siteIcon: { width: 48, height: 48, borderRadius: 13, backgroundColor: '#272b30', alignItems: 'center', justifyContent: 'center' },
  siteImage: { width: 30, height: 30 }, siteLetter: { color: '#b7bec7', fontSize: 21, fontWeight: '500' },
  siteName: { color: '#9da3ae', fontSize: 11 },
  info: { flex: 1, gap: 5 },
  itemTitle: { color: '#e5e7eb', fontSize: 14 },
  subtitle: { color: '#9296a2', fontSize: 12 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContent: { alignItems: 'center', gap: 10 },
  emptyTitle: { color: '#d9dce4', fontSize: 16 },
});
