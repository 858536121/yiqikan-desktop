import React, { memo, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { ChevronDown, ChevronUp, Crown, MicOff, Plus, Users } from 'lucide-react-native';
import type { RoomState } from '@yiqikan/shared';
import { useVoice } from '../../services/voice-service';
import { avatarImageUrl } from '../../utils/profile-avatar';
import { resolveWebUrl } from '../../services/environment';
import { ProfileAvatarView } from './profile-ui';
import { APP_ACCENT, APP_BACKGROUND, ROOM_SPEAKING } from '../../theme/colors';

type Member = RoomState['members'][number];

export function RoomMemberToggle({ room, expanded, onPress }: {
  room: RoomState; expanded: boolean; onPress: () => void;
}) {
  const count = room.members.length;
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return <TouchableOpacity testID="room-members-toggle" accessibilityRole="button" accessibilityState={{ expanded }}
    accessibilityLabel={`${count} 人，${expanded ? '收起' : '展开'}成员`} style={styles.toggle} onPress={onPress} activeOpacity={0.7}>
    {!expanded && <View style={styles.summaryAvatars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {room.members.slice(0, 2).map((member, index) => <View key={member.id} style={[styles.summaryAvatar, index > 0 && styles.overlap]}>
        <ProfileAvatarView name={member.name} avatar={member.avatar} size={19}
          imageUri={avatarImageUrl(member.avatarPath, resolveWebUrl())} />
      </View>)}
    </View>}
    <Text style={styles.count}>{count} 人</Text><Chevron size={14} color="#a0a4b0" />
  </TouchableOpacity>;
}

const MemberPortrait = memo(function MemberPortrait({ member, me, host, speaking, muted, connected, size, width, reduceMotion, onManage }: {
  member: Member; me: boolean; host: boolean; speaking: boolean; muted: boolean; connected: boolean;
  size: number; width: number; reduceMotion: boolean; onManage: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pulse.setValue(0);
    if (!speaking || reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true, isInteraction: false }),
      Animated.timing(pulse, { toValue: 0, duration: 600, useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => { animation.stop(); pulse.setValue(0); };
  }, [speaking, reduceMotion, pulse]);
  const presence = speaking ? '正在讲话' : me && muted ? '已静音' : me && connected ? '已连麦' : host ? '房主' : '在房间';
  const status = me ? `我 · ${presence}` : presence;
  const content = <>
    <View style={styles.portrait}>
      {speaking && <Animated.View pointerEvents="none" style={[styles.halo, {
        width: size + 16, height: size + 16, borderRadius: (size + 16) / 2,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }],
      }]} />}
      <View testID={`room-presence-ring-${member.id}`} style={[styles.avatarRing, speaking && styles.speakingRing]}>
        <ProfileAvatarView name={member.name} avatar={member.avatar} size={size}
          imageUri={avatarImageUrl(member.avatarPath, resolveWebUrl())} />
      </View>
      {host && <View style={styles.hostBadge}><Crown size={11} color={APP_ACCENT} /></View>}
      {me && muted && <View style={styles.muteBadge}><MicOff size={11} color="#fda4af" /></View>}
    </View>
    <Text style={styles.name} numberOfLines={1}>{member.name}</Text>
    <Text style={[styles.status, speaking && styles.speakingText]} numberOfLines={2}>{status}</Text>
  </>;
  const label = `${member.name}，${me ? '我，' : ''}${host ? '房主，' : ''}${status}`;
  return me ? <View testID={`room-presence-${member.id}`} style={[styles.member, { width }]} accessible accessibilityLabel={label}>{content}</View>
    : <TouchableOpacity testID={`room-presence-${member.id}`} style={[styles.member, { width }]} accessibilityRole="button"
      accessibilityLabel={`${label}，查看成员与设置`} onPress={onManage} activeOpacity={0.75}>{content}</TouchableOpacity>;
});

export function RoomMemberStrip({ room, myUserId, active, onInvite, onManage }: {
  room: RoomState; myUserId: string; active: boolean; onInvite: () => void; onManage: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(width);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const { voiceStatus, isMuted, stats } = useVoice();
  useEffect(() => {
    let current = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (current) setReduceMotion(value); }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const appState = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => { current = false; motion.remove(); appState.remove(); };
  }, []);
  // Preserve room order while keeping yourself first; speech never reorders people.
  const ordered = [...room.members.filter(member => member.id === myUserId), ...room.members.filter(member => member.id !== myUserId)];
  const solo = ordered.length === 1;
  const overflow = ordered.length > 5;
  const visible = ordered.slice(0, overflow ? 4 : 5);
  const available = Math.max(0, contentWidth - 32);
  const slots = solo ? 2 : overflow ? 5 : visible.length;
  const columns = Math.max(1, Math.min(slots, 5, Math.floor(available / (64 * Math.max(1, fontScale)))));
  const small = ordered.length > 2;
  const itemWidth = small ? available / columns : Math.min(104, available / Math.min(2, columns));
  const size = ordered.length >= 5 ? 36 : small ? 40 : 48;
  const connected = voiceStatus === 'connected';
  const canShowSpeech = active && foreground && connected;
  return <ScrollView testID="房间常驻成员" style={styles.container} contentContainerStyle={styles.members}
    onLayout={event => setContentWidth(event.nativeEvent.layout.width)}>
    {visible.map(member => <MemberPortrait key={member.id} member={member} width={itemWidth} size={size}
      me={member.id === myUserId} host={member.id === room.hostId} reduceMotion={reduceMotion}
      connected={connected} muted={member.id === myUserId && connected && isMuted}
      speaking={canShowSpeech && (member.id === myUserId ? !isMuted && stats.isLocalSpeaking : stats.remoteSpeakingByUserId[member.id] === true)}
      onManage={onManage} />)}
    {solo && <TouchableOpacity testID="room-presence-invite" accessibilityRole="button" accessibilityLabel="邀请 TA 一起看"
      style={[styles.member, { width: itemWidth }]} onPress={onInvite} activeOpacity={0.75}>
      <View style={[styles.inviteAvatar, styles.inviteAvatarPrimary, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}><Plus size={25} color={APP_ACCENT} /></View>
      <Text style={[styles.name, styles.inviteName]}>邀请 TA</Text><Text style={styles.status}>等 TA 来一起看</Text>
    </TouchableOpacity>}
    {overflow && <TouchableOpacity testID="room-presence-all" accessibilityRole="button" accessibilityLabel={`查看全部 ${ordered.length} 位成员`}
      style={[styles.member, { width: itemWidth }]} onPress={onManage} activeOpacity={0.75}>
      <View style={[styles.inviteAvatar, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}><Users size={21} color="#a0a4b0" /></View>
      <Text style={styles.name}>全部 {ordered.length} 人</Text><Text style={styles.status}>查看成员</Text>
    </TouchableOpacity>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 2 },
  count: { color: '#a0a4b0', fontSize: 12 },
  summaryAvatars: { flexDirection: 'row', alignItems: 'center' },
  summaryAvatar: { borderWidth: 1, borderColor: APP_BACKGROUND, borderRadius: 12 },
  overlap: { marginLeft: -4 },
  container: { flexGrow: 0, flexShrink: 1, maxHeight: 250 },
  members: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, rowGap: 12 },
  member: { minHeight: 80, alignItems: 'center', gap: 4, paddingHorizontal: 3 },
  portrait: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  avatarRing: { padding: 2, borderWidth: 1, borderColor: '#424550', borderRadius: 40 },
  speakingRing: { borderColor: ROOM_SPEAKING },
  halo: { position: 'absolute', backgroundColor: 'rgba(117,223,168,0.13)', borderWidth: 1, borderColor: 'rgba(117,223,168,0.35)' },
  name: { color: '#e5e7eb', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  status: { color: '#a0a4b0', fontSize: 11, lineHeight: 16, textAlign: 'center' },
  speakingText: { color: ROOM_SPEAKING },
  hostBadge: { position: 'absolute', bottom: -1, right: -1, width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#22252e', borderWidth: 2, borderColor: APP_BACKGROUND },
  muteBadge: { position: 'absolute', bottom: -1, left: -1, width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#38212a', borderWidth: 2, borderColor: '#0D0E12' },
  inviteAvatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: '#555b69', backgroundColor: '#171a22' },
  inviteAvatarPrimary: { borderColor: 'rgba(249,115,22,0.55)' },
  inviteName: { color: APP_ACCENT },
});
