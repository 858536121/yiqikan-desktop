import React from 'react';
import { Animated, StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import Slider from '@react-native-community/slider';
import { Play, Pause, Minimize2 } from 'lucide-react-native';
import { SeekBackward10Icon, SeekForward10Icon } from '../icons/SeekStepIcons';
import { formatTime } from '../../utils/time';
import type { usePlaybackScrub } from '../../hooks/use-playback-scrub';
import { styles } from './styles';

const PLAYBACK_RATES = [0.75, 1.0, 1.25, 1.5, 2.0];
interface Props {
  showControls: boolean;
  hudOpacityAnim: Animated.Value;
  videoState: { paused: boolean; duration: number };
  handleTogglePlayPause: () => void;
  resetTimers: () => void;
  scrub: ReturnType<typeof usePlaybackScrub>;
  displayTime: number;
  showHours: boolean;
  idleTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  isHost: boolean;
  showRateMenu: boolean;
  setShowRateMenu: React.Dispatch<React.SetStateAction<boolean>>;
  currentPlaybackRate: number;
  handleSelectPlaybackRate: (rate: number) => void;
  onExitFullscreen: () => void;
}
export function PlayerTransport({ showControls, hudOpacityAnim, videoState, handleTogglePlayPause, resetTimers,
  scrub, displayTime, showHours, idleTimerRef, isHost, showRateMenu, setShowRateMenu, currentPlaybackRate,
  handleSelectPlaybackRate, onExitFullscreen }: Props) {
  return (
        <Animated.View
          pointerEvents={showControls ? 'box-none' : 'none'}
          style={[
            styles.fullscreenBottomBar,
            { opacity: hudOpacityAnim }
          ]}
        >
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs><LinearGradient id="player-footer-shade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000" stopOpacity={0} />
              <Stop offset="1" stopColor="#000" stopOpacity={0.7} />
            </LinearGradient></Defs>
            <Rect width="100" height="100" fill="url(#player-footer-shade)" />
          </Svg>
          <View style={styles.controlsRow}>
            {/* 播放/暂停 */}
            <TouchableOpacity
              style={styles.playPauseBtn}
              testID="player-toggle-play-pause"
              accessibilityLabel={videoState.paused ? '播放视频' : '暂停视频'}
              onPress={() => { handleTogglePlayPause(); resetTimers(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              {videoState.paused ? <Play color="#fff" size={22} fill="#fff" /> : <Pause color="#fff" size={22} fill="#fff" />}
            </TouchableOpacity>

            {/* 快退 10s */}
            <TouchableOpacity
              style={styles.smallHudBtn}
              accessibilityLabel="快退 10 秒"
              disabled={!scrub.canSeek}
              onPress={() => scrub.onSlidingComplete(Math.max(0, displayTime - 10))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <SeekBackward10Icon color="#ccc" size={22} />
            </TouchableOpacity>

            {/* 当前时间 */}
            <Text style={styles.timeLabel}>{formatTime(displayTime, showHours)}</Text>

            {/* 进度条 */}
            <Slider
              style={styles.hudSlider}
              disabled={!scrub.canSeek}
              minimumValue={0}
              maximumValue={scrub.maximumValue}
              value={scrub.sliderValue}
              minimumTrackTintColor="#F97316"
              maximumTrackTintColor="rgba(255,255,255,0.2)"
              thumbTintColor="#F97316"
              onSlidingStart={(val) => {
                scrub.onSlidingStart(val);
                if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
              }}
              onValueChange={scrub.onValueChange}
              onSlidingComplete={scrub.onSlidingComplete}
            />

            {/* 总时长 */}
            <Text style={styles.durationLabel}>{formatTime(videoState.duration, showHours)}</Text>

            {/* 快进 10s */}
            <TouchableOpacity
              style={styles.smallHudBtn}
              disabled={!scrub.canSeek}
              accessibilityLabel="快进 10 秒"
              onPress={() => scrub.onSlidingComplete(Math.min(videoState.duration, displayTime + 10))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <SeekForward10Icon color="#ccc" size={22} />
            </TouchableOpacity>

            {/* 倍速切换按钮 */}
            <TouchableOpacity
              style={[styles.rateBtn, showRateMenu && styles.rateBtnActive]}
              disabled={!isHost}
              onPress={() => {
                setShowRateMenu(!showRateMenu);
                resetTimers();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Text style={styles.rateBtnText}>{currentPlaybackRate}x</Text>
            </TouchableOpacity>

            {/* 退出全屏 */}
            <TouchableOpacity
              style={styles.smallHudBtn}
              accessibilityLabel="退出播放器全屏"
              onPress={onExitFullscreen}
              hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
              activeOpacity={0.6}
            >
              <Minimize2 color="#fff" size={20} />
            </TouchableOpacity>
          </View>

          {/* 倍速弹出选择列表 */}
          {showRateMenu && (
            <View style={styles.rateMenuContainer}>
              {PLAYBACK_RATES.map(rate => (
                <TouchableOpacity
                  key={rate}
                  style={[styles.rateMenuItem, currentPlaybackRate === rate && styles.rateMenuItemActive]}
                  onPress={() => handleSelectPlaybackRate(rate)}
                >
                  <Text style={[styles.rateMenuItemText, currentPlaybackRate === rate && styles.rateMenuItemTextActive]}>
                    {rate}x
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Animated.View>
  );
}
