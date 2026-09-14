import React, { useEffect, useRef, useState } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  Modal, 
  TouchableWithoutFeedback, 
  KeyboardAvoidingView, 
  Platform 
} from 'react-native';
import { Send, MessageSquareDashed } from 'lucide-react-native';
import { socketService } from '../../services/socket';

interface ChatMessage {
  id: string;
  actorId?: string;
  actorName: string;
  kind?: 'text' | 'system';
  message: string;
  createdAt?: number;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  chatInput: string;
  setChatInput: (val: string) => void;
  onSend: () => void;
  isActive: boolean;
}

const QUICK_DANMAKU_TAGS = ['哈哈哈哈', '666', '太甜了吧❤️', '前方高能！', '呜呜呜😭', '神作！', '笑死我了'];

export function ChatPanel({
  messages,
  chatInput,
  setChatInput,
  onSend,
  isActive,
}: ChatPanelProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const myUserId = socketService.getUserId();

  useEffect(() => {
    if (isActive) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, isActive]);

  const handleSend = () => {
    if (chatInput.trim()) {
      onSend();
      setIsModalOpen(false);
    }
  };

  return (
    <View style={styles.chatContainer}>
      <ScrollView 
        ref={scrollViewRef} 
        style={styles.chatList} 
        contentContainerStyle={[styles.chatListContent, messages.length === 0 && { flex: 1, justifyContent: 'center' }]}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MessageSquareDashed size={36} color="#444" style={{ marginBottom: 8 }} />
            <Text style={styles.emptyTitle}>暂无弹幕互动</Text>
            <Text style={styles.emptySub}>发送一条消息，将在视频全屏上方实时滑过</Text>
          </View>
        ) : (
          messages.map((msg) => {
            const isSystem = msg.kind === 'system';
            const isMe = msg.actorId === myUserId || msg.actorName === '我';

            if (isSystem) {
              return (
                <View key={msg.id} style={styles.systemMessageContainer}>
                  <Text style={styles.systemMessageText}>{msg.message}</Text>
                </View>
              );
            }

            return (
              <View key={msg.id} style={[styles.messageWrapper, isMe && styles.messageWrapperMe]}>
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                  <Text style={[styles.senderName, isMe && styles.senderNameMe]}>
                    {isMe ? '我' : msg.actorName}
                  </Text>
                  <Text style={[styles.messageText, isMe && styles.messageTextMe]}>
                    {msg.message}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* 底部常态触发栏（点击唤起贴键盘输入浮层，彻底避免挤压视频画面） */}
      <TouchableOpacity 
        style={styles.chatInputContainer}
        onPress={() => setIsModalOpen(true)}
        activeOpacity={0.85}
        accessibilityLabel="发条弹幕聊天互动吧..."
      >
        <View style={styles.chatInputFake}>
          <Text 
            style={[styles.chatInputFakeText, !chatInput.trim() && styles.placeholderText]}
            numberOfLines={1}
          >
            {chatInput.trim() || '发条弹幕聊天互动吧...'}
          </Text>
        </View>
        <TouchableOpacity 
          style={[styles.sendBtn, !chatInput.trim() && styles.sendBtnDisabled]} 
          onPress={() => {
            if (chatInput.trim()) {
              onSend();
            } else {
              setIsModalOpen(true);
            }
          }}
          activeOpacity={0.7}
          accessibilityLabel="发送弹幕"
        >
          <Send color={chatInput.trim() ? '#fff' : 'rgba(255, 255, 255, 0.40)'} size={16} />
        </TouchableOpacity>
      </TouchableOpacity>

      {/* 贴键盘沉浸式输入弹窗 */}
      <Modal
        visible={isModalOpen}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdropContainer}
        >
          <TouchableWithoutFeedback onPress={() => setIsModalOpen(false)}>
            <View style={styles.modalDismissArea} />
          </TouchableWithoutFeedback>

          <View style={styles.floatingInputSheet}>
            {/* 快捷弹幕胶囊横划区 */}
            <View style={styles.quickTagsContainer}>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickTagsList}
                keyboardShouldPersistTaps="always"
              >
                {QUICK_DANMAKU_TAGS.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={styles.quickTagBtn}
                    onPress={() => {
                      setChatInput(tag);
                      setTimeout(() => inputRef.current?.focus(), 50);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.quickTagBtnText}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* 输入行 */}
            <View style={styles.modalInputRow}>
              <TextInput 
                ref={inputRef}
                style={styles.modalTextInput}
                placeholder="发条弹幕聊天互动吧..."
                placeholderTextColor="#777"
                value={chatInput}
                onChangeText={setChatInput}
                onSubmitEditing={handleSend}
                returnKeyType="send"
                autoFocus={true}
                autoCorrect={false}
                accessibilityLabel="发条弹幕聊天互动吧..."
              />
              <TouchableOpacity 
                style={[styles.modalSendBtn, !chatInput.trim() && styles.modalSendBtnDisabled]} 
                onPress={handleSend}
                disabled={!chatInput.trim()}
                activeOpacity={0.7}
                accessibilityLabel="发送弹幕"
              >
                <Send color={chatInput.trim() ? '#fff' : 'rgba(255, 255, 255, 0.40)'} size={17} />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  chatContainer: {
    flex: 1,
    backgroundColor: '#121215',
  },
  chatList: {
    flex: 1,
  },
  chatListContent: {
    padding: 12,
    paddingBottom: 20,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    color: '#777',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptySub: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
  },
  systemMessageContainer: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginVertical: 6,
  },
  systemMessageText: {
    color: '#888',
    fontSize: 11,
  },
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  messageWrapperMe: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 2,
  },
  bubbleOther: {
    backgroundColor: '#1E202B',
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(0, 0, 0, 0.40)',
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    borderRightColor: 'rgba(255, 255, 255, 0.08)',
  },
  bubbleMe: {
    backgroundColor: '#EA580C',
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.40)',
    borderBottomColor: 'rgba(154, 52, 18, 0.70)',
    borderLeftColor: 'rgba(255, 255, 255, 0.15)',
    borderRightColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  senderName: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 3,
  },
  senderNameMe: {
    color: 'rgba(255, 255, 255, 0.85)',
    textAlign: 'right',
  },
  messageText: {
    color: '#F3F4F6',
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextMe: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#121319',
  },
  chatInputFake: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.35)',
    borderBottomColor: 'rgba(255, 255, 255, 0.10)',
    borderLeftColor: 'rgba(255, 255, 255, 0.05)',
    borderRightColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
  },
  chatInputFakeText: {
    color: '#fff',
    fontSize: 13.5,
  },
  placeholderText: {
    color: '#6B7280',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EA580C',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
    borderWidth: 1.2,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomColor: 'rgba(0, 0, 0, 0.45)',
    borderLeftColor: 'rgba(255, 255, 255, 0.15)',
    borderRightColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 5,
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(255, 255, 255, 0.10)',
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(0, 0, 0, 0.35)',
    shadowOpacity: 0,
    elevation: 0,
  },
  modalBackdropContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  floatingInputSheet: {
    backgroundColor: '#18181d',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 16 : 12,
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  quickTagsContainer: {
    marginBottom: 10,
  },
  quickTagsList: {
    gap: 8,
    paddingHorizontal: 2,
  },
  quickTagBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  quickTagBtnText: {
    color: '#ddd',
    fontSize: 12,
    fontWeight: '500',
  },
  modalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTextInput: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#F97316',
  },
  modalSendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#EA580C',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.2,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomColor: 'rgba(0, 0, 0, 0.45)',
    borderLeftColor: 'rgba(255, 255, 255, 0.15)',
    borderRightColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 5,
  },
  modalSendBtnDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderColor: 'rgba(255, 255, 255, 0.10)',
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(0, 0, 0, 0.35)',
    shadowOpacity: 0,
    elevation: 0,
  },
});
