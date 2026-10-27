import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft, Clock, Play } from 'lucide-react-native';
import { cleanHistoryTitle, getRecentPlaybackList, historySiteName, isHistorySiteIcon, PlaybackHistoryItem } from '../../services/playback-history';
import { formatTime } from '../../utils/time';

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
  useEffect(() => {
    if (!active) return;
    let alive = true;
    getRecentPlaybackList(20).then(list => { if (alive) { setItems(list); setLoading(false); } });
    return () => { alive = false; };
  }, [active]);
  return <View style={styles.container}>
    <View style={styles.header}><TouchableOpacity onPress={onBack} style={styles.back} accessibilityLabel="返回我的"><ChevronLeft size={22} color="#fb923c" /></TouchableOpacity><Text style={styles.title}>观看历史</Text></View>
    {loading ? <ActivityIndicator style={styles.empty} color="#fb923c" /> : <ScrollView contentContainerStyle={[styles.list, !items.length && styles.empty]}>
      {!items.length ? <View style={styles.emptyContent}><Clock size={32} color="#687080" /><Text style={styles.emptyTitle}>还没有观看记录</Text><Text style={styles.subtitle}>观看后，进度会保存在这里</Text></View> : items.map(item => <TouchableOpacity key={item.url} onPress={() => onPlay(item)} style={styles.item} accessibilityLabel={`继续观看 ${cleanHistoryTitle(item.title, item.url)}`}>
        <HistorySiteIcon item={item}/><View style={styles.info}><Text style={styles.itemTitle} numberOfLines={2}>{cleanHistoryTitle(item.title, item.url)}</Text><Text style={styles.siteName} numberOfLines={1}>{historySiteName(item.url)}</Text><Text style={styles.subtitle}>{item.isFinished ? '已看完' : `上次看到 ${formatTime(item.currentTime)}`}</Text></View><Play size={18} color="#fb923c" />
      </TouchableOpacity>)}
    </ScrollView>}
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0d12' },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  back: { height: 44, width: 44, justifyContent: 'center', alignItems: 'center' },
  title: { color: '#f4f4f5', fontSize: 20, fontWeight: '600' },
  list: { padding: 20, gap: 12 },
  item: { minHeight: 80, backgroundColor: '#17191f', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
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
