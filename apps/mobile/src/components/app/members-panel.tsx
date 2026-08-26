import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Modal } from 'react-native';
import { Crown, LogOut, Copy, Share2, Lock, KeyRound, Edit3, User, UserMinus, ShieldAlert, Check } from 'lucide-react-native';
import { socketService } from '../../services/socket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoomStore } from '../../store/useRoomStore';
import * as Clipboard from 'expo-clipboard';
import { VoicePanel } from './voice-panel';
import { useVoice } from '../../services/voice-service';

const USERNAME_CACHE_KEY = '@yiqikan_username';

interface RoomMember {
  id: string;
  name: string;
}

interface MembersPanelProps {
  members: RoomMember[];
  hostId: string;
  myUserId: string;
  onLeaveRoom: () => void;
  isInRoom?: boolean;
}

export function MembersPanel({
  members,
  hostId,
  myUserId,
  onLeaveRoom,
  isInRoom = true,
}: MembersPanelProps) {
  const [userName, setUserName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const { voiceStatus, isMuted, stats } = useVoice();

  // 在线改名状态
  const [isEditingMyName, setIsEditingMyName] = useState(false);
  const [newNickInput, setNewNickInput] = useState('');

  // 房主修改密码状态
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [newRoomPassword, setNewRoomPassword] = useState('');

  // 成员操作弹窗
  const [selectedMember, setSelectedMember] = useState<RoomMember | null>(null);

  const error = useRoomStore((state) => state.error);
  const roomState = useRoomStore((state) => state.roomState);
  const isHost = myUserId === hostId;
  const savedPassword = useRoomStore((state) => state.savedPassword);
  const setSavedPassword = useRoomStore((state) => state.setSavedPassword);

  useEffect(() => {
    AsyncStorage.getItem(USERNAME_CACHE_KEY).then((name) => {
      if (name) setUserName(name);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (roomState && isConnecting) {
      setIsConnecting(false);
    }
  }, [roomState, isConnecting]);

  useEffect(() => {
    if (error && isConnecting) {
      setIsConnecting(false);
    }
  }, [error, isConnecting]);

  const handleJoin = async () => {
    if (roomIdInput.trim() && userName.trim()) {
      setIsConnecting(true);
      await AsyncStorage.setItem(USERNAME_CACHE_KEY, userName.trim());
      if (passwordInput.trim()) {
        setSavedPassword(passwordInput.trim());
      }
      socketService.joinRoom(userName.trim(), roomIdInput.trim(), passwordInput.trim() || undefined);
    }
  };

  const handleCreate = async () => {
    if (userName.trim()) {
      setIsConnecting(true);
      await AsyncStorage.setItem(USERNAME_CACHE_KEY, userName.trim());
      if (passwordInput.trim()) {
        setSavedPassword(passwordInput.trim());
      }
      socketService.createRoom(userName.trim(), roomIdInput.trim() || undefined, passwordInput.trim() || undefined);
    }
  };

  const handleSaveMemberName = async () => {
    if (newNickInput.trim() && roomState) {
      await AsyncStorage.setItem(USERNAME_CACHE_KEY, newNickInput.trim());
      socketService.updateMemberName(roomState.id, newNickInput.trim());
      setIsEditingMyName(false);
    }
  };

  const handleSaveRoomPassword = () => {
    if (!roomState || !isHost) return;
    socketService.updateRoomPassword(roomState.id, newRoomPassword.trim() || undefined);
    setSavedPassword(newRoomPassword.trim());
    setIsEditingPassword(false);
    Alert.alert('提示', newRoomPassword.trim() ? '房间密码已更新' : '已取消房间密码');
  };

  const copyRoomCode = () => {
    if (!roomState?.id) return;
    Clipboard.setStringAsync(roomState.id);
    Alert.alert('已复制', '房间号已复制到剪贴板');
  };

  const copyInviteLink = () => {
    if (!roomState?.id) return;
    const base = 'https://yiqikan.cpolar.cn/join';
    const pwd = savedPassword || '';
    const url = roomState.hasPassword && pwd 
      ? `${base}/${roomState.id}?password=${encodeURIComponent(pwd)}`
      : `${base}/${roomState.id}`;
    Clipboard.setStringAsync(url);
    Alert.alert('邀请链接已复制', roomState.hasPassword && pwd ? '链接已自动附带房间密码' : '已复制房间专属链接');
  };

  if (!isInRoom) {
    return (
      <ScrollView style={styles.formContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>你的昵称</Text>
          <TextInput
            style={styles.input}
            value={userName}
            onChangeText={setUserName}
            placeholder="例如：快乐的小恐龙"
            placeholderTextColor="#666"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>房间号 (选填)</Text>
          <TextInput
            style={styles.input}
            value={roomIdInput}
            onChangeText={setRoomIdInput}
            placeholder="创建时留空可自动随机生成"
            placeholderTextColor="#666"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>房间密码 (选填)</Text>
          <TextInput
            style={styles.input}
            value={passwordInput}
            onChangeText={setPasswordInput}
            placeholder="若房间有密码保护请输入"
            placeholderTextColor="#666"
            secureTextEntry
          />
        </View>
        
        <TouchableOpacity 
          style={[styles.primaryButton, (!userName.trim() || !roomIdInput.trim()) && styles.buttonDisabled]} 
          onPress={handleJoin}
          disabled={!userName.trim() || !roomIdInput.trim() || isConnecting}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>加入已有房间</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.secondaryButton, !userName.trim() && styles.buttonDisabled]} 
          onPress={handleCreate}
          disabled={!userName.trim() || isConnecting}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryButtonText}>新建观影房间</Text>
        </TouchableOpacity>
        
        {isConnecting && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color="#F97316" />
            <Text style={styles.loadingText}>正在连接服务器...</Text>
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      {/* 顶部房间信息操作卡片 */}
      <View style={styles.roomHeaderCard}>
        <View style={styles.roomMetaRow}>
          <View style={styles.roomIdBadge}>
            <Text style={styles.roomIdLabel}>房间号: </Text>
            <Text style={styles.roomIdValue} selectable>{roomState?.id}</Text>
          </View>

          <View style={styles.roomActionButtons}>
            <TouchableOpacity style={styles.iconActionBtn} onPress={copyRoomCode}>
              <Copy size={15} color="#ddd" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconActionBtn} onPress={copyInviteLink}>
              <Share2 size={15} color="#F97316" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.leaveBtn} onPress={onLeaveRoom}>
              <LogOut size={15} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 房间密码设置状态栏 */}
        <View style={styles.passwordRow}>
          <View style={styles.passwordStatus}>
            <Lock size={13} color={roomState?.hasPassword ? "#F97316" : "#666"} style={{ marginRight: 5 }} />
            <Text style={styles.passwordText}>
              {roomState?.hasPassword ? "房间已设密码保护" : "公开房间 (无密码)"}
            </Text>
          </View>
          {isHost && (
            <TouchableOpacity 
              style={styles.changePwdBtn} 
              onPress={() => {
                setNewRoomPassword(savedPassword || '');
                setIsEditingPassword(true);
              }}
            >
              <KeyRound size={12} color="#aaa" style={{ marginRight: 4 }} />
              <Text style={styles.changePwdBtnText}>
                {roomState?.hasPassword ? "修改密码" : "设置密码"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 成员列表与语音卡片 */}
      <ScrollView style={styles.membersList} contentContainerStyle={{ padding: 12 }}>
        {/* 常驻语音对讲频道卡片 */}
        {roomState?.id && (
          <VoicePanel 
            roomId={roomState.id} 
            myUserId={myUserId} 
            myName={userName || 'User'} 
          />
        )}

        <Text style={styles.listSectionTitle}>
          在线成员 ({members?.length || 0}人)
        </Text>

        {members?.map((member) => {
          const isMe = member.id === myUserId;
          const isMemberHost = hostId === member.id;
          const isSpeaking = (isMe && stats.isLocalSpeaking && !isMuted) || (!isMe && stats.isRemoteSpeaking && voiceStatus === 'connected');

          return (
            <TouchableOpacity 
              key={member.id} 
              style={styles.memberRow} 
              onPress={() => {
                if (isMe) {
                  setNewNickInput(member.name);
                  setIsEditingMyName(true);
                } else if (isHost) {
                  setSelectedMember(member);
                }
              }}
              activeOpacity={0.7}
            >
              <View style={styles.memberLeft}>
                <View style={[styles.avatar, isMemberHost && styles.avatarHost, isSpeaking && styles.avatarSpeaking]}>
                  <Text style={styles.avatarText}>{member.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    {isMe && <Text style={styles.meTag}>(我)</Text>}
                  </View>
                  {isMe && (
                    <Text style={styles.editNameHint}>点击可在线修改昵称</Text>
                  )}
                </View>
              </View>

              <View style={styles.memberRight}>
                {isMemberHost && (
                  <View style={styles.hostBadge}>
                    <Crown color="#F59E0B" size={14} style={{ marginRight: 3 }} />
                    <Text style={styles.hostBadgeText}>房主</Text>
                  </View>
                )}
                {isMe && (
                  <Edit3 size={14} color="#666" style={{ marginLeft: 6 }} />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 在线修改自己昵称 Modal */}
      <Modal visible={isEditingMyName} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalDialog}>
            <Text style={styles.modalDialogTitle}>修改房间昵称</Text>
            <TextInput
              style={styles.dialogInput}
              value={newNickInput}
              onChangeText={setNewNickInput}
              placeholder="输入新昵称"
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.dialogCancelBtn} onPress={() => setIsEditingMyName(false)}>
                <Text style={styles.dialogCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogConfirmBtn} onPress={handleSaveMemberName}>
                <Text style={styles.dialogConfirmText}>保存广播</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 房主修改房间密码 Modal */}
      <Modal visible={isEditingPassword} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalDialog}>
            <Text style={styles.modalDialogTitle}>设置 / 修改房间密码</Text>
            <Text style={styles.modalDialogSub}>留空保存则表示取消密码保护，所有人可自由加入</Text>
            <TextInput
              style={styles.dialogInput}
              value={newRoomPassword}
              onChangeText={setNewRoomPassword}
              placeholder="输入新房间密码 (留空为公开)"
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.dialogCancelBtn} onPress={() => setIsEditingPassword(false)}>
                <Text style={styles.dialogCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogConfirmBtn} onPress={handleSaveRoomPassword}>
                <Text style={styles.dialogConfirmText}>确定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 房主管理成员操作 Modal */}
      <Modal visible={!!selectedMember} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalDialog}>
            <Text style={styles.modalDialogTitle}>成员管理</Text>
            <Text style={styles.modalDialogSub}>要对成员 “{selectedMember?.name}” 执行什么操作？</Text>
            
            <TouchableOpacity 
              style={styles.memberActionRow} 
              onPress={() => {
                if (selectedMember && roomState) {
                  socketService.transferHost(roomState.id, selectedMember.id);
                  setSelectedMember(null);
                }
              }}
            >
              <Crown color="#F59E0B" size={18} style={{ marginRight: 10 }} />
              <Text style={styles.memberActionRowText}>转让房主权限</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.memberActionRow, { borderBottomWidth: 0 }]} 
              onPress={() => {
                if (selectedMember && roomState) {
                  socketService.kickMember(roomState.id, selectedMember.id);
                  setSelectedMember(null);
                }
              }}
            >
              <UserMinus color="#ef4444" size={18} style={{ marginRight: 10 }} />
              <Text style={[styles.memberActionRowText, { color: '#ef4444' }]}>移出房间</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.memberActionCancel} onPress={() => setSelectedMember(null)}>
              <Text style={styles.dialogCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121215',
  },
  formContainer: {
    flex: 1,
    padding: 20,
    backgroundColor: '#121215',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  primaryButton: {
    backgroundColor: '#F97316',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.3)',
  },
  secondaryButtonText: {
    color: '#F97316',
    fontSize: 14,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  loading: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
  },
  loadingText: {
    color: '#aaa',
    marginLeft: 8,
    fontSize: 13,
  },
  roomHeaderCard: {
    backgroundColor: '#18181d',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  roomMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  roomIdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  roomIdLabel: {
    color: '#888',
    fontSize: 12,
  },
  roomIdValue: {
    color: '#F97316',
    fontSize: 13,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  roomActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconActionBtn: {
    padding: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  leaveBtn: {
    padding: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  passwordStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordText: {
    color: '#888',
    fontSize: 12,
  },
  changePwdBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  changePwdBtnText: {
    color: '#aaa',
    fontSize: 11,
  },
  listSectionTitle: {
    color: '#777',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  membersList: {
    flex: 1,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatarHost: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  avatarSpeaking: {
    borderColor: '#22C55E',
    borderWidth: 2,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  avatarText: {
    color: '#eee',
    fontSize: 14,
    fontWeight: 'bold',
  },
  memberName: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '500',
  },
  meTag: {
    color: '#F97316',
    fontSize: 12,
    marginLeft: 5,
    fontWeight: '600',
  },
  editNameHint: {
    color: '#666',
    fontSize: 10.5,
    marginTop: 1,
  },
  memberRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  hostBadgeText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalDialog: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1c1c22',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalDialogTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  modalDialogSub: {
    color: '#888',
    fontSize: 12,
    marginBottom: 14,
    lineHeight: 16,
  },
  dialogInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#F97316',
    marginBottom: 16,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  dialogCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  dialogCancelText: {
    color: '#888',
    fontSize: 13,
  },
  dialogConfirmBtn: {
    backgroundColor: '#F97316',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  dialogConfirmText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  memberActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  memberActionRowText: {
    color: '#eee',
    fontSize: 14,
  },
  memberActionCancel: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 8,
  },
});
