import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sun, Volume2, VolumeX, FastForward, Rewind } from 'lucide-react-native';
import { FullscreenGesture, type FullscreenGestureConfig, type GestureAxis, type SeekRange } from '../../utils/fullscreen-gesture';
import { usePlayerDeviceControls } from '../../hooks/use-player-device-controls';
import { formatTime } from '../../utils/time';

type Props = {
  enabled: boolean; contextKey: string; isHost: boolean; canSeek: boolean; currentTime: number; duration: number;
  ranges: SeekRange[]; isSeeking: boolean;
  onBeginSeek(): void; onPreviewSeek(value: number): void; onCommitSeek(value: number): void; onCancelSeek(): void;
  onTap(): void; onActivity(active: boolean, kind: GestureAxis): void;
};
type Feedback = { kind: GestureAxis; value: number; origin: number } | { message: string };
let showedHint = false;

export function FullscreenGestureLayer(props: Props) {
  const insets = useSafeAreaInsets();
  const device = usePlayerDeviceControls(true);
  const [screenReader, setScreenReader] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hint, setHint] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceRef = useRef(device); deviceRef.current = device;
  const seekActive = useRef(false);
  const clearTimer = () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); fadeTimer.current = null; };
  const available = props.enabled && device.active && !screenReader && size.width > 0;
  const context = `${props.contextKey}|${device.state?.route || ''}|${size.width}:${size.height}`;
  const config = useRef<FullscreenGestureConfig>(null!);
  config.current = {
    context, enabled: available, width: size.width, height: size.height,
    currentTime: props.currentTime, duration: props.duration, ranges: props.ranges, isHost: props.isHost, canSeek: props.canSeek,
    brightness: device.state?.canBrightness ? device.state.brightness : null,
    volume: device.state?.canVolume ? device.state.volume : null,
    beginSeek: props.onBeginSeek, previewSeek: props.onPreviewSeek, commitSeek: props.onCommitSeek, cancelSeek: props.onCancelSeek,
    setDevice: (kind, value) => deviceRef.current.set(kind, value),
    finishDevice: () => deviceRef.current.flush(),
    feedback(kind, value, origin) { setFeedback({ kind, value, origin }); },
    unavailable(kind) { setFeedback({ message: kind === 'seek' ? props.isHost ? '当前视频暂不支持调整进度' : '进度由房主控制'
      : kind === 'volume' ? '请使用设备音量键调节' : '当前设备暂不支持调节亮度' }); },
    activity(active, kind) {
      clearTimer(); setHint(false);
      seekActive.current = active && kind === 'seek';
      props.onActivity(active, kind);
      if (!active) fadeTimer.current = setTimeout(() => setFeedback(null), 650);
    },
    tap() { setHint(false); setFeedback(null); props.onTap(); },
  };
  const gesture = useRef<FullscreenGesture | null>(null);
  if (!gesture.current) gesture.current = new FullscreenGesture(() => config.current);
  const responder = useRef(PanResponder.create({
    // Own the blank surface from touch-down: a WebView cannot reliably hand
    // its native responder to RN in the middle of an iframe gesture.
    onStartShouldSetPanResponder: () => config.current.enabled,
    onMoveShouldSetPanResponder: () => config.current.enabled,
    onPanResponderGrant: (event, state) => gesture.current!.start(event.nativeEvent.locationX, state.numberActiveTouches),
    onPanResponderStart: (_event, state) => { if (state.numberActiveTouches !== 1) gesture.current!.cancel(); },
    onPanResponderMove: (_event, state) => gesture.current!.move(state.dx, state.dy, state.numberActiveTouches),
    onPanResponderRelease: (_event, state) => gesture.current!.end(state.dx, state.dy, state.numberActiveTouches),
    onPanResponderTerminate: () => gesture.current!.cancel(),
    onPanResponderTerminationRequest: () => true,
    onShouldBlockNativeResponder: () => true,
  })).current;
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(value => { if (alive) setScreenReader(value); });
    const listener = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    const app = AppState.addEventListener('change', next => { if (next !== 'active') { gesture.current?.cancel(); setFeedback(null); } });
    return () => { alive = false; listener.remove(); app.remove(); gesture.current?.cancel(); clearTimer(); };
  }, []);
  useEffect(() => { gesture.current?.cancel(); setFeedback(null); }, [context, available]);
  useEffect(() => {
    if (!device.failure) return;
    gesture.current?.cancel();
    setFeedback({ message: device.failure === 'volume' ? '请使用设备音量键调节' : '亮度调节暂不可用' });
  }, [device.failure]);
  useEffect(() => {
    if (!available || showedHint) return;
    showedHint = true; setHint(true);
    const timer = setTimeout(() => setHint(false), 3500);
    return () => { clearTimeout(timer); setHint(false); };
  }, [available]);

  const kind = feedback && 'kind' in feedback ? feedback.kind : null;
  const value = kind === 'brightness' ? device.state?.brightness : kind === 'volume' ? device.state?.volume : null;
  const delta = feedback && 'kind' in feedback ? feedback.value - feedback.origin : 0;
  const Icon = kind === 'brightness' ? Sun : kind === 'volume' ? value === 0 ? VolumeX : Volume2 : delta < 0 ? Rewind : FastForward;
  const hints = [props.canSeek ? '左右滑调进度' : '', device.state?.canBrightness ? '左侧调亮度' : '', device.state?.canVolume ? '右侧调音量' : ''].filter(Boolean);
  return <>
    <View testID="fullscreen-gesture-surface" accessible={false} pointerEvents={available ? 'auto' : 'none'}
      style={[styles.surface, { top: Math.max(8, insets.top), bottom: Math.max(16, insets.bottom), left: Math.max(24, insets.left), right: Math.max(24, insets.right) }]}
      onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize(old => old.width === width && old.height === height ? old : { width, height }); }}
      {...responder.panHandlers} />
    {available && (feedback || props.isSeeking) && <View pointerEvents="none" style={styles.feedbackPosition}>
      <View style={styles.feedback} testID="fullscreen-gesture-feedback">
        {feedback && 'message' in feedback ? <Text style={styles.message}>{feedback.message}</Text> : <>
          <Icon size={18} color="#fb923c" />
          <Text style={[styles.value, (kind === 'brightness' || kind === 'volume') && styles.deviceValue]}>
            {kind === 'brightness' || kind === 'volume' ? `${Math.round((value ?? 0) * 100)}%` : `${formatTime(props.currentTime)} / ${formatTime(props.duration)}`}
          </Text>
          {kind === 'brightness' || kind === 'volume'
            ? <View style={styles.track}><View style={[styles.fill, { width: `${Math.round((value ?? 0) * 100)}%` }]} /></View>
            : props.isSeeking && !seekActive.current && <Text style={styles.label}>正在跳转</Text>}
        </>}
      </View>
    </View>}
    {available && hint && hints.length > 0 && <View pointerEvents="none" style={styles.hintPosition}><Text style={styles.hint}>{hints.join(' · ')}</Text></View>}
  </>;
}

const styles = StyleSheet.create({
  surface: { position: 'absolute', zIndex: 30 },
  feedbackPosition: { position: 'absolute', top: '22%', left: 0, right: 0, alignItems: 'center', zIndex: 45 },
  feedback: { maxWidth: '70%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: 'rgba(12,14,20,0.62)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { fontSize: 16, lineHeight: 20, fontVariant: ['tabular-nums'], color: '#fff', fontWeight: '600' },
  deviceValue: { minWidth: 42 },
  label: { fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'], color: '#d4d4d8' },
  message: { fontSize: 13, lineHeight: 18, color: '#eee', textAlign: 'center', flexShrink: 1 },
  track: { height: 2, width: 40, borderRadius: 1, backgroundColor: 'rgba(255,255,255,.25)', overflow: 'hidden' },
  fill: { height: 2, backgroundColor: '#fb923c', borderRadius: 1 },
  hintPosition: { position: 'absolute', bottom: 90, left: 0, right: 0, alignItems: 'center', zIndex: 45 },
  hint: { color: '#eee', fontSize: 12, backgroundColor: 'rgba(12,14,20,.7)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18 },
});
