import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export function PlayerTransitionNotice({ phase, isHost, isFollowingHost, hasReadyVideo = false, episodeLabel, onConfirm, onRetry }: {
  phase: 'loading' | 'choose'; isHost: boolean; isFollowingHost: boolean; hasReadyVideo?: boolean; episodeLabel?: string; onConfirm: () => void; onRetry?: () => void;
}) {
  const loading = phase === 'loading';
  return <View style={styles.notice} testID="player-media-transition" pointerEvents={loading ? 'none' : 'auto'}>
    {loading && <ActivityIndicator size="small" color="#fb923c" style={styles.spinner} />}
    <Text style={styles.text} numberOfLines={2}>
      {loading ? '正在切换视频…' : isHost ? '视频暂未就绪，请在网页中重试'
        : isFollowingHost ? hasReadyVideo ? '视频已打开，暂未完成同步' : '视频加载较慢，就绪后自动同步'
        : `请打开对应${episodeLabel || '影片或集数'}`}
    </Text>
    {!loading && !isHost && isFollowingHost && onRetry && <TouchableOpacity style={styles.confirm} onPress={onRetry} testID="player-retry-media" accessibilityLabel="重试切换视频">
      <Text style={styles.confirmText}>重试</Text>
    </TouchableOpacity>}
    {!loading && !isHost && !isFollowingHost && <TouchableOpacity style={styles.confirm} onPress={onConfirm} testID="player-confirm-media" accessibilityLabel="已选好，继续同步">
      <Text style={styles.confirmText}>继续同步</Text>
    </TouchableOpacity>}
  </View>;
}

const styles = StyleSheet.create({
  notice: { position: 'absolute', top: 12, alignSelf: 'center', maxWidth: '90%', minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(23,26,34,0.94)', zIndex: 65 },
  spinner: { width: 16, height: 16, transform: [{ scale: 0.75 }] },
  text: { flexShrink: 1, color: '#e4e4e7', fontSize: 12, lineHeight: 17 },
  confirm: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(249,115,22,0.12)', flexShrink: 0 },
  confirmText: { color: '#fb923c', fontSize: 12, fontWeight: '600' },
});
