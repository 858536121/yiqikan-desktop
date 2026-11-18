import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { MessageCircle, Mic, MicOff, UserPlus } from 'lucide-react-native';
import type { MemberPresence } from '@yiqikan/shared';
import { APP_ACCENT, ROOM_SPEAKING, appControlColors as colors } from '../../theme/colors';
import { useVoice } from '../../services/voice-service';
import { resolveWebUrl } from '../../services/environment';
import { avatarImageUrl } from '../../utils/profile-avatar';
import { ProfileAvatarView } from './profile-ui';

export const WATCH_CAPSULE_INSET = 24;
export const WATCH_CAPSULE_BOTTOM_INSET = 12;
export const WATCH_CAPSULE_HEIGHT = 48;

export function WatchSessionControls({ members, myUserId, onInvite, onOpenChat, unreadCount = 0, roomConnected, floating, hidden = false }: {
  members: readonly MemberPresence[];
  myUserId: string;
  onInvite: () => void;
  onOpenChat: () => void;
  roomConnected: boolean;
  floating: boolean;
  unreadCount?: number;
  hidden?: boolean;
}) {
  const { voiceStatus, isMuted, stats, toggleMute } = useVoice();
  const voiceConnected = voiceStatus === 'connected';
  const voiceReconnecting = voiceStatus === 'reconnecting';
  const peers = myUserId ? members.filter(member => member.id !== myUserId) : [];
  const inviting = peers.length === 0;
  const partner = peers.length === 1 ? peers[0] : undefined;
  const visiblePeers = peers.slice(0, 2);
  const extraPeers = peers.length - visiblePeers.length;
  const peerSpeaking = (id: string) => roomConnected && voiceConnected && stats.remoteSpeakingByUserId[id] === true;
  const speaking = partner ? peerSpeaking(partner.id) : false;
  const label = inviting ? '邀请好友' : partner ? partner.name || '好友' : '房间聊天';
  const status = !roomConnected ? '房间重连中' : voiceReconnecting ? '语音重连中' : inviting ? '等 TA 来一起看'
    : partner ? (speaking ? '正在说话' : '和你一起看') : `${members.length} 人在房间`;
  const accessibilityLabel = [label, status, !inviting && unreadCount > 0 ? `${unreadCount}条未读消息` : null].filter(Boolean).join('，');
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const pan = useRef(new Animated.ValueXY()).current;
  const placement = useRef({ edge: 'right' as 'left' | 'right', ratio: 1 });
  const origin = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const suppressUntil = useRef(0);
  const geometry = useRef({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  const insetX = Math.min(WATCH_CAPSULE_INSET, Math.max(0, (bounds.width - size.width) / 2));
  const insetY = Math.min(WATCH_CAPSULE_BOTTOM_INSET, Math.max(0, (bounds.height - size.height) / 2));
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
    if (!floating) return;
    pan.stopAnimation();
    dragging.current = false;
    const g = geometry.current;
    pan.setValue({ x: placement.current.edge === 'left' ? g.minX : g.maxX,
      y: g.minY + placement.current.ratio * (g.maxY - g.minY) });
  }, [floating, bounds.width, bounds.height, size.width, size.height, pan]);
  const press = (action: () => void) => { if (!dragging.current && Date.now() >= suppressUntil.current) action(); };
  const inviteDisabled = inviting && !roomConnected;
  const content = <>
    <Pressable testID={inviting ? 'home-copy-invite' : '观看页聊天入口'}
      accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      accessibilityHint={inviting ? '复制房间邀请' : '打开快捷聊天'}
      accessibilityState={{ disabled: inviteDisabled }} disabled={inviteDisabled} onPress={() => press(inviting ? onInvite : onOpenChat)}
      style={({ pressed }) => [styles.mainAction, inviteDisabled && styles.disabled, pressed && styles.pressed]}>
      <View style={styles.avatars} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {inviting ? <View style={styles.inviteTile}><UserPlus size={17} color={colors.accentButton.ink} /></View> : visiblePeers.map((member, index) => (
          <View key={member.id} testID={`watch-avatar-${member.id}`}
            style={[styles.avatarRing, index > 0 && styles.overlap, peerSpeaking(member.id) && styles.speakingRing]}>
            <ProfileAvatarView name={member.name} avatar={member.avatar} size={30}
              imageUri={avatarImageUrl(member.avatarPath, resolveWebUrl())} />
          </View>
        ))}
        {extraPeers > 0 && <View style={[styles.avatarRing, styles.overlap, styles.extraTile]}>
          <Text style={styles.extraCount} numberOfLines={1}>+{extraPeers}</Text>
        </View>}
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.label}>{label}</Text>
        <Text numberOfLines={1} style={[styles.status, speaking && styles.speakingText]}>{status}</Text>
      </View>
      {!inviting && <View style={styles.chatIcon} accessible={false}>
        <MessageCircle size={16} color={APP_ACCENT} />
        {unreadCount > 0 && <View testID="观看胶囊未读消息" style={styles.dot} />}
      </View>}
    </Pressable>
    {(voiceConnected || voiceReconnecting) && <Pressable testID="全局麦克风按钮" accessibilityRole="button"
      accessibilityLabel={voiceReconnecting ? '语音重连中' : isMuted ? '麦克风已静音，点击开麦' : '麦克风已开启，点击静音'}
      accessibilityState={{ disabled: !voiceConnected }} disabled={!voiceConnected} onPress={() => press(toggleMute)}
      style={({ pressed }) => [styles.micAction, pressed && styles.pressed]}>
      {isMuted ? <MicOff size={18} color={colors.watchControls.mutedMic} />
        : <Mic size={18} color={voiceConnected && stats.isLocalSpeaking ? ROOM_SPEAKING : colors.watchControls.secondary} />}
    </Pressable>}
  </>;
  if (!floating) return hidden ? null : <View style={styles.controls} testID="固定观看胶囊">{content}</View>;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={hidden ? 'none' : 'box-none'} testID="观看浮层范围"
      accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      onLayout={event => { const { width, height } = event.nativeEvent.layout; setBounds({ width, height }); }}>
    <Animated.View {...responder.panHandlers} testID="可拖动观看控件"
      onLayout={event => { const { width, height } = event.nativeEvent.layout; setSize({ width, height }); }}
      style={[styles.controls, styles.floating, { opacity: hidden || !bounds.width || !size.width ? 0 : 1, transform: pan.getTranslateTransform() }]}>
      {content}
    </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { maxWidth: '100%', flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden',
    backgroundColor: colors.watchControls.surface, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.watchControls.edge },
  floating: { position: 'absolute', left: 0, top: 0 },
  mainAction: { minHeight: WATCH_CAPSULE_HEIGHT, flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 12 },
  pressed: { backgroundColor: colors.watchControls.pressed },
  disabled: { opacity: 0.6 },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatarRing: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.watchControls.surface, borderWidth: 1, borderColor: colors.watchControls.edge },
  overlap: { marginLeft: -8 },
  speakingRing: { borderWidth: 2, borderColor: ROOM_SPEAKING },
  extraTile: { backgroundColor: colors.watchControls.accentSurface },
  extraCount: { color: APP_ACCENT, fontSize: 11, fontWeight: '600' },
  inviteTile: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: APP_ACCENT },
  copy: { gap: 1, minWidth: 0, maxWidth: 120, flexShrink: 1 },
  label: { color: colors.ink, fontWeight: '700', fontSize: 13 },
  status: { color: colors.watchControls.secondary, fontSize: 11 },
  speakingText: { color: ROOM_SPEAKING },
  chatIcon: { position: 'relative' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: APP_ACCENT, position: 'absolute', right: -3, top: -2 },
  micAction: { width: 44, minHeight: WATCH_CAPSULE_HEIGHT, alignItems: 'center', justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.line },
});
