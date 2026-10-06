import { roomInvite, parseRoomInvitation } from '../../services/room-invite';
import { openSafetyPanel } from './safety-sheet';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Modal, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { Crown, LogOut, Copy, Share2, Lock, KeyRound, Edit3, User, Users, UserMinus, ShieldAlert, Check, Sparkles, PlusCircle, LogIn, Eye, EyeOff, X, ClipboardPaste } from 'lucide-react-native';
import { socketService } from '../../services/socket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoomStore } from '../../store/useRoomStore';
import * as Clipboard from 'expo-clipboard';
import { VoicePanel } from './voice-panel';
import { ConfirmDialog } from './confirm-dialog';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { RoomActionButton } from './room-action-button';

export interface RoomEntryRequest { mode: 'create' | 'join'; id: number; }
import { useVoice } from '../../services/voice-service';

const USERNAME_CACHE_KEY = '@yiqikan_username';
export const LAST_ROOM_ID_CACHE_KEY = '@yiqikan_last_room_id';
export const LAST_ROOM_PASSWORD_CACHE_KEY = '@yiqikan_last_room_password';

const RANDOM_ADJECTIVES = ['快乐的', '调皮的', '机智的', '爱看剧的', '熬夜的', '闪光的', '摸鱼的', '元气的', '神秘的', '奔跑的', '可爱的', '酷酷的'];
const RANDOM_NOUNS = ['小恐龙', '小海獭', '爆米花', '小柯基', '大熊猫', '独角兽', '小浣熊', '旅行者', '向日葵', '星际猫', '小企鹅', '小考拉'];

export const generateRandomNick = () => {
  const adj = RANDOM_ADJECTIVES[Math.floor(Math.random() * RANDOM_ADJECTIVES.length)];
  const noun = RANDOM_NOUNS[Math.floor(Math.random() * RANDOM_NOUNS.length)];
  return `${adj}${noun}`;
};

interface RoomMember {
  id: string;
  name: string;
}

interface MembersPanelProps {
  entryRequest?: RoomEntryRequest;
  onEntryFormClose?: () => void;
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
  entryRequest,
  onEntryFormClose,
}: MembersPanelProps) {
  const formInsets = useSafeAreaInsets();
  const formFrame = useSafeAreaFrame();
  const [userName, setUserName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isEntryFormVisible, setIsEntryFormVisible] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const lastEntryRequestRef = useRef<number | null>(null);
  const entryInitializationRef = useRef(0);

  const [confirmDialogConfig, setConfirmDialogConfig] = useState<{
    visible: boolean;
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
    icon?: 'alert' | 'logout' | 'info';
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    visible: false,
    title: '',
    onConfirm: () => {},
  });

  const userNameInputRef = useRef<TextInput>(null);
  const roomIdInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
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
  const errorCode = useRoomStore((state) => state.errorCode);
  const roomState = useRoomStore((state) => state.roomState);
  const isHost = myUserId === hostId;
  const savedPassword = useRoomStore((state) => state.savedPassword);
  const setSavedPassword = useRoomStore((state) => state.setSavedPassword);

  useEffect(() => {
    AsyncStorage.getItem(USERNAME_CACHE_KEY).then((name) => {
      if (name) {
        setUserName(name);
      } else {
        const initialNick = generateRandomNick();
        setUserName(initialNick);
        AsyncStorage.setItem(USERNAME_CACHE_KEY, initialNick).catch(() => {});
      }
    }).catch(() => {});

  }, []);

  // 当处于房间中时，保持输入框与缓存同房间最新状态同步
  useEffect(() => {
    if (roomState?.id) {
      AsyncStorage.setItem(LAST_ROOM_ID_CACHE_KEY, roomState.id).catch(() => {});
      const pwd = savedPassword || passwordInput.trim() || '';
      if (pwd) {
        AsyncStorage.setItem(LAST_ROOM_PASSWORD_CACHE_KEY, pwd).catch(() => {});
      } else if (roomState.hasPassword === false) {
        AsyncStorage.removeItem(LAST_ROOM_PASSWORD_CACHE_KEY).catch(() => {});
      }
      setRoomIdInput(roomState.id);
      if (pwd) {
        setPasswordInput(pwd);
      }
    }
  }, [roomState?.id, roomState?.hasPassword, savedPassword]);

  const handleRandomizeNick = () => {
    const newNick = generateRandomNick();
    setUserName(newNick);
    AsyncStorage.setItem(USERNAME_CACHE_KEY, newNick).catch(() => {});
  };

  useEffect(() => {
    if (roomState && isConnecting) {
      setIsConnecting(false);
    }
  }, [roomState, isConnecting]);

  // 连接超时防呆机制（10秒无响应自动解除 loading 并提示）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (isConnecting) {
      timer = setTimeout(() => {
        setIsConnecting(false);
        useRoomStore.getState().setError('连接超时，请重试', 'TIMEOUT');
      }, 10000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isConnecting]);

  // 成功进房后确保关闭所有历史弹窗
  useEffect(() => {
    if (isInRoom) {
      setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
      setIsEntryFormVisible(false);
      entryInitializationRef.current += 1;
    }
  }, [isInRoom]);

  const handleJoin = async (overrideRoomId?: unknown) => {
    Keyboard.dismiss();
    const targetRoomId = (typeof overrideRoomId === 'string' ? overrideRoomId : roomIdInput).trim();
    if (targetRoomId && userName.trim()) {
      setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
      useRoomStore.getState().setError(null);
      setIsConnecting(true);
      await AsyncStorage.setItem(USERNAME_CACHE_KEY, userName.trim());
      await AsyncStorage.setItem(LAST_ROOM_ID_CACHE_KEY, targetRoomId);
      const trimmedPwd = passwordInput.trim();
      if (trimmedPwd) {
        setSavedPassword(trimmedPwd);
        await AsyncStorage.setItem(LAST_ROOM_PASSWORD_CACHE_KEY, trimmedPwd);
      } else {
        await AsyncStorage.removeItem(LAST_ROOM_PASSWORD_CACHE_KEY);
      }
      socketService.joinRoom(userName.trim(), targetRoomId, trimmedPwd || undefined);
    }
  };

  const handleCreate = async () => {
    Keyboard.dismiss();
    if (userName.trim()) {
      setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
      useRoomStore.getState().setError(null);
      setIsConnecting(true);
      await AsyncStorage.setItem(USERNAME_CACHE_KEY, userName.trim());
      const trimmedRoomId = roomIdInput.trim();
      if (trimmedRoomId) {
        await AsyncStorage.setItem(LAST_ROOM_ID_CACHE_KEY, trimmedRoomId);
      }
      const trimmedPwd = passwordInput.trim();
      if (trimmedPwd) {
        setSavedPassword(trimmedPwd);
        await AsyncStorage.setItem(LAST_ROOM_PASSWORD_CACHE_KEY, trimmedPwd);
      } else {
        await AsyncStorage.removeItem(LAST_ROOM_PASSWORD_CACHE_KEY);
      }
      socketService.createRoom(userName.trim(), trimmedRoomId || undefined, trimmedPwd || undefined);
    }
  };

  // 统一错误监听与用户交互反馈
  useEffect(() => {
    if (!error) return;

    if (isConnecting) {
      setIsConnecting(false);
    }

    // 后台网络重试引起的 CONNECT_ERROR 不向用户弹窗
    if (errorCode === 'CONNECT_ERROR' && !isConnecting) {
      return;
    }

    const trimmedRoomId = roomIdInput.trim();

    if (errorCode === 'ROOM_EXISTS' || error.includes('房间号已经存在')) {
      setConfirmDialogConfig({
        visible: true,
        title: '房间已存在',
        message: `房间号 ${trimmedRoomId ? `"${trimmedRoomId}" ` : ''}已被创建，是否直接加入该房间？`,
        confirmText: '直接加入',
        cancelText: '换个房间号',
        type: 'warning',
        icon: 'alert',
        onConfirm: () => {
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
          useRoomStore.getState().setError(null);
          handleJoin(trimmedRoomId);
        },
        onCancel: () => {
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
          useRoomStore.getState().setError(null);
          roomIdInputRef.current?.focus();
        },
      });
    } else if (errorCode === 'ROOM_NOT_FOUND' || error.includes('房间不存在')) {
      if (trimmedRoomId) {
        setConfirmDialogConfig({
          visible: true,
          title: '房间不存在',
          message: `未找到房间号 "${trimmedRoomId}"，对方可能尚未开启，是否直接由你创建该房间？`,
          confirmText: '新建此房间',
          cancelText: '取消',
          type: 'warning',
          icon: 'alert',
          onConfirm: () => {
            setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
            useRoomStore.getState().setError(null);
            handleCreate();
          },
          onCancel: () => {
            setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
            useRoomStore.getState().setError(null);
            roomIdInputRef.current?.focus();
          },
        });
      } else {
        setConfirmDialogConfig({
          visible: true,
          title: '房间不存在',
          message: '未找到该房间，请检查房间号后重试。',
          confirmText: '确定',
          cancelText: '',
          type: 'warning',
          icon: 'alert',
          onConfirm: () => {
            setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
            useRoomStore.getState().setError(null);
            roomIdInputRef.current?.focus();
          },
        });
      }
    } else if (errorCode === 'INVALID_PASSWORD' || error.includes('密码不正确')) {
      setConfirmDialogConfig({
        visible: true,
        title: '密码错误',
        message: '房间密码不正确，请输入正确的房间密码。',
        confirmText: '重新输入',
        cancelText: '',
        type: 'danger',
        icon: 'alert',
        onConfirm: () => {
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
          useRoomStore.getState().setError(null);
          passwordInputRef.current?.focus();
        },
      });
    } else if (errorCode === 'KICKED') {
      setConfirmDialogConfig({
        visible: true,
        title: '已被移出房间',
        message: error || '你已被移出该房间，暂无法重新加入。',
        confirmText: '确定',
        cancelText: '',
        type: 'danger',
        icon: 'logout',
        onConfirm: () => {
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
          useRoomStore.getState().setError(null);
        },
      });
    } else {
      setConfirmDialogConfig({
        visible: true,
        title: '提示',
        message: error,
        confirmText: '确定',
        cancelText: '',
        type: 'warning',
        icon: 'alert',
        onConfirm: () => {
          setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
          useRoomStore.getState().setError(null);
        },
      });
    }
  }, [error, errorCode, roomIdInput]);

  const handleSaveMemberName = async () => {
    if (newNickInput.trim() && roomState) {
      await AsyncStorage.setItem(USERNAME_CACHE_KEY, newNickInput.trim());
      socketService.updateMemberName(roomState.id, newNickInput.trim());
      setIsEditingMyName(false);
    }
  };

  const handleSaveRoomPassword = () => {
    if (!roomState || !isHost) return;
    const trimmed = newRoomPassword.trim();
    socketService.updateRoomPassword(roomState.id, trimmed || undefined);
    setSavedPassword(trimmed);
    if (trimmed) {
      AsyncStorage.setItem(LAST_ROOM_PASSWORD_CACHE_KEY, trimmed).catch(() => {});
    } else {
      AsyncStorage.removeItem(LAST_ROOM_PASSWORD_CACHE_KEY).catch(() => {});
    }
    setIsEditingPassword(false);
    useRoomStore.getState().showToast(trimmed ? '房间密码已更新' : '已取消房间密码');
  };

  const copyRoomCode = () => {
    if (!roomState?.id) return;
    Clipboard.setStringAsync(roomState.id);
    useRoomStore.getState().showToast('房间号已复制到剪贴板');
  };

  const copyInviteLink = () => {
    if (!roomState?.id) return;
    const shareText = roomInvite(roomState.id, roomState.hasPassword, savedPassword);
    Clipboard.setStringAsync(shareText).then(() => useRoomStore.getState().showToast('邀请口令已复制，可直接发给 TA'))
      .catch(() => useRoomStore.getState().showToast('复制失败，请重试'));
  };

  const openEntryForm = async (mode: 'create' | 'join') => {
    const initialization = ++entryInitializationRef.current;
    useRoomStore.getState().setError(null);
    setShowPassword(false);
    setPasteError(null);
    if (mode === 'create') {
      setRoomIdInput('');
      setPasswordInput('');
    } else {
      let cached: ReadonlyArray<readonly [string, string | null]> = [];
      try { cached = await AsyncStorage.multiGet([LAST_ROOM_ID_CACHE_KEY, LAST_ROOM_PASSWORD_CACHE_KEY]); } catch {}
      if (initialization !== entryInitializationRef.current) return;
      setRoomIdInput(cached[0]?.[1] ?? '');
      setPasswordInput(cached[1]?.[1] ?? '');
    }
    setIsEntryFormVisible(true);
  };

  const closeEntryForm = () => {
    if (isConnecting) return;
    entryInitializationRef.current += 1;
    Keyboard.dismiss();
    setIsEntryFormVisible(false);
    onEntryFormClose?.();
  };

  useEffect(() => {
    if (!entryRequest || isInRoom || entryRequest.id === lastEntryRequestRef.current) return;
    lastEntryRequestRef.current = entryRequest.id;
    void openEntryForm(entryRequest.mode);
  }, [entryRequest, isInRoom]);

  useEffect(() => () => { entryInitializationRef.current += 1; }, []);

  const handlePasteInvitation = async (openForm = false) => {
    const initialization = ++entryInitializationRef.current;
    const reportPasteError = (message: string) => {
      if (isEntryFormVisible) setPasteError(message);
      else useRoomStore.getState().showToast(message);
    };
    try {
      const text = await Clipboard.getStringAsync();
      if (initialization !== entryInitializationRef.current) return;
      const invite = parseRoomInvitation(text);
      if (!invite) { reportPasteError('未识别到邀请，可手动输入房间号'); return; }
      setPasteError(null);
      setRoomIdInput(invite.roomId);
      setPasswordInput(invite.password ?? '');
      if (openForm) {
        useRoomStore.getState().setError(null);
        setShowPassword(false);
        setIsEntryFormVisible(true);
      }
    } catch { reportPasteError('无法读取剪贴板，请在房间号输入框中粘贴或输入'); }
  };

  const confirmation = (
    <ConfirmDialog
      {...confirmDialogConfig}
      useNativeModal={!isEntryFormVisible}
      onCancel={() => {
        confirmDialogConfig.onCancel?.();
        setConfirmDialogConfig((prev) => ({ ...prev, visible: false }));
      }}
    />
  );

  return (
    <View style={styles.container}>
      {!isInRoom ? (
        <ScrollView contentContainerStyle={styles.entryActionsContent}>
          <View style={styles.entryIntro}>
            <Text style={styles.entryTitle}>和 TA 一起看</Text>
            <Text style={styles.entrySubtitle}>同步播放、聊弹幕，把好看的分享给 TA</Text>
          </View>
          <View style={styles.entryCards}>
            <RoomActionButton primary icon={PlusCircle} testID="room-panel-create" title="创建房间"
              subtitle="建好后邀请 TA" onPress={() => void openEntryForm('create')} />
            <RoomActionButton icon={LogIn} testID="room-panel-join" title="加入房间"
              subtitle="填写房间号或口令" onPress={() => void openEntryForm('join')} />
          </View>
          <TouchableOpacity testID="room-panel-paste" accessibilityLabel="粘贴邀请" accessibilityRole="button"
            style={styles.entryPasteButton} onPress={() => void handlePasteInvitation(true)} activeOpacity={0.75}>
            <ClipboardPaste size={16} strokeWidth={2.5} color="#fb923c" />
            <Text style={styles.entryPasteText}>粘贴邀请</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <>
          {/* 顶部房间信息操作卡片 */}
          <View style={styles.roomHeaderCard}>
        <View style={styles.roomMetaRow}>
          {/* 左侧：房号胶囊 + 语音胶囊 (紧密并排) */}
          <View style={styles.roomMetaLeft}>
            <TouchableOpacity
              style={styles.roomIdBadge}
              onPress={copyRoomCode}
              activeOpacity={0.7}
              testID="房号胶囊"
              accessibilityLabel={`房间号 ${roomState?.id}`}
            >
              <Text style={styles.roomIdText} numberOfLines={1}>
                <Text style={styles.roomIdLabel}>房号: </Text>
                <Text style={styles.roomIdValue}>{roomState?.id}</Text>
              </Text>
              <Copy size={12} color="#999" style={{ marginLeft: 5 }} />
            </TouchableOpacity>

            {/* 语音快捷控制胶囊 (紧挨房号) */}
            {roomState?.id && (
              <VoicePanel
                roomId={roomState.id}
                myUserId={myUserId}
                myName={userName || 'User'}
                compact={true}
              />
            )}
          </View>

          {/* 右侧：分享 & 退出 */}
          <View style={styles.roomActionButtons}>
            <TouchableOpacity
              style={styles.iconActionBtn}
              onPress={copyInviteLink}
              activeOpacity={0.7}
              testID="分享邀请口令"
              accessibilityLabel="分享邀请口令"
            >
              <Share2 size={15} color="#F97316" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.leaveBtn}
              onPress={onLeaveRoom}
              activeOpacity={0.7}
              testID="退出房间"
              accessibilityLabel="退出房间"
            >
              <LogOut size={15} color="#F87171" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 房间密码设置状态栏 */}
        <View style={styles.passwordRow}>
          <View style={styles.passwordStatus}>
            <Lock size={12} color={roomState?.hasPassword ? "#F97316" : "#666"} style={{ marginRight: 4 }} />
            <Text style={styles.passwordText}>
              {roomState?.hasPassword ? "已设密码保护" : "未设密码 · 拿到房间号即可加入"}
            </Text>
          </View>
          {isHost && (
            <TouchableOpacity
              style={styles.changePwdBtn}
              onPress={() => {
                setNewRoomPassword(savedPassword || '');
                setIsEditingPassword(true);
              }}
              activeOpacity={0.7}
            >
              <KeyRound size={11} color="#aaa" style={{ marginRight: 3 }} />
              <Text style={styles.changePwdBtnText}>
                {roomState?.hasPassword ? "修改密码" : "设置密码"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 成员列表 */}
      <ScrollView style={styles.membersList} contentContainerStyle={{ padding: 8, paddingBottom: 16 }}>
        <Text style={styles.listSectionTitle}>
          房间成员 ({members?.length || 0}人)
        </Text>

        {members?.map((member) => {
          const isMe = member.id === myUserId;
          const isMemberHost = hostId === member.id;
          const isSpeaking = voiceStatus === 'connected' && (isMe
            ? stats.isLocalSpeaking && !isMuted
            : stats.remoteSpeakingByUserId?.[member.id] === true);

          return (
            <TouchableOpacity
              key={member.id}
              testID={`room-member-${member.id}`}
              accessibilityLabel={`${member.name}，${isMemberHost ? '房主，' : ''}${isMe ? '我，点击修改昵称' : isHost ? '点击举报或管理' : '点击举报或屏蔽'}`}
              style={styles.memberRow}
              onPress={() => {
                if (isMe) {
                  setNewNickInput(member.name);
                  setIsEditingMyName(true);
                } else {
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
    </>
  )}

      <Modal visible={isEntryFormVisible && !isInRoom} animationType="slide" presentationStyle="fullScreen"
        onRequestClose={closeEntryForm}>
        <SafeAreaProvider initialMetrics={{ insets: formInsets, frame: formFrame }}>
        <KeyboardAvoidingView style={styles.formPage} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.formSafeArea}>
            <View style={styles.formHeader}>
              <View style={styles.formHeaderTitle}>
                <Users size={20} strokeWidth={2.5} color="#F97316" />
                <Text style={styles.formHeaderText}>创建 / 加入房间</Text>
              </View>
              <TouchableOpacity testID="room-entry-close" accessibilityLabel="关闭房间表单" accessibilityRole="button"
                style={styles.formCloseButton} onPress={closeEntryForm} disabled={isConnecting} activeOpacity={0.7}>
                <X size={22} color={isConnecting ? '#555' : '#ccc'} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.formContainer}
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <Text style={styles.formIntro}>和 TA 一起看，从这里开始</Text>
              {!!pasteError && <Text testID="room-entry-feedback" style={styles.formFeedback}>{pasteError}</Text>}
              {/* 昵称输入 + 随机昵称按钮 */}
              <View style={styles.inputGroup}>
                <View style={styles.inputLabelRow}>
                  <Text style={styles.inputLabel}>你的昵称</Text>
                  <TouchableOpacity
                    style={styles.randomNickBtn}
                    onPress={handleRandomizeNick}
                    activeOpacity={0.7}
                  >
                    <Sparkles size={12} color="#F97316" style={{ marginRight: 4 }} />
                    <Text style={styles.randomNickBtnText}>随机昵称</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  ref={userNameInputRef}
                  testID="房间昵称输入框"
                  accessibilityLabel="房间昵称输入框"
                  style={styles.input}
                  value={userName}
                  onChangeText={setUserName}
                  placeholder="例如：快乐的小恐龙"
                  placeholderTextColor="#666"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  keyboardAppearance="dark"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => roomIdInputRef.current?.focus()}
                />
              </View>

              {/* 房间号与密码输入 (并列双列) */}
              <View style={styles.twoColumnRow}>
                <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                  <View style={styles.inputLabelRow}>
                    <Text style={styles.inputLabel}>房间号</Text>
                    <View style={styles.roomIdLabelActions}>
                      <TouchableOpacity
                        testID="room-paste-invitation"
                        accessibilityLabel="粘贴 TA 的邀请口令"
                        accessibilityRole="button"
                        style={styles.pasteInviteButton}
                        onPress={() => handlePasteInvitation()}
                        disabled={isConnecting}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      >
                        <Copy size={11} color="#F97316" />
                        <Text style={styles.pasteInviteText}>粘贴</Text>
                      </TouchableOpacity>
                      {!!roomIdInput && (
                        <TouchableOpacity
                          onPress={() => {
                            setRoomIdInput('');
                            AsyncStorage.removeItem(LAST_ROOM_ID_CACHE_KEY).catch(() => {});
                          }}
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          testID="清空房间号"
                          accessibilityLabel="清空房间号"
                        >
                          <Text style={styles.clearBtnText}>清空</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  <TextInput
                    ref={roomIdInputRef}
                    style={styles.input}
                    value={roomIdInput}
                    onChangeText={text => {
                      const invite = parseRoomInvitation(text);
                      if (invite) { setRoomIdInput(invite.roomId); setPasswordInput(invite.password ?? ''); }
                      else setRoomIdInput(text);
                    }}
                    placeholder="房间号或邀请口令"
                    placeholderTextColor="#666"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    textContentType="none"
                    keyboardAppearance="dark"
                    returnKeyType="next"
                    submitBehavior="submit"
                    testID="房间号输入框"
                    accessibilityLabel="房间号输入框"
                    onSubmitEditing={() => passwordInputRef.current?.focus()}
                  />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <View style={styles.inputLabelRow}>
                    <Text style={styles.inputLabel}>房间密码 (选填)</Text>
                    {!!passwordInput && (
                      <TouchableOpacity
                        onPress={() => {
                          setPasswordInput('');
                          AsyncStorage.removeItem(LAST_ROOM_PASSWORD_CACHE_KEY).catch(() => {});
                        }}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        testID="清空房间密码"
                        accessibilityLabel="清空房间密码"
                      >
                        <Text style={styles.clearBtnText}>清空</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.passwordInputWrapper}>
                    <TextInput
                      ref={passwordInputRef}
                      style={styles.passwordInput}
                      value={passwordInput}
                      onChangeText={setPasswordInput}
                      placeholder="无密码可留空"
                      placeholderTextColor="#666"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      textContentType="none"
                      keyboardAppearance="dark"
                      secureTextEntry={!showPassword}
                      returnKeyType="done"
                      testID="房间密码输入框"
                      accessibilityLabel="房间密码输入框"
                      onSubmitEditing={() => {
                        Keyboard.dismiss();
                        if (roomIdInput.trim()) handleJoin();
                        else handleCreate();
                      }}
                    />
                    <TouchableOpacity
                      style={styles.passwordEyeBtn}
                      onPress={() => setShowPassword((prev) => !prev)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      testID="密码显隐切换"
                      accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? (
                        <EyeOff size={15} color="#F97316" />
                      ) : (
                        <Eye size={15} color="#888" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

            <View>
              {/* 操作按钮区：新建房间 & 加入房间 */}
              <View style={styles.formActionButtonsRow}>
                <TouchableOpacity
                  style={[styles.primaryButton, !userName.trim() && styles.buttonDisabled]}
                  onPress={handleCreate}
                  disabled={!userName.trim() || isConnecting}
                  activeOpacity={0.8}
                  testID="新建观影房间"
                  accessibilityLabel="新建观影房间"
                >
                  <PlusCircle size={16} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.primaryButtonText}>新建观影房间</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryButton, (!userName.trim() || !roomIdInput.trim()) && styles.buttonDisabled]}
                  onPress={handleJoin}
                  disabled={!userName.trim() || !roomIdInput.trim() || isConnecting}
                  activeOpacity={0.8}
                  testID="加入已有房间"
                  accessibilityLabel="加入已有房间"
                >
                  <LogIn size={15} color="#F97316" style={{ marginRight: 6 }} />
                  <Text style={styles.secondaryButtonText}>加入已有房间</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.roomEntryHint}>新建可留空房间号，加入需填写或粘贴邀请</Text>

              {isConnecting && (
                <View style={styles.loading}>
                  <ActivityIndicator size="small" color="#F97316" />
                  <Text style={styles.loadingText}>正在连接服务器...</Text>
                </View>
              )}
            </View>
            </ScrollView>
          </SafeAreaView>
          {confirmation}
        </KeyboardAvoidingView>
        </SafeAreaProvider>
      </Modal>

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
              placeholder="输入新房间密码（留空则无需密码）"
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
      <Modal visible={!!selectedMember} transparent animationType="fade" onRequestClose={() => setSelectedMember(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalDialog}>
            <Text style={styles.modalDialogTitle}>成员管理</Text>
            <Text style={styles.modalDialogSub}>要对成员 “{selectedMember?.name}” 执行什么操作？</Text>

            {isHost && <>
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

            </>}
            <TouchableOpacity testID="member-open-safety" style={styles.memberActionRow} onPress={() => {
              const target = selectedMember;
              setSelectedMember(null);
              if (target) setTimeout(() => openSafetyPanel({ mode: 'target', target }), 350);
            }}>
              <ShieldAlert color="#fb923c" size={18} style={{ marginRight: 10 }} />
              <Text style={styles.memberActionRowText}>举报或屏蔽此人</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.memberActionCancel} onPress={() => setSelectedMember(null)}>
              <Text style={styles.dialogCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {!isEntryFormVisible && confirmation}
    </View>
  );
}

const styles = StyleSheet.create({
  entryActionsContent: { padding: 16, gap: 16 },
  entryIntro: { gap: 6 },
  entryTitle: { color: '#eee', fontSize: 18, fontWeight: '700' },
  entrySubtitle: { color: '#888', fontSize: 12, lineHeight: 18 },
  entryCards: { flexDirection: 'row', gap: 10 },
  entryPasteButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', gap: 7, paddingHorizontal: 20, borderRadius: 12,
    backgroundColor: 'rgba(249,115,22,0.08)', borderWidth: 1, borderColor: 'rgba(249,115,22,0.18)' },
  entryPasteText: { color: '#fb923c', fontSize: 13, fontWeight: '600' },
  formPage: { flex: 1, backgroundColor: '#0D0E12' },
  formSafeArea: { flex: 1 },
  formHeader: { height: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  formHeaderTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  formHeaderText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  formCloseButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  formContent: { paddingTop: 24, paddingBottom: 24 },
  formIntro: { color: '#888', fontSize: 13, lineHeight: 20, marginBottom: 24 },
  formFeedback: { color: '#fb923c', fontSize: 12, lineHeight: 18, marginBottom: 18 },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  formContainer: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
  },
  inputGroup: {
    marginBottom: 18,
  },
  inputLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  inputLabel: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
  },
  roomIdLabelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pasteInviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.24)',
  },
  pasteInviteText: {
    color: '#F97316',
    fontSize: 10.5,
    fontWeight: '600',
  },
  roomEntryHint: {
    color: '#888',
    fontSize: 10.5,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 8,
  },
  clearBtnText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '500',
  },
  randomNickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  randomNickBtnText: {
    color: '#F97316',
    fontSize: 11,
    fontWeight: '600',
  },
  twoColumnRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    minHeight: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9.5,
    fontSize: 13,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.16)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderRightColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  passwordInputWrapper: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.16)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderRightColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  passwordInput: {
    flex: 1,
    color: '#fff',
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 9.5,
    fontSize: 13,
  },
  passwordEyeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 9.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  formActionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  primaryButton: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F97316',
    paddingVertical: 10.5,
    borderRadius: 12,
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.35)',
    borderBottomColor: 'rgba(0, 0, 0, 0.15)',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  secondaryButton: {
    minHeight: 48,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingVertical: 10.5,
    borderRadius: 12,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.18)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderRightColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  secondaryButtonText: {
    color: '#ddd',
    fontSize: 13,
    fontWeight: '600',
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
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  roomMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  roomMetaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  roomIdBadge: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    paddingHorizontal: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(0, 0, 0, 0.35)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderRightColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
    flexShrink: 0,
  },
  roomIdText: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  roomIdLabel: {
    color: '#9090a0',
    fontSize: 11.5,
    fontWeight: '500',
  },
  roomIdValue: {
    color: '#F97316',
    fontSize: 12.5,
    fontWeight: 'bold',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  roomActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconActionBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(0, 0, 0, 0.35)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderRightColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },
  leaveBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.22)',
    borderBottomColor: 'rgba(0, 0, 0, 0.35)',
    borderLeftColor: 'rgba(255, 255, 255, 0.10)',
    borderRightColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
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
    color: '#888',
    fontSize: 11.5,
    fontWeight: '600',
    marginBottom: 6,
    marginHorizontal: 12,
    marginTop: 2,
  },
  membersList: {
    flex: 1,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 12,
    paddingVertical: 9.5,
    borderRadius: 12,
    marginBottom: 6,
    marginHorizontal: 10,
    borderWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.10)',
    borderLeftColor: 'rgba(255, 255, 255, 0.06)',
    borderRightColor: 'rgba(255, 255, 255, 0.04)',
    borderBottomColor: 'rgba(255, 255, 255, 0.02)',
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
