import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MessageCircle, Mic, MicOff } from 'lucide-react-native';
import { useVoice } from '../../services/voice-service';

export function WatchSessionControls({ onOpenChat, unreadCount = 0, hidden = false }: {
  onOpenChat: () => void; unreadCount?: number; hidden?: boolean;
}) {
  const { voiceStatus, isMuted, stats, toggleMute } = useVoice();
  const connected = voiceStatus === 'connected';
  const speaking = connected && (stats.isLocalSpeaking || stats.isRemoteSpeaking);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const pan = useRef(new Animated.ValueXY()).current;
  const placement = useRef({ edge: 'right' as 'left' | 'right', ratio: 1 });
  const origin = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const suppressUntil = useRef(0);
  const geometry = useRef({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  const insetX = Math.min(12, Math.max(0, (bounds.width - size.width) / 2));
  const insetY = Math.min(12, Math.max(0, (bounds.height - size.height) / 2));
  geometry.current = { minX: insetX, maxX: Math.max(insetX, bounds.width - size.width - insetX),
    minY: insetY, maxY: Math.max(insetY, bounds.height - size.height - insetY) };
  const clamp = (dx: number, dy: number) => {
    const g = geometry.current;
    return { x: Math.min(g.maxX, Math.max(g.minX, origin.current.x + dx)),
      y: Math.min(g.maxY, Math.max(g.minY, origin.current.y + dy)) };
  };
  const finishDrag = (dx: number, dy: number) => {
    const g = geometry.current, next = clamp(dx, dy);
    const edge = next.x < (g.minX + g.maxX) / 2 ? 'left' : 'right';
    placement.current = { edge, ratio: g.maxY > g.minY ? (next.y - g.minY) / (g.maxY - g.minY) : 1 };
    dragging.current = false;
    suppressUntil.current = Date.now() + 150;
    Animated.spring(pan, { toValue: { x: edge === 'left' ? g.minX : g.maxX, y: next.y },
      damping: 24, stiffness: 260, mass: 0.8, useNativeDriver: false }).start();
  };
  // Geometry is read from refs so one responder stays valid while the viewport
  // resizes or voice controls appear. Only movement captures a button's touch.
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
    onPanResponderGrant: () => { dragging.current = true; pan.stopAnimation(value => { origin.current = value; }); },
    onPanResponderMove: (_event, gesture) => pan.setValue(clamp(gesture.dx, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => finishDrag(gesture.dx, gesture.dy),
    onPanResponderTerminate: (_event, gesture) => finishDrag(gesture.dx, gesture.dy),
  })).current;
  useEffect(() => {
    pan.stopAnimation();
    dragging.current = false;
    const g = geometry.current;
    pan.setValue({ x: placement.current.edge === 'left' ? g.minX : g.maxX,
      y: g.minY + placement.current.ratio * (g.maxY - g.minY) });
  }, [bounds.width, bounds.height, size.width, size.height, pan]);
  const press = (action: () => void) => { if (!dragging.current && Date.now() >= suppressUntil.current) action(); };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={hidden ? 'none' : 'box-none'} testID="观看浮层范围"
      accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      onLayout={event => { const { width, height } = event.nativeEvent.layout; setBounds({ width, height }); }}>
    <Animated.View {...responder.panHandlers} testID="可拖动观看控件"
      onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize({ width, height }); }}
      style={[styles.controls, { opacity: hidden || !bounds.width || !size.width ? 0 : 1, transform: pan.getTranslateTransform() }]}>
      <TouchableOpacity testID="观看页聊天入口" accessibilityLabel={unreadCount ? `聊天，${unreadCount}条未读消息` : '房间聊天'} onPress={() => press(onOpenChat)} style={styles.action}>
        <MessageCircle size={19} color="#b0b4bf" />{unreadCount > 0 && <View style={styles.dot} />}
      </TouchableOpacity>
      {(connected || voiceStatus === 'reconnecting') && <TouchableOpacity testID="全局麦克风按钮" accessibilityLabel={isMuted ? '麦克风已静音，点击开麦' : '麦克风已开启，点击静音'}
        disabled={!connected} onPress={() => press(toggleMute)} style={[styles.action, speaking && styles.speaking]}>
        {isMuted ? <MicOff size={19} color="#f08a8e" /> : <Mic size={19} color={speaking ? '#6ee7b7' : '#b0b4bf'} />}
      </TouchableOpacity>}
      {voiceStatus === 'reconnecting' && <Text accessibilityRole="alert" style={styles.reconnecting} numberOfLines={1}>语音重连中</Text>}
    </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { position: 'absolute', left: 0, top: 0, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(17,19,26,0.94)', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#292c35' },
  action: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  speaking: { backgroundColor: 'rgba(52,211,153,0.08)' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#e15c62', position: 'absolute', right: 8, top: 8 },
  reconnecting: { color: '#fbbf24', fontSize: 11, paddingHorizontal: 8 },
});
