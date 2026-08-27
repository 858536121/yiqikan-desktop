import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Send, MessageSquareDashed, MessageCircle } from 'lucide-react-native';
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

export function ChatPanel({
  messages,
  chatInput,
  setChatInput,
  onSend,
  isActive,
}: ChatPanelProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const myUserId = socketService.getUserId();

  useEffect(() => {
    if (isActive) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, isActive]);

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

      {/* 底部输入栏 */}
      <View style={styles.chatInputContainer}>
        <TextInput 
          style={styles.chatInput}
          placeholder="发条弹幕聊天互动吧..."
          placeholderTextColor="#666"
          value={chatInput}
          onChangeText={setChatInput}
          onSubmitEditing={onSend}
          returnKeyType="send"
          autoCorrect={false}
        />
        <TouchableOpacity 
          style={[styles.sendBtn, !chatInput.trim() && styles.sendBtnDisabled]} 
          onPress={onSend}
          disabled={!chatInput.trim()}
          activeOpacity={0.7}
        >
          <Send color="#fff" size={16} />
        </TouchableOpacity>
      </View>
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  bubbleOther: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  bubbleMe: {
    backgroundColor: 'rgba(249, 115, 22, 0.22)',
    borderTopRightRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
  },
  senderName: {
    color: '#aaa',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  senderNameMe: {
    color: '#F97316',
    textAlign: 'right',
  },
  messageText: {
    color: '#eee',
    fontSize: 13.5,
    lineHeight: 19,
  },
  messageTextMe: {
    color: '#fff',
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: '#16161a',
  },
  chatInput: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
    color: '#fff',
    fontSize: 13.5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(249, 115, 22, 0.35)',
  },
});
