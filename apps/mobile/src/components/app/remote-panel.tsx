import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Play, Pause, SkipBack, SkipForward, FastForward, Gauge, RotateCcw } from 'lucide-react-native';
import Slider from '@react-native-community/slider';
import { useRoomStore } from '../../store/useRoomStore';
import { formatTime } from '../../utils/time';

interface RemotePanelProps {
  currentTime: number;
  duration: number;
  paused: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  isHost?: boolean;
  onCatchUp?: () => void;
  onRateChange?: (rate: number) => void;
}

const PLAYBACK_RATES = [0.75, 1.0, 1.25, 1.5, 2.0];

export function RemotePanel({
  currentTime,
  duration,
  paused,
  onPlayPause,
  onSeek,
  isHost = true,
  onCatchUp,
  onRateChange,
}: RemotePanelProps) {
  const [isSliding, setIsSliding] = useState(false);
  const [slideValue, setSlideValue] = useState(0);
  const memberLocalPause = useRoomStore((state) => state.memberLocalPause);
  const currentPlaybackRate = useRoomStore((state) => state.currentPlaybackRate);

  const displayTime = isSliding ? slideValue : currentTime;

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

      {/* 主控制按键组 */}
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

      {/* 倍速选择区 */}
      <View style={styles.rateSection}>
        <View style={styles.rateHeader}>
          <Gauge size={13} color="#888" style={{ marginRight: 4 }} />
          <Text style={styles.rateLabel}>播放倍速{isHost ? ' (全员同步)' : ''}</Text>
        </View>
        <View style={styles.rateGrid}>
          {PLAYBACK_RATES.map((rate) => (
            <TouchableOpacity
              key={rate}
              accessibilityLabel={`倍速${rate}x`}
              style={[styles.rateCard, currentPlaybackRate === rate && styles.rateCardActive]}
              onPress={() => onRateChange && onRateChange(rate)}
              activeOpacity={0.7}
            >
              <Text style={[styles.rateCardText, currentPlaybackRate === rate && styles.rateCardTextActive]}>
                {rate}x
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
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
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  stepBtnText: {
    color: '#888',
    fontSize: 9.5,
    fontWeight: 'bold',
    marginTop: 1,
  },
  playBtn: {
    backgroundColor: '#F97316',
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  playBtnPaused: {
    backgroundColor: 'rgba(249, 115, 22, 0.85)',
  },
  rateSection: {
    marginTop: 2,
  },
  rateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  rateLabel: {
    color: '#777',
    fontSize: 11.5,
    fontWeight: '600',
  },
  rateGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  rateCard: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  rateCardActive: {
    backgroundColor: '#F97316',
    borderColor: '#F97316',
  },
  rateCardText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  rateCardTextActive: {
    color: '#fff',
  },
});
