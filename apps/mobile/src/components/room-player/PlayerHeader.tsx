import React from 'react';
import { Animated, StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ChevronLeft, Lock, Mic, MicOff, MessageSquareText, PictureInPicture2 } from 'lucide-react-native';
import { FULLSCREEN_PIP_ICON_SIZE } from '../../webview/contracts';
import { styles } from './styles';

interface Props {
  showControls: boolean;
  hudOpacityAnim: Animated.Value;
  videoTitle: string;
  roomState: { id: string; hasPassword?: boolean } | null;
  showMic: boolean;
  isVoiceReconnecting: boolean;
  isMuted: boolean;
  stats: { isLocalSpeaking?: boolean };
  toggleMute: () => void;
  resetTimers: () => void;
  isDanmakuEnabled: boolean;
  setIsDanmakuEnabled: (enabled: boolean) => void;
  isLandscapeDrawerOpen: boolean;
  setIsLandscapeDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onExitFullscreen: () => void;
  reserveWebPip?: boolean;
  onPictureInPicture?: () => void;
}
export function PlayerHeader({ showControls, hudOpacityAnim, videoTitle, roomState, showMic, isVoiceReconnecting, isMuted, stats,
  toggleMute, resetTimers, isDanmakuEnabled, setIsDanmakuEnabled, isLandscapeDrawerOpen, setIsLandscapeDrawerOpen,
  onExitFullscreen, reserveWebPip, onPictureInPicture }: Props) {
  return (
        <Animated.View
          pointerEvents={showControls ? 'box-none' : 'none'}
          accessibilityElementsHidden={!showControls}
          importantForAccessibility={showControls ? 'auto' : 'no-hide-descendants'}
          style={[
            styles.fullscreenTopBar,
            { opacity: hudOpacityAnim }
          ]}
        >
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs><LinearGradient id="player-header-shade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000" stopOpacity={0.6} />
              <Stop offset="1" stopColor="#000" stopOpacity={0} />
            </LinearGradient></Defs>
            <Rect width="100" height="100" fill="url(#player-header-shade)" />
          </Svg>
          <TouchableOpacity
            style={styles.hudIconBtn}
            accessibilityLabel="退出播放器全屏"
            testID="player-exit-fullscreen"
            onPress={onExitFullscreen}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.6}
          >
            <ChevronLeft color="#fff" size={28} />
          </TouchableOpacity>

          <View style={styles.topBarTitleGroup} pointerEvents="none">
            <Text style={styles.topBarTitle} numberOfLines={1}>
              {videoTitle}
            </Text>
            {roomState && (
              <View style={styles.roomBadge}>
                {roomState.hasPassword && <Lock size={12} color="#F97316" style={{ marginRight: 4 }} />}
                <Text style={styles.roomBadgeText}>房间 {roomState.id}</Text>
              </View>
            )}
          </View>

          {reserveWebPip && <View style={[styles.fullscreenActionButton, styles.fullscreenPipSlot]} pointerEvents="none" />}
          {onPictureInPicture && (
            <TouchableOpacity style={[styles.fullscreenActionButton, styles.fullscreenPipSlot, styles.fullscreenPipButtonSurface]}
              onPress={onPictureInPicture} testID="player-system-pip" accessibilityLabel="系统小窗" accessibilityRole="button">
              <PictureInPicture2 color="#fff" size={FULLSCREEN_PIP_ICON_SIZE} />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.danmakuToggleBtn,
              isDanmakuEnabled ? styles.danmakuToggleBtnActive : styles.danmakuToggleBtnMuted,
            ]}
            onPress={() => {
              setIsDanmakuEnabled(!isDanmakuEnabled);
              resetTimers();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            activeOpacity={0.7}
            accessibilityLabel="弹幕开关"
            testID="弹幕开关"
          >
            <Text style={[styles.danmakuToggleText, isDanmakuEnabled ? styles.danmakuToggleTextActive : styles.danmakuToggleTextMuted]}>
              弹
            </Text>
            {!isDanmakuEnabled && <View style={styles.danmakuToggleSlash} />}
          </TouchableOpacity>

          {showMic && (
            <TouchableOpacity
              style={[
                styles.fullscreenMicButton,
                isMuted ? styles.hudIconBtnMuted : stats.isLocalSpeaking ? styles.hudIconBtnSpeaking : null,
                isVoiceReconnecting && { opacity: 0.6 },
              ]}
              onPress={() => {
                toggleMute();
                resetTimers();
              }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              activeOpacity={0.7}
            >
              {isMuted ? (
                <MicOff color="#FB7185" size={20} />
              ) : (
                <Mic color={stats.isLocalSpeaking ? "#4ADE80" : "#E4E4E7"} size={20} />
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.fullscreenActionButton, isLandscapeDrawerOpen && styles.hudIconBtnActive]}
            onPress={() => {
              setIsLandscapeDrawerOpen(prev => !prev);
            }}
            activeOpacity={0.7}
            accessibilityLabel="横屏互动抽屉按钮"
            testID="横屏互动抽屉按钮"
          >
            <MessageSquareText color={isLandscapeDrawerOpen ? "#F97316" : "#fff"} size={20} />
          </TouchableOpacity>
        </Animated.View>
  );
}
