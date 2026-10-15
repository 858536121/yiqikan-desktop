import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Play, Pause, SkipBack, SkipForward, FastForward, Clock, X } from 'lucide-react-native';
import Slider from '@react-native-community/slider';
import { useRoomStore } from '../../store/useRoomStore';
import { formatTime } from '../../utils/time';
import { PlaybackHistoryItem } from '../../services/playback-history';

interface RemotePanelProps {
  currentTime: number;
  duration: number;
  paused: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  isHost?: boolean;
  onCatchUp?: () => void;
  lastHistory?: PlaybackHistoryItem | null;
}

export function RemotePanel({
  currentTime,
  duration,
  paused,
  onPlayPause,
  onSeek,
  isHost = true,
  onCatchUp,
  lastHistory,
}: RemotePanelProps) {
  const [isSliding, setIsSliding] = useState(false);
  const [slideValue, setSlideValue] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const memberLocalPause = useRoomStore((state) => state.memberLocalPause);

  const displayTime = isSliding ? slideValue : currentTime;

  // 当视频链接改变时，重置关闭状态
  useEffect(() => {
    setIsDismissed(false);
  }, [lastHistory?.url]);

  // 是否展示断点续播条：用户未手动关闭、有历史记录且历史大于10秒，且当前播放进度未到达该断点
  const showResumeCallout = Boolean(
    !isDismissed &&
    lastHistory &&
    lastHistory.currentTime >= 10 &&
    (lastHistory.currentTime - currentTime > 12 || currentTime < 10)
  );

  return (
    <View style={styles.container}>
      {/* 顶部跟播/控制权限状态条 */}
      <View style={styles.statusHeader}>
        {isHost ? (
          <View style={styles.hostStatusBadge}>
            <Text style={styles.hostStatusText}>👑 你是房主 · 正在掌控全房间播放进度</Text>
          </View>
        ) : memberLocalPause ? (
          <View style={styles.pausedStatusBadge}>
            <Text style={styles.pausedStatusText}>已临时本地暂停</Text>
            {onCatchUp && (
              <TouchableOpacity style={styles.catchUpBtn} onPress={onCatchUp} activeOpacity={0.7}>
                <FastForward size={12} color="#fff" style={{ marginRight: 3 }} />
                <Text style={styles.catchUpBtnText}>追赶房主</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.memberStatusBadge}>
            <Text style={styles.memberStatusText}>📡 跟播模式 · 进度已与房主实时对齐</Text>
          </View>
        )}
      </View>

      {/* 进度条与时间 */}
      <View style={styles.sliderRow}>
        {(() => {
          const shouldShowHours = duration >= 3600 || displayTime >= 3600;
          return (
            <>
              <Text style={styles.timeText}>{formatTime(displayTime, shouldShowHours)}</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={duration || 1}
                value={displayTime}
                minimumTrackTintColor="#F97316"
                maximumTrackTintColor="rgba(255, 255, 255, 0.15)"
                thumbTintColor="#F97316"
                onValueChange={(val) => {
                  setIsSliding(true);
                  setSlideValue(val);
                }}
                onSlidingComplete={(val) => {
                  setIsSliding(false);
                  onSeek(val);
                }}
              />
              <Text style={styles.durationText}>{formatTime(duration, shouldShowHours)}</Text>
            </>
          );
        })()}
      </View>

      {/* 主控制按键组（快退10s、播放/暂停、快进10s） */}
      <View style={styles.controlsRow}>
        <TouchableOpacity 
          accessibilityLabel="快退10秒"
          style={styles.stepBtn} 
          onPress={() => onSeek(Math.max(0, currentTime - 10))}
          activeOpacity={0.7}
        >
          <SkipBack color="#ccc" size={22} />
          <Text style={styles.stepBtnText}>-10s</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          accessibilityLabel="播放暂停按钮"
          style={[styles.playBtn, paused && styles.playBtnPaused]} 
          onPress={onPlayPause}
          activeOpacity={0.8}
        >
          {paused ? (
            <Play color="#fff" size={28} fill="#fff" style={{ marginLeft: 3 }} />
          ) : (
            <Pause color="#fff" size={28} fill="#fff" />
          )}
        </TouchableOpacity>
        
        <TouchableOpacity 
          accessibilityLabel="快进10秒"
          style={styles.stepBtn} 
          onPress={() => onSeek(Math.min(duration || 99999, currentTime + 10))}
          activeOpacity={0.7}
        >
          <SkipForward color="#ccc" size={22} />
          <Text style={styles.stepBtnText}>+10s</Text>
        </TouchableOpacity>
      </View>

      {/* 断点续播常驻引导卡片 */}
      {showResumeCallout && lastHistory && (
        <View style={styles.resumeCallout}>
          <View style={styles.resumeIconBadge}>
            <Clock size={15} color="#F97316" />
          </View>
          <View style={styles.resumeInfo}>
            <Text style={styles.resumeTitle}>
              上次看到 <Text style={styles.resumeTime}>{formatTime(lastHistory.currentTime)}</Text>
              {lastHistory.progressPercent > 0 ? ` (${lastHistory.progressPercent}%)` : ''}
            </Text>
            <Text style={styles.resumeDesc}>
              {isHost ? '点击一键同步全房间跳转' : '点击对齐上次观看进度'}
            </Text>
          </View>
          <TouchableOpacity
            testID="面板一键跳转续播按钮"
            accessibilityLabel="面板一键跳转续播"
            style={styles.resumeBtn}
            onPress={() => onSeek(lastHistory.currentTime)}
            activeOpacity={0.8}
          >
            <Text style={styles.resumeBtnText}>跳转续播</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="关闭面板续播卡片按钮"
            accessibilityLabel="关闭续播提示"
            style={styles.resumeCloseBtn}
            onPress={() => setIsDismissed(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
          >
            <X size={14} color="#888" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'space-between',
    backgroundColor: '#121215',
  },
  statusHeader: {
    alignItems: 'center',
    marginBottom: 4,
  },
  hostStatusBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  hostStatusText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '600',
  },
  memberStatusBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
  },
  memberStatusText: {
    color: '#888',
    fontSize: 11,
  },
  pausedStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
  },
  pausedStatusText: {
    color: '#F97316',
    fontSize: 11.5,
    fontWeight: '600',
    marginRight: 8,
  },
  catchUpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F97316',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  catchUpBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  timeText: {
    color: '#aaa',
    fontSize: 11.5,
    fontFamily: 'monospace',
    width: 44,
    textAlign: 'center',
  },
  durationText: {
    color: '#777',
    fontSize: 11.5,
    fontFamily: 'monospace',
    width: 44,
    textAlign: 'center',
  },
  slider: {
    flex: 1,
    height: 32,
    marginHorizontal: 4,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    gap: 20,
  },
  stepBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  stepBtnText: {
    color: '#888',
    fontSize: 9.5,
    fontWeight: 'bold',
    marginTop: 1,
  },
  playBtn: {
    backgroundColor: '#F97316',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderTopWidth: 1,
  },
  playBtnPaused: {
    backgroundColor: 'rgba(249, 115, 22, 0.85)',
  },
  resumeCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderWidth: 1,
    borderTopColor: 'rgba(249, 115, 22, 0.35)',
    borderBottomColor: 'rgba(249, 115, 22, 0.15)',
    borderLeftColor: 'rgba(249, 115, 22, 0.2)',
    borderRightColor: 'rgba(249, 115, 22, 0.2)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 6,
  },
  resumeIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(249, 115, 22, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  resumeInfo: {
    flex: 1,
  },
  resumeTitle: {
    color: '#E4E4E7',
    fontSize: 12.5,
    fontWeight: '600',
  },
  resumeTime: {
    color: '#F97316',
    fontWeight: '700',
  },
  resumeDesc: {
    color: '#888',
    fontSize: 10.5,
    marginTop: 1,
  },
  resumeBtn: {
    backgroundColor: '#F97316',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 6,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    borderTopColor: 'rgba(255, 255, 255, 0.3)',
    borderTopWidth: 1,
  },
  resumeBtnText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '700',
  },
  resumeCloseBtn: {
    padding: 6,
    marginLeft: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
