import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { ChevronDown, ChevronUp, Maximize, Pause, Play } from 'lucide-react-native';
import { SeekBackward10Icon, SeekForward10Icon } from '../icons/SeekStepIcons';
import { usePlaybackScrub } from '../../hooks/use-playback-scrub';
import { formatTime } from '../../utils/time';
import { APP_ACCENT, APP_BACKGROUND } from '../../theme/colors';

export function CompactPlaybackControls({ title, paused, currentTime, duration, isHost, expanded, mediaKey, sourceAction, onExpand, onPlayPause, onSeek, onFullscreen }: {
  title?: string;
  paused: boolean; currentTime: number; duration: number; isHost: boolean; expanded: boolean; mediaKey?: string;
  sourceAction?: React.ReactNode;
  onExpand: () => void; onPlayPause: () => void; onSeek: (time: number) => void; onFullscreen: () => void;
}) {
  const scrub = usePlaybackScrub({ currentTime, duration, enabled: isHost && expanded, mediaKey, onSeek });
  const status = title || (isHost ? paused ? '已暂停' : '正在播放' : paused ? '已暂停跟播' : '跟播中');
  const time = `${formatTime(scrub.displayTime)} / ${duration > 0 ? formatTime(duration) : '--:--'}`;
  const detailLabel = expanded ? '收起播放控制' : '展开播放控制';
  const DetailIcon = expanded ? ChevronDown : ChevronUp;
  const PlaybackIcon = paused ? Play : Pause;
  const info = <>
    <Text style={styles.status} numberOfLines={1}>{status}</Text>
    <View style={styles.timeRow}>
      <Text style={styles.time} numberOfLines={1}>{time}</Text>
      {sourceAction ? <DetailIcon size={12} color="#9296a2" /> : null}
    </View>
  </>;
  return (
    <View style={styles.container} testID="网页播放控制">
      <View style={styles.row}>
        <TouchableOpacity onPress={onPlayPause} style={styles.button} accessibilityLabel={isHost ? '播放暂停按钮' : paused ? '恢复跟播' : '本地暂停'}>
          <PlaybackIcon size={20} fill={APP_ACCENT} strokeWidth={0} />
        </TouchableOpacity>
        {sourceAction ? <TouchableOpacity onPress={onExpand} style={styles.info} accessibilityRole="button"
          accessibilityLabel={`${status}，${time}，${detailLabel}`} accessibilityState={{ expanded }}>{info}</TouchableOpacity> :
          <View style={styles.info}>{info}</View>}
        {sourceAction || <TouchableOpacity onPress={onExpand} style={styles.button} accessibilityLabel={detailLabel}><DetailIcon size={20} color="#b0b4bf" /></TouchableOpacity>}
        <TouchableOpacity onPress={onFullscreen} style={styles.button} accessibilityRole="button" accessibilityLabel="进入全屏"><Maximize size={20} color="#b0b4bf" /></TouchableOpacity>
      </View>
      {expanded && <View style={styles.sliderRow}>
        <TouchableOpacity accessibilityLabel="快退10秒" onPress={() => scrub.onSlidingComplete(Math.max(0, scrub.displayTime - 10))} disabled={!scrub.canSeek} style={[styles.button, !scrub.canSeek && styles.disabled]}><SeekBackward10Icon size={22} color="#b0b4bf" /></TouchableOpacity>
        <Slider accessibilityLabel={isHost ? '播放进度' : '房主控制进度'} style={styles.slider} minimumValue={0} maximumValue={scrub.maximumValue} value={scrub.sliderValue}
          disabled={!scrub.canSeek} minimumTrackTintColor="#fb923c" maximumTrackTintColor="#343844" thumbTintColor="#fb923c"
          onSlidingStart={scrub.onSlidingStart} onValueChange={scrub.onValueChange} onSlidingComplete={scrub.onSlidingComplete} />
        <TouchableOpacity accessibilityLabel="快进10秒" onPress={() => scrub.onSlidingComplete(Math.min(duration, scrub.displayTime + 10))} disabled={!scrub.canSeek} style={[styles.button, !scrub.canSeek && styles.disabled]}><SeekForward10Icon size={22} color="#b0b4bf" /></TouchableOpacity>
      </View>}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { backgroundColor: APP_BACKGROUND },
  row: { minHeight: 44, paddingLeft: 8, paddingRight: 12, flexDirection: 'row', alignItems: 'center' },
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingLeft: 4, paddingVertical: 3 },
  status: { color: '#c9cdd7', fontSize: 12, lineHeight: 17 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { flexShrink: 1, color: '#9296a2', fontSize: 11, lineHeight: 15, fontVariant: ['tabular-nums'] },
  sliderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4 },
  slider: { flex: 1, height: 44 },
  disabled: { opacity: 0.35 },
});
