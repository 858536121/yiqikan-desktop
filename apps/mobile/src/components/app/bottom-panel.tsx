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
}: BottomPanelProps) {
  const [activeTab, setActiveTab] = useState<'remote' | 'chat' | 'members'>(!isInRoom ? 'members' : (hasVideo ? 'remote' : 'chat'));
  const { voiceStatus, stats } = useVoice();

  useEffect(() => {
    if (!isInRoom) {
      setActiveTab('members');
    } else if (!hasVideo && activeTab === 'remote') {
      setActiveTab('chat');
    }
  }, [hasVideo, activeTab, isInRoom]);

  const unreadCount = chatMessages.length;

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
      style={[styles.bottomContainer, isPanelCollapsed && styles.collapsedBottomContainer]}
    >
      {/* 现代抽屉 Tab Header */}
      <View style={styles.panelHeader}>
        <View style={styles.tabGroup}>
          {hasVideo && (
            <TouchableOpacity 
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

          <TouchableOpacity 
            style={[styles.tabItem, activeTab === 'chat' && !isPanelCollapsed && styles.tabItemActive]} 
            onPress={() => { setIsPanelCollapsed(false); setActiveTab('chat'); }}
            activeOpacity={0.7}
          >
            <MessageCircle color={activeTab === 'chat' && !isPanelCollapsed ? '#F97316' : '#888'} size={17} />
            <Text style={[styles.tabText, activeTab === 'chat' && !isPanelCollapsed && styles.tabTextActive]}>
              弹幕互动
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
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
              <ChevronUp color="#888" size={20} />
            ) : (
              <ChevronDown color="#888" size={20} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab 内容区 */}
      {!isPanelCollapsed && (
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
    backgroundColor: '#141418',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
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
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: '#16161a',
  },
  tabGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'transparent',
    gap: 5,
  },
  tabItemActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
  },
  tabText: {
    color: '#888',
    fontSize: 12.5,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#F97316',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerIconBtn: {
    padding: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  collapseToggleBtn: {
    padding: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
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
