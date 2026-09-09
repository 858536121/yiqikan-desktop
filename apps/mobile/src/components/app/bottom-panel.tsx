import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { MessageCircle, Users, Tv, ChevronDown, ChevronUp, Mic } from 'lucide-react-native';
import { ChatPanel } from './chat-panel';
import { MembersPanel } from './members-panel';
import { RemotePanel } from './remote-panel';
import { RotateToLandscapeIcon } from '../icons/ScreenRotationIcons';
import { useVoice } from '../../services/voice-service';

interface BottomPanelProps {
  isPanelCollapsed: boolean;
  setIsPanelCollapsed: (val: boolean) => void;
  onToggleFullscreen: () => void;
  hasVideo: boolean;
  isInRoom: boolean;
  isHost?: boolean;
  // Video state props
  videoState?: { currentTime: number; duration: number; paused: boolean };
  onPlayPause?: () => void;
  onSeek?: (time: number) => void;
  onCatchUp?: () => void;
  onRateChange?: (rate: number) => void;
  // Chat props
  chatMessages: any[];
  chatInput: string;
  setChatInput: (val: string) => void;
  onSendChat: () => void;
  // Members props
  members: any[];
  hostId: string;
  myUserId: string;
  onLeaveRoom: () => void;
  isKeyboardVisible?: boolean;
  onFormFocusChange?: (focused: boolean) => void;
}

export function BottomPanel({
  isPanelCollapsed,
  setIsPanelCollapsed,
  onToggleFullscreen,
  hasVideo,
  isInRoom,
  isHost = true,
  videoState,
  onPlayPause,
  onSeek,
  onCatchUp,
  onRateChange,
  chatMessages,
  chatInput,
  setChatInput,
  onSendChat,
  members,
  hostId,
  myUserId,
  onLeaveRoom,
  isKeyboardVisible = false,
  onFormFocusChange,
}: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<'remote' | 'chat' | 'members'>(!isInRoom ? 'members' : (hasVideo ? 'remote' : 'chat'));
  const [isFormFocused, setIsFormFocused] = useState(false);
  const { voiceStatus, stats } = useVoice();

  const handleFormFocusChange = (focused: boolean) => {
    setIsFormFocused(focused);
    onFormFocusChange?.(focused);
  };

  useEffect(() => {
    if (!isInRoom) {
      setActiveTab('members');
    } else if (!hasVideo && activeTab === 'remote') {
      setActiveTab('chat');
    }
  }, [hasVideo, activeTab, isInRoom]);

  const unreadCount = chatMessages.length;
  const isFormExpanded = !isInRoom && isFormFocused && isKeyboardVisible;

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' && isFormExpanded ? 'padding' : undefined} 
      style={[
        styles.bottomContainer, 
        isFormExpanded && styles.expandedBottomContainer,
        isPanelCollapsed && !isFormExpanded && styles.collapsedBottomContainer
      ]}
    >
      {/* 现代抽屉 Tab Header */}
      <View style={styles.panelHeader}>
        <View style={styles.tabGroup}>
          {hasVideo && (
            <TouchableOpacity 
              testID="遥控标签页"
              accessibilityLabel="遥控标签页"
              style={[styles.tabItem, activeTab === 'remote' && !isPanelCollapsed && styles.tabItemActive]} 
              onPress={() => { setIsPanelCollapsed(false); setActiveTab('remote'); }}
              activeOpacity={0.7}
            >
              <Tv color={activeTab === 'remote' && !isPanelCollapsed ? '#F97316' : '#888'} size={17} />
              <Text style={[styles.tabText, activeTab === 'remote' && !isPanelCollapsed && styles.tabTextActive]}>
                遥控
              </Text>
            </TouchableOpacity>
          )}

          {isInRoom && (
            <TouchableOpacity 
              testID="弹幕互动标签页"
              accessibilityLabel="弹幕互动标签页"
              style={[styles.tabItem, activeTab === 'chat' && !isPanelCollapsed && styles.tabItemActive]} 
              onPress={() => { setIsPanelCollapsed(false); setActiveTab('chat'); }}
              activeOpacity={0.7}
            >
              <MessageCircle color={activeTab === 'chat' && !isPanelCollapsed ? '#F97316' : '#888'} size={17} />
              <Text style={[styles.tabText, activeTab === 'chat' && !isPanelCollapsed && styles.tabTextActive]}>
                弹幕互动
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity 
            testID="房间成员标签页"
            accessibilityLabel="房间成员标签页"
            style={[styles.tabItem, activeTab === 'members' && !isPanelCollapsed && styles.tabItemActive]} 
            onPress={() => { setIsPanelCollapsed(false); setActiveTab('members'); }}
            activeOpacity={0.7}
          >
            <Users color={activeTab === 'members' && !isPanelCollapsed ? '#F97316' : '#888'} size={17} />
            <Text style={[styles.tabText, activeTab === 'members' && !isPanelCollapsed && styles.tabTextActive]}>
              {isInRoom ? `房间 (${members?.length || 0})` : '房间'}
            </Text>
            {voiceStatus === 'connected' && (
              <View style={[styles.voiceOnlineDot, (stats.isLocalSpeaking || stats.isRemoteSpeaking) && styles.voiceSpeakingDot]} />
            )}
          </TouchableOpacity>
        </View>

        {/* 右侧操作按钮组 */}
        <View style={styles.headerRightActions}>
          {hasVideo && (
            <TouchableOpacity style={styles.headerIconBtn} onPress={onToggleFullscreen} activeOpacity={0.7}>
              <RotateToLandscapeIcon color="#aaa" size={20} />
            </TouchableOpacity>
          )}

          <TouchableOpacity 
            style={styles.collapseToggleBtn} 
            onPress={() => setIsPanelCollapsed(!isPanelCollapsed)}
            activeOpacity={0.7}
          >
            {isPanelCollapsed ? (
              <ChevronUp color="#ddd" size={19} />
            ) : (
              <ChevronDown color="#ddd" size={19} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab 内容区 */}
      {(!isPanelCollapsed || isFormExpanded) && (
        <View style={styles.tabContent}>
          {activeTab === 'remote' ? (
            <RemotePanel 
              currentTime={videoState?.currentTime || 0}
              duration={videoState?.duration || 0}
              paused={videoState?.paused ?? true}
              onPlayPause={() => onPlayPause && onPlayPause()}
              onSeek={(time) => onSeek && onSeek(time)}
              isHost={isHost}
              onCatchUp={onCatchUp}
              onRateChange={onRateChange}
            />
          ) : activeTab === 'chat' ? (
            <ChatPanel 
              messages={chatMessages}
              chatInput={chatInput}
              setChatInput={setChatInput}
              onSend={onSendChat}
              isActive={activeTab === 'chat' && !isPanelCollapsed}
            />
          ) : (
            <MembersPanel 
              members={members}
              hostId={hostId}
              myUserId={myUserId}
              onLeaveRoom={onLeaveRoom}
              isInRoom={isInRoom}
              onFormFocusChange={handleFormFocusChange}
            />
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bottomContainer: {
    height: 350, // 👈 设为 350px
    backgroundColor: 'rgba(14, 15, 20, 0.82)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.10)',
  },
  expandedBottomContainer: {
    height: undefined,
    flex: 1,
  },
  collapsedBottomContainer: {
    height: 52,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 50,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(18, 19, 25, 0.70)',
  },
  tabGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6.5,
    borderRadius: 14,
    backgroundColor: 'transparent',
    gap: 5,
  },
  tabItemActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.16)',
    borderWidth: 1,
    borderTopColor: 'rgba(249, 115, 22, 0.55)',
    borderBottomColor: 'rgba(249, 115, 22, 0.18)',
    borderLeftColor: 'rgba(249, 115, 22, 0.28)',
    borderRightColor: 'rgba(249, 115, 22, 0.28)',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  tabText: {
    color: '#888',
    fontSize: 12.5,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#F97316',
    fontWeight: '700',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderRightColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 2,
  },
  collapseToggleBtn: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderRightColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 2,
  },
  voiceOnlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
    marginLeft: 2,
  },
  voiceSpeakingDot: {
    backgroundColor: '#F97316',
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  tabContent: {
    flex: 1,
  },
});
