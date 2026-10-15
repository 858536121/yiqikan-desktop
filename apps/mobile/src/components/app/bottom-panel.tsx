import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { MessageCircle, Users, Film, ChevronDown, ChevronUp, Mic } from 'lucide-react-native';
import { ChatPanel } from './chat-panel';
import { MembersPanel, RoomEntryRequest } from './members-panel';
import { RemotePanel } from './remote-panel';
import { RotateToLandscapeIcon } from '../icons/ScreenRotationIcons';
import { useVoice } from '../../services/voice-service';
import { useRoomStore } from '../../store/useRoomStore';
import { PlaybackHistoryItem } from '../../services/playback-history';

interface BottomPanelProps {
  roomEntryRequest?: RoomEntryRequest;
  onEntryFormClose?: () => void;
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
  lastHistory?: PlaybackHistoryItem | null;
  // Chat props
  chatMessages: any[];
  chatInput: string;
  setChatInput: (val: string) => void;
  onSendChat: () => Promise<boolean>;
  chatSendError?: string | null;
  // Members props
  members: any[];
  hostId: string;
  myUserId: string;
  onLeaveRoom: () => void;
  activeTab?: 'video' | 'chat' | 'members';
  onTabChange?: (tab: 'video' | 'chat' | 'members') => void;
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
  lastHistory,
  chatMessages,
  chatInput,
  setChatInput,
  onSendChat,
  chatSendError,
  members,
  hostId,
  myUserId,
  onLeaveRoom,
  activeTab: controlledTab,
  onTabChange,
  roomEntryRequest,
  onEntryFormClose,
}: BottomPanelProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<'video' | 'chat' | 'members'>(
    !isInRoom ? (hasVideo ? 'video' : 'members') : (hasVideo ? 'video' : 'chat')
  );
  const activeTab = controlledTab !== undefined ? controlledTab : internalActiveTab;

  const setActiveTab = (tab: 'video' | 'chat' | 'members') => {
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };

  const { voiceStatus, stats } = useVoice();

  const roomState = useRoomStore((state) => state.roomState);
  const roomId = roomState?.id || '';

  useEffect(() => {
    if (!isInRoom) {
      if (!hasVideo && activeTab !== 'members') {
        setActiveTab('members');
      }
    } else if (!hasVideo && activeTab === 'video') {
      setActiveTab('chat');
    }
  }, [hasVideo, activeTab, isInRoom]);

  const unreadCount = chatMessages.length;

  // 首页已提供明确入口，收起时不再重复占用底部空间。
  if (!isInRoom && !hasVideo && isPanelCollapsed) return null;

  return (
    <View
      style={[
        styles.bottomContainer,
        isPanelCollapsed && styles.collapsedBottomContainer
      ]}
    >
      {/* 现代抽屉 Tab Header / 首页快捷操作条 */}
      {isPanelCollapsed && !hasVideo ? (
        // 1. 首页收起态：根据是否已进房展示对应的一体化快捷动作条
          <TouchableOpacity 
            testID="首页房间状态条"
            accessibilityLabel={`观影房间 ${roomId}，${members?.length || 1}位成员`}
            style={styles.collapsedLobbyBar}
            onPress={() => { setActiveTab('members'); setIsPanelCollapsed(false); }}
            activeOpacity={0.75}
          >
            <View style={styles.collapsedRoomInfoGroup}>
              <View style={styles.collapsedRoomBadge}>
                <Text style={styles.collapsedRoomBadgeText} numberOfLines={1}>放映厅 #{roomId}</Text>
              </View>
              <View style={styles.collapsedMembersBadge}>
                <Users size={12} color="#aaa" style={{ marginRight: 4 }} />
                <Text style={styles.collapsedMembersText} numberOfLines={1}>{members?.length || 1}位成员</Text>
              </View>
              {voiceStatus === 'connected' && (
                <View style={[styles.voiceOnlineDot, (stats.isLocalSpeaking || stats.isRemoteSpeaking) && styles.voiceSpeakingDot]} />
              )}
            </View>
            <View style={styles.collapsedLobbyRight}>
              <Text style={styles.collapsedLobbyHint}>管理房间</Text>
              <ChevronUp color="#aaa" size={16} />
            </View>
          </TouchableOpacity>
      ) : (
        // 2. 展开态 或 视频播放态：展示标准标题/Tab栏
        <View style={styles.panelHeader}>
          {!hasVideo && !isInRoom ? (
            // 2A. 首页未进房展开态：简洁大气的面板标题（消除只有一个Tab的伪Tab栏）
            <View style={styles.expandedHeaderTitleGroup}>
              <Users size={15} color="#F97316" style={{ marginRight: 6 }} />
              <Text style={styles.expandedHeaderTitle}>创建 / 加入房间</Text>
            </View>
          ) : (
            // 2B. 视频播放态 或 首页已进房展开态：标准的 Tab 组
            <View style={styles.tabGroup}>
              {hasVideo && (
                <TouchableOpacity 
                  testID="视频标签页"
                  accessibilityLabel="视频标签页"
                  style={[styles.tabItem, activeTab === 'video' && !isPanelCollapsed && styles.tabItemActive]} 
                  onPress={() => { setIsPanelCollapsed(false); setActiveTab('video'); }}
                  activeOpacity={0.7}
                >
                  <Film color={activeTab === 'video' && !isPanelCollapsed ? '#F97316' : '#888'} size={15} />
                  <Text style={[styles.tabText, activeTab === 'video' && !isPanelCollapsed && styles.tabTextActive]}>
                    视频
                  </Text>
                </TouchableOpacity>
              )}

              {isInRoom && (
                <TouchableOpacity 
                  testID="弹幕互动标签页"
                  accessibilityLabel="弹幕互动"
                  style={[styles.tabItem, activeTab === 'chat' && !isPanelCollapsed && styles.tabItemActive]} 
                  onPress={() => { setIsPanelCollapsed(false); setActiveTab('chat'); }}
                  activeOpacity={0.7}
                >
                  <MessageCircle color={activeTab === 'chat' && !isPanelCollapsed ? '#F97316' : '#888'} size={15} />
                  <Text style={[styles.tabText, activeTab === 'chat' && !isPanelCollapsed && styles.tabTextActive]}>
                    弹幕
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity 
                testID="房间成员标签页"
                accessibilityLabel={isInRoom ? `房间 (${members?.length || 0})` : '房间'}
                style={[styles.tabItem, activeTab === 'members' && !isPanelCollapsed && styles.tabItemActive]} 
                onPress={() => { setIsPanelCollapsed(false); setActiveTab('members'); }}
                activeOpacity={0.7}
              >
                <Users color={activeTab === 'members' && !isPanelCollapsed ? '#F97316' : '#888'} size={15} />
                <Text style={[styles.tabText, activeTab === 'members' && !isPanelCollapsed && styles.tabTextActive]}>
                  {isInRoom ? `房间 (${members?.length || 0})` : '房间'}
                </Text>
                {voiceStatus === 'connected' && (
                  <View style={[styles.voiceOnlineDot, (stats.isLocalSpeaking || stats.isRemoteSpeaking) && styles.voiceSpeakingDot]} />
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* 右侧操作按钮组 */}
          <View style={styles.headerRightActions}>
            {hasVideo && (
              <TouchableOpacity 
                testID="切换横竖屏按钮"
                accessibilityLabel="切换横竖屏按钮"
                style={styles.headerIconBtn} 
                onPress={onToggleFullscreen} 
                activeOpacity={0.7}
              >
                <RotateToLandscapeIcon color="#aaa" size={18} />
              </TouchableOpacity>
            )}

            <TouchableOpacity 
              testID="折叠面板按钮"
              accessibilityLabel="折叠面板按钮"
              style={styles.collapseToggleBtn} 
              onPress={() => setIsPanelCollapsed(!isPanelCollapsed)}
              activeOpacity={0.7}
            >
              {isPanelCollapsed ? (
                <ChevronUp color="#ddd" size={18} />
              ) : (
                <ChevronDown color="#ddd" size={18} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Tab 内容区 */}
      {(!isPanelCollapsed) && (
        <View style={styles.tabContent}>
          {activeTab === 'video' ? (
            <RemotePanel 
              currentTime={videoState?.currentTime || 0}
              duration={videoState?.duration || 0}
              paused={videoState?.paused ?? true}
              onPlayPause={() => onPlayPause && onPlayPause()}
              onSeek={(time) => onSeek && onSeek(time)}
              isHost={isHost}
              onCatchUp={onCatchUp}
              lastHistory={lastHistory}
            />
          ) : activeTab === 'chat' ? (
            <ChatPanel 
              messages={chatMessages}
              chatInput={chatInput}
              setChatInput={setChatInput}
              onSend={onSendChat}
              sendError={chatSendError}
              isActive={activeTab === 'chat' && !isPanelCollapsed}
            />
          ) : (
            <MembersPanel 
              members={members}
              hostId={hostId}
              myUserId={myUserId}
              onLeaveRoom={onLeaveRoom}
              entryRequest={roomEntryRequest}
              onEntryFormClose={onEntryFormClose}
              isInRoom={isInRoom}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bottomContainer: {
    height: 280, // 各标签共用同一高度，切换时保持视频区域稳定
    backgroundColor: 'rgba(14, 15, 20, 0.82)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.10)',
  },
  collapsedBottomContainer: {
    height: 48,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(18, 19, 25, 0.70)',
  },
  tabGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1, // 允许 Tab 组弹性自适应收缩
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9, // 由 12 调整为 9，紧凑且留有充足点击区
    paddingVertical: 6,   // 由 7 调整为 6
    borderRadius: 12,
    backgroundColor: 'transparent',
    gap: 4,
  },
  tabItemActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.16)',
    borderWidth: 1,
    borderColor: Platform.OS === 'android' ? 'rgba(249, 115, 22, 0.38)' : undefined,
    borderTopColor: Platform.OS !== 'android' ? 'rgba(249, 115, 22, 0.55)' : undefined,
    borderBottomColor: Platform.OS !== 'android' ? 'rgba(249, 115, 22, 0.18)' : undefined,
    borderLeftColor: Platform.OS !== 'android' ? 'rgba(249, 115, 22, 0.28)' : undefined,
    borderRightColor: Platform.OS !== 'android' ? 'rgba(249, 115, 22, 0.28)' : undefined,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: Platform.OS === 'android' ? 0 : 3,
  },
  tabText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#F97316',
    fontWeight: '700',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0, // 保持操作按钮组固定不被挤压
    marginLeft: 8, // 与 Tab 组保持至少 8px 绝对安全间距，彻底解决重叠
  },
  headerIconBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.12)' : undefined,
    borderTopColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.22)' : undefined,
    borderBottomColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.05)' : undefined,
    borderLeftColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.10)' : undefined,
    borderRightColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.10)' : undefined,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: Platform.OS === 'android' ? 0 : 2,
  },
  collapseToggleBtn: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.12)' : undefined,
    borderTopColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.22)' : undefined,
    borderBottomColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.05)' : undefined,
    borderLeftColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.10)' : undefined,
    borderRightColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.10)' : undefined,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: Platform.OS === 'android' ? 0 : 2,
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
  collapsedLobbyBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    height: 48,
    backgroundColor: 'rgba(18, 19, 25, 0.88)',
  },
  collapsedLobbyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F97316',
    paddingHorizontal: 12,
    paddingVertical: 5.5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Platform.OS === 'android' ? 'rgba(255, 255, 255, 0.25)' : undefined,
    borderTopColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.45)' : undefined,
    borderBottomColor: Platform.OS !== 'android' ? 'rgba(0, 0, 0, 0.30)' : undefined,
    borderLeftColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.18)' : undefined,
    borderRightColor: Platform.OS !== 'android' ? 'rgba(255, 255, 255, 0.18)' : undefined,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.38,
    shadowRadius: 6,
    elevation: Platform.OS === 'android' ? 0 : 3,
  },
  collapsedLobbyActionText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.2,
  },
  collapsedLobbyRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  collapsedLobbyHint: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    fontWeight: '500',
  },
  collapsedRoomInfoGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  collapsedRoomBadge: {
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.32)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  collapsedRoomBadgeText: {
    color: '#F97316',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  collapsedMembersBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  collapsedMembersText: {
    color: '#bbb',
    fontSize: 11,
    fontWeight: '500',
  },
  expandedHeaderTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
  },
  expandedHeaderTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
