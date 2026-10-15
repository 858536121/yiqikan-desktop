import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Copy, Users, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import type { ChatMessage, RoomState } from '@yiqikan/shared';
import { roomInvite } from '../../services/room-invite';
import { resolveWebUrl } from '../../services/environment';
import { useRoomStore } from '../../store/useRoomStore';
import { ChatPanel } from './chat-panel';
import { MembersPanel, RoomEntryRequest } from './members-panel';
import { VoicePanel } from './voice-panel';

export function RoomModule({ room, myUserId, active, messages, chatInput, setChatInput, onSend, sendError, onMessagesRead, onLeaveRoom, entryRequest, onEntryFormClose }: {
  room: RoomState | null; myUserId: string; active: boolean; messages: ChatMessage[];
  chatInput: string; setChatInput: (value: string) => void; onSend: () => Promise<boolean>; sendError?: string | null;
  onMessagesRead: (id: string) => void; onLeaveRoom: () => void; entryRequest?: RoomEntryRequest; onEntryFormClose: () => void;
}) {
  const [managing, setManaging] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(width);
  const [controlWidth, setControlWidth] = useState(0);
  const stackVoice = contentWidth - 40 - 12 - controlWidth < 80 * fontScale;
  const leaveAfterDismiss = useRef(false);
  const password = useRoomStore(state => state.savedPassword);
  const me = room?.members.find(member => member.id === myUserId);
  useEffect(() => { if (!active || !room) setManaging(false); }, [active, room?.id]);
  const members = <MembersPanel members={room?.members || []} hostId={room?.hostId || ''} myUserId={myUserId} isInRoom={!!room}
    onLeaveRoom={() => {
      if (Platform.OS === 'ios' && managing) { leaveAfterDismiss.current = true; setManaging(false); }
      else { setManaging(false); onLeaveRoom(); }
    }} entryRequest={entryRequest} onEntryFormClose={onEntryFormClose} />;
  const copyInvitation = async () => {
    if (!room) return;
    try {
      await Clipboard.setStringAsync(roomInvite(room.id, !!room.hasPassword, password, resolveWebUrl()));
      useRoomStore.getState().showToast('邀请已复制，发给 TA 就能加入');
    } catch { useRoomStore.getState().showToast('复制失败，请重试'); }
  };
  return (
    <View style={styles.container} onLayout={event => setContentWidth(event.nativeEvent.layout.width)}>
      <View style={styles.header}>
        <View style={styles.heading}><Text style={styles.title}>房间</Text><Text style={styles.subtitle}>{room ? `房号 ${room.id}` : '和 TA 一起看，从这里开始'}</Text></View>
        {room && <>
          <TouchableOpacity testID="房间成员入口" accessibilityLabel={`成员与设置，${room.members.length}位成员`} onPress={() => setManaging(true)} style={styles.action}><Users size={19} color="#b0b4bf" /><Text style={styles.count}>{room.members.length}</Text></TouchableOpacity>
          <TouchableOpacity testID="房间复制邀请" accessibilityLabel="复制邀请" onPress={copyInvitation} style={styles.invite}><Copy size={15} color="#fb923c" /><Text style={styles.inviteText}>邀请</Text></TouchableOpacity>
        </>}
      </View>
      {room ? <>
        <View style={[styles.voiceRow, stackVoice && styles.voiceStack]}>
          <View style={[styles.voiceText, stackVoice && styles.voiceStackText]}><Text style={styles.voiceTitle}>一起聊聊</Text><Text style={styles.subtitle} numberOfLines={2}>连麦声音与视频同时播放</Text></View>
          <View style={styles.voiceControls} onLayout={event => setControlWidth(event.nativeEvent.layout.width)}><VoicePanel compact={false} roomId={room.id} myUserId={myUserId} myName={me?.name || '影迷'} /></View>
        </View>
        <ChatPanel key={room.id} messages={messages} chatInput={chatInput} setChatInput={setChatInput} onSend={onSend} sendError={sendError} isActive={active && !managing} onReadMessages={onMessagesRead} />
      </> : members}
      {room && <Modal visible={managing && active} transparent animationType="slide" onRequestClose={() => setManaging(false)}
        onDismiss={() => { if (leaveAfterDismiss.current) { leaveAfterDismiss.current = false; onLeaveRoom(); } }}>
        <View style={styles.modalBackdrop}><TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setManaging(false)} accessibilityLabel="关闭房间设置背景" />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>成员与房间设置</Text><TouchableOpacity style={styles.action} onPress={() => setManaging(false)} accessibilityLabel="关闭房间设置"><X size={20} color="#b0b4bf" /></TouchableOpacity></View>
            {members}
          </SafeAreaView>
        </View>
      </Modal>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0d12' },
  header: { minHeight: 72, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#292c35' },
  heading: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: '#f4f4f5', fontSize: 24, fontWeight: '600' },
  subtitle: { color: '#9296a2', fontSize: 12 },
  action: { minWidth: 44, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  count: { color: '#b0b4bf', fontSize: 12 },
  invite: { minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, backgroundColor: 'rgba(249,115,22,0.08)' },
  inviteText: { color: '#fb923c', fontSize: 13, fontWeight: '500' },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#11131a' },
  voiceControls: { flexShrink: 0 },
  voiceText: { flex: 1, minWidth: 0, gap: 3 },
  voiceStack: { flexDirection: 'column', alignItems: 'flex-start', gap: 6 },
  voiceStackText: { flex: 0 },
  voiceTitle: { color: '#d9dce4', fontSize: 13 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { height: '80%', borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: '#11131a', overflow: 'hidden' },
  sheetHeader: { height: 56, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { color: '#f4f4f5', fontSize: 16, fontWeight: '500' },
});
