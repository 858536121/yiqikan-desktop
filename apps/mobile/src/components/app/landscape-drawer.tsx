import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { X, Send, Copy, Users, Crown, Mic, Sparkles } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { socketService } from '../../services/socket';
import { useRoomStore } from '../../store/useRoomStore';
import { useVoice } from '../../services/voice-service';

interface LandscapeDrawerProps {
  visible: boolean;
  onClose: () => void;
  onShowToast?: (msg: string) => void;
  isHost?: boolean;
}

const QUICK_DANMAKU_CHIPS = [
  '哈哈哈哈',
  '666',
  '前方高能！',
  '暂停下',
  '笑死我了',
  '太甜了吧❤️',
  '👍',
  '神作！',
];

const DRAWER_WIDTH = 320;

export function LandscapeDrawer({
  visible,
  onClose,
  onShowToast,
  isHost = false,
}: LandscapeDrawerProps) {
  const insets = useSafeAreaInsets();
  const roomState = useRoomStore((state) => state.roomState);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const roomId = roomState?.id || '';
  const myUserId = socketService.getUserId();
  const { voiceStatus, stats } = useVoice();

  const [inputMessage, setInputMessage] = useState('');
  const [mounted, setMounted] = useState(visible);

  const slideAnim = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);

  // 动画控制：滑入与滑出
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 240,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: DRAWER_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setMounted(false);
      });
    }
  }, [visible, slideAnim, backdropAnim]);

  // 新消息到达时滚动到底部
  useEffect(() => {
    if (visible && mounted) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [chatMessages, visible, mounted]);

  if (!mounted) return null;

  // 发送自定义消息
  const handleSend = () => {
    const trimmed = inputMessage.trim();
    if (!trimmed || !roomId) return;
    socketService.sendChatMessage(roomId, trimmed);
    setInputMessage('');
  };

  // 点击快捷短语直接发送，免唤起键盘
  const handleSendQuickChip = (text: string) => {
    if (!roomId) return;
    socketService.sendChatMessage(roomId, text);
  };

  // 复制房间邀请口令
  const handleCopyRoomInfo = async () => {
    if (!roomId) return;
    try {
      const shareText = `【一起看】加入我的观影房间：${roomId}\n快来和我一起同步追剧吧！`;
      await Clipboard.setStringAsync(shareText);
      onShowToast?.(`已复制房间 ${roomId} 邀请口令 ✨`);
    } catch {
      onShowToast?.('复制失败，请手动记录房间号');
    }
  };

  const memberCount = roomState?.members?.length || 1;
  const isSpeaking = (stats.isLocalSpeaking || stats.isRemoteSpeaking) && voiceStatus === 'connected';
  const hasInputText = inputMessage.trim().length > 0;
  const safeRightOffset = insets.right > 0 ? Math.min(insets.right, 14) : 0;

  return (
    <View style={styles.fullscreenOverlay} pointerEvents="box-none">
      {/* 左侧透明点击遮罩：点击空白处收起抽屉 */}
      <Animated.View
        style={[styles.backdrop, { opacity: backdropAnim }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />
      </Animated.View>

      {/* 右侧半透明抽屉主体 */}
      <Animated.View
        style={[
          styles.drawerContainer,
          { transform: [{ translateX: slideAnim }] },
        ]}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.drawerInner}
        >
          {/* 1. 顶部极简状态头 (Header) */}
          <View style={styles.header}>
            <View style={styles.headerLeftGroup}>
              {/* 房间号胶囊（支持点击复制） */}
              <TouchableOpacity
                style={styles.roomBadge}
                activeOpacity={0.7}
                onPress={handleCopyRoomInfo}
              >
                <Sparkles size={13} color="#F97316" style={styles.badgeIcon} />
                <Text style={styles.roomBadgeText}>房间 {roomId}</Text>
                <Copy size={11} color="#aaa" style={{ marginLeft: 4 }} />
              </TouchableOpacity>

              {/* 在线人数 */}
              <View style={styles.memberBadge}>
                <Users size={12} color="#888" style={styles.badgeIcon} />
                <Text style={styles.memberBadgeText}>{memberCount}人在线</Text>
              </View>

              {/* 语音中说话提示 */}
              {isSpeaking && (
                <View style={styles.speakingBadge}>
                  <Mic size={11} color="#22C55E" style={styles.badgeIcon} />
                  <Text style={styles.speakingBadgeText}>语音活跃</Text>
                </View>
              )}
            </View>

            {/* 右上角 1/4 圆贴角扇形关闭按钮 */}
            <TouchableOpacity
              style={[
                styles.cornerCloseBtn,
                safeRightOffset > 0 && { paddingRight: safeRightOffset },
              ]}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <X size={18} color="#e4e4e7" />
            </TouchableOpacity>
          </View>

          {/* 2. 中部融合互动流 (Chat & Events) */}
          <ScrollView
            ref={scrollViewRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator={false}
          >
            {chatMessages.length === 0 ? (
              <View style={styles.emptyStateContainer}>
                <Text style={styles.emptyStateText}>暂无弹幕与互动消息</Text>
                <Text style={styles.emptyStateSubText}>点击下方快捷短语即可发送</Text>
              </View>
            ) : (
              chatMessages.map((msg, index) => {
                const isSystem = (msg as any).kind === 'system';
                const isMe = msg.actorId === myUserId;
                const isHostSender = msg.actorId && roomState?.hostId === msg.actorId;

                // 系统消息（进房、改进度等）以轻量居中胶囊显示
                if (isSystem) {
                  return (
                    <View key={msg.id || `sys_${index}`} style={styles.systemMsgContainer}>
                      <Text style={styles.systemMsgText}>✨ {msg.message}</Text>
                    </View>
                  );
                }

                return (
                  <View
                    key={msg.id || `chat_${index}`}
                    style={[styles.msgRow, isMe && styles.msgRowMe]}
                  >
                    <View style={styles.msgHeader}>
                      {isHostSender && (
                        <View style={styles.hostPill}>
                          <Crown size={10} color="#F97316" style={{ marginRight: 2 }} />
                          <Text style={styles.hostPillText}>房主</Text>
                        </View>
                      )}
                      <Text style={[styles.senderName, isMe && styles.senderNameMe]} numberOfLines={1}>
                        {isMe ? '我' : msg.actorName || '成员'}
                      </Text>
                    </View>
                    <View style={[styles.msgBubble, isMe ? styles.msgBubbleMe : styles.msgBubbleOther]}>
                      <Text style={[styles.msgText, isMe && styles.msgTextMe]}>
                        {msg.message}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* 3. 底部快捷反应短语胶囊 (免打字) */}
          <View style={styles.quickChipsWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickChipsContent}
            >
              {QUICK_DANMAKU_CHIPS.map((chip, idx) => (
                <TouchableOpacity
                  key={`chip_${idx}`}
                  style={styles.quickChip}
                  activeOpacity={0.7}
                  onPress={() => handleSendQuickChip(chip)}
                >
                  <Text style={styles.quickChipText}>{chip}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* 4. 底部单行输入条（右端无缝衔接 1/4 圆扇形发送按钮） */}
          <View style={styles.inputBar}>
            <TextInput
              style={styles.inputField}
              placeholder="发一条弹幕互动..."
              placeholderTextColor="rgba(255, 255, 255, 0.4)"
              value={inputMessage}
              onChangeText={setInputMessage}
              returnKeyType="send"
              onSubmitEditing={handleSend}
              maxLength={120}
            />

            {/* 右下角 1/4 圆贴角扇形发送按钮 */}
            <TouchableOpacity
              style={[
                styles.cornerSendBtn,
                hasInputText && styles.cornerSendBtnActive,
                safeRightOffset > 0 && { paddingRight: safeRightOffset },
              ]}
              onPress={handleSend}
              disabled={!hasInputText}
              activeOpacity={0.75}
            >
              <Send
                size={17}
                color={hasInputText ? '#fff' : 'rgba(255, 255, 255, 0.35)'}
              />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    zIndex: 100, // 高于全屏 HUD
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  backdropTouch: {
    flex: 1,
  },
  drawerContainer: {
    width: DRAWER_WIDTH,
    height: '100%',
    backgroundColor: 'rgba(14, 16, 22, 0.94)', // 半透明黑深灰质感
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 12,
  },
  drawerInner: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  // 顶部极简状态头
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 0, // 右侧留空由 1/4 圆贴角扇形按钮直接覆盖
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(20, 22, 30, 0.6)',
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  roomBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
  },
  roomBadgeText: {
    color: '#F97316',
    fontSize: 11.5,
    fontWeight: '600',
  },
  memberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  memberBadgeText: {
    color: '#aaa',
    fontSize: 11,
    fontWeight: '500',
  },
  speakingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.35)',
  },
  speakingBadgeText: {
    color: '#4ADE80',
    fontSize: 10.5,
    fontWeight: '600',
  },
  badgeIcon: {
    marginRight: 4,
  },
  // 右上角 1/4 圆贴角扇形关闭按钮
  cornerCloseBtn: {
    width: 50,
    height: 48,
    borderBottomLeftRadius: 36, // 内收 1/4 圆大弧度
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  // 聊天流
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  emptyStateContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  emptyStateSubText: {
    color: 'rgba(255, 255, 255, 0.3)',
    fontSize: 11.5,
  },
  systemMsgContainer: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginVertical: 4,
  },
  systemMsgText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 11,
  },
  msgRow: {
    alignItems: 'flex-start',
  },
  msgRowMe: {
    alignItems: 'flex-end',
  },
  msgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
    gap: 4,
  },
  hostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  hostPillText: {
    color: '#F97316',
    fontSize: 9.5,
    fontWeight: 'bold',
  },
  senderName: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 11,
    maxWidth: 160,
  },
  senderNameMe: {
    color: 'rgba(249, 115, 22, 0.85)',
  },
  msgBubble: {
    maxWidth: '88%',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
  },
  msgBubbleOther: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderTopLeftRadius: 3,
  },
  msgBubbleMe: {
    backgroundColor: 'rgba(249, 115, 22, 0.85)',
    borderTopRightRadius: 3,
  },
  msgText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
  },
  msgTextMe: {
    color: '#fff',
    fontWeight: '500',
  },
  // 底部快捷短语胶囊
  quickChipsWrapper: {
    height: 38,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(16, 18, 24, 0.7)',
    justifyContent: 'center',
  },
  quickChipsContent: {
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 6,
  },
  quickChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  quickChipText: {
    color: '#e4e4e7',
    fontSize: 11.5,
    fontWeight: '500',
  },
  // 底部输入条
  inputBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 0, // 右侧由 1/4 圆贴角扇形发送按钮直接贴边
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(20, 22, 30, 0.95)',
  },
  inputField: {
    flex: 1,
    height: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 17,
    paddingHorizontal: 12,
    marginRight: 8,
    color: '#fff',
    fontSize: 12.5,
  },
  // 右下角 1/4 圆贴角扇形发送按钮
  cornerSendBtn: {
    width: 50,
    height: 48,
    borderTopLeftRadius: 36, // 内收 1/4 圆大弧度
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  cornerSendBtnActive: {
    backgroundColor: '#F97316',
    borderColor: 'rgba(249, 115, 22, 0.5)',
    shadowColor: '#F97316',
    shadowOffset: { width: -1, height: -1 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 4,
  },
});
