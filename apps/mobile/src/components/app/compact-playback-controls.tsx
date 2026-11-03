import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { ChevronDown, ChevronUp, Pause, Play } from 'lucide-react-native';
import { RotateToLandscapeIcon } from '../icons/ScreenRotationIcons';
import { SeekBackward10Icon, SeekForward10Icon } from '../icons/SeekStepIcons';
import { usePlaybackScrub } from '../../hooks/use-playback-scrub';
import { formatTime } from '../../utils/time';

export function CompactPlaybackControls({ title, paused, currentTime, duration, isHost, expanded, mediaKey, onExpand, onPlayPause, onSeek, onFullscreen }: {
  title?: string;
  paused: boolean; currentTime: number; duration: number; isHost: boolean; expanded: boolean; mediaKey?: string;
  onExpand: () => void; onPlayPause: () => void; onSeek: (time: number) => void; onFullscreen: () => void;
}) {
  const scrub = usePlaybackScrub({ currentTime, duration, enabled: isHost && expanded, mediaKey, onSeek });
  return (
    <View style={styles.container} testID="网页播放控制">
      <View style={styles.row}>
        <TouchableOpacity onPress={onPlayPause} style={styles.button} accessibilityLabel={isHost ? '播放暂停按钮' : paused ? '恢复跟播' : '本地暂停'}>
          {paused ? <Play size={20} color="#fb923c" /> : <Pause size={20} color="#fb923c" />}
        </TouchableOpacity>
        <View style={styles.info}><Text style={styles.status} numberOfLines={1}>{title || (isHost ? paused ? '已暂停' : '正在播放' : paused ? '已暂停跟播' : '跟播中')}</Text><Text style={styles.time} numberOfLines={1}>{formatTime(scrub.displayTime)} / {duration > 0 ? formatTime(duration) : '--:--'}</Text></View>
        <TouchableOpacity onPress={onFullscreen} style={styles.button} accessibilityLabel="切换横竖屏按钮"><RotateToLandscapeIcon size={20} color="#b0b4bf" /></TouchableOpacity>
        <TouchableOpacity onPress={onExpand} style={styles.button} accessibilityLabel={expanded ? '收起播放控制' : '展开播放控制'}>{expanded ? <ChevronDown size={20} color="#b0b4bf" /> : <ChevronUp size={20} color="#b0b4bf" />}</TouchableOpacity>
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
  container: { backgroundColor: '#0c0d12' },
  row: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0, paddingLeft: 4, paddingVertical: 3 },
  status: { color: '#c9cdd7', fontSize: 12, lineHeight: 17 },
  time: { color: '#9296a2', fontSize: 11, lineHeight: 15, fontVariant: ['tabular-nums'] },
  sliderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4 },
  slider: { flex: 1, height: 44 },
  disabled: { opacity: 0.35 },
});
