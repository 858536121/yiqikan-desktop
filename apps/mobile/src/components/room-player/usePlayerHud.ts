import { useState, useRef, useCallback, useEffect } from 'react';
import { Animated, PanResponder } from 'react-native';
import type { GestureAxis } from '../../utils/fullscreen-gesture';
import type { usePlaybackScrub } from '../../hooks/use-playback-scrub';
import type { RefObject } from 'react';

const IDLE_FULLSCREEN_LAMP_OPACITY = 0.8;
interface Options {
  isFullscreen: boolean;
  scrub: ReturnType<typeof usePlaybackScrub>;
  videoStateRef: RefObject<{ paused: boolean }>;
  onLampPress?: () => void;
}
export function usePlayerHud({ isFullscreen, scrub, videoStateRef, onLampPress }: Options) {
  const [showControls, setShowControls] = useState(true);
  const [showRateMenu, setShowRateMenu] = useState(false);
  // 动画值：HUD 控制条与辅助台灯
  const hudOpacityAnim = useRef(new Animated.Value(1)).current;
  const lampOpacityAnim = useRef(new Animated.Value(1)).current;
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureBusyRef = useRef(false);
  const scrubBusyRef = useRef(false);
  scrubBusyRef.current = scrub.isScrubbing;

  // 辅助台灯拖拽支持
  const pan = useRef(new Animated.ValueXY()).current;
  const isDraggingLamp = useRef(false);

  const [isLandscapeDrawerOpen, setIsLandscapeDrawerOpen] = useState(false);
  // 重置控制条隐藏计时器
  const resetTimers = useCallback(() => {
    setShowControls(true);
    Animated.timing(hudOpacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    Animated.timing(lampOpacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    // 抽屉展开期间不自动隐藏 HUD
    if (isLandscapeDrawerOpen || gestureBusyRef.current || scrubBusyRef.current) {
      return;
    }

    idleTimerRef.current = setTimeout(() => {
      if (gestureBusyRef.current || scrubBusyRef.current) return;
      if (videoStateRef.current.paused) return;
      setShowControls(false);
      setShowRateMenu(false);
      Animated.timing(hudOpacityAnim, { toValue: 0, duration: 400, useNativeDriver: true }).start();
      // 全屏时小台灯缓慢淡至低透明度，保留可见、可点击的控制栏入口
      if (isFullscreen) {
        Animated.timing(lampOpacityAnim, { toValue: IDLE_FULLSCREEN_LAMP_OPACITY, duration: 1400, useNativeDriver: true }).start();
      } else {
        Animated.timing(lampOpacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      }
    }, 4500);
  }, [isFullscreen, isLandscapeDrawerOpen, hudOpacityAnim, lampOpacityAnim]);

  const toggleControls = useCallback(() => {
    if (showControls) {
      setShowControls(false);
      setShowRateMenu(false);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      Animated.timing(hudOpacityAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      if (isFullscreen) {
        Animated.timing(lampOpacityAnim, { toValue: IDLE_FULLSCREEN_LAMP_OPACITY, duration: 300, useNativeDriver: true }).start();
      } else {
        Animated.timing(lampOpacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      }
    } else {
      resetTimers();
    }
  }, [showControls, resetTimers, isFullscreen, hudOpacityAnim, lampOpacityAnim]);

  const gestureActivity = (active: boolean, kind: GestureAxis) => {
    gestureBusyRef.current = active;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (active && kind === 'seek') resetTimers();
    else if (!active && showControls) resetTimers();
  };
  useEffect(() => {
    if (scrub.isScrubbing) { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); }
    else if (isFullscreen && showControls) resetTimers();
  }, [scrub.isScrubbing, isFullscreen, resetTimers]);


  // 抽屉开关状态与全屏状态联动
  useEffect(() => {
    if (isLandscapeDrawerOpen) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setShowControls(true);
      hudOpacityAnim.setValue(1);
    } else if (isFullscreen) {
      resetTimers();
    }
  }, [isLandscapeDrawerOpen, isFullscreen, resetTimers, hudOpacityAnim]);

  useEffect(() => {
    if (!isFullscreen) {
      setIsLandscapeDrawerOpen(false);
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (isFullscreen) {
      resetTimers();
    } else {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setShowControls(true);
      setShowRateMenu(false);
      hudOpacityAnim.setValue(1);
      lampOpacityAnim.setValue(1);
      pan.setValue({ x: 0, y: 0 });
    }
  }, [isFullscreen, resetTimers, hudOpacityAnim, lampOpacityAnim]);

  // 台灯拖拽手势
  const lampPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        isDraggingLamp.current = true;
        pan.extractOffset();
        resetTimers();
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: (evt, gestureState) => {
        pan.flattenOffset();
        const isClick = Math.abs(gestureState.dx) < 6 && Math.abs(gestureState.dy) < 6;
        if (isClick) {
          if (isFullscreen) {
            toggleControls();
          } else if (onLampPress) {
            onLampPress();
          }
        }
        setTimeout(() => {
          isDraggingLamp.current = false;
        }, 80);
        resetTimers();
      },
    })
  ).current;


  return { showControls, showRateMenu, setShowRateMenu, isLandscapeDrawerOpen, setIsLandscapeDrawerOpen,
    hudOpacityAnim, lampOpacityAnim, idleTimerRef, pan, isDraggingLamp, resetTimers, toggleControls, gestureActivity, lampPanResponder };
}
