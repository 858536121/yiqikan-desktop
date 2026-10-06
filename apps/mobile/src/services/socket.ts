import { io, Socket } from 'socket.io-client';
import { 
  ROOM_EVENTS, 
  RoomState, 
  PlaybackSyncResponsePayload, 
  ChatMessagePayload, 
  PlayerEventPayload,
  CreateRoomPayload,
  JoinRoomPayload,
  UpdateRoomPasswordPayload,
  UpdateMemberNamePayload,
  YIQIKAN_PROTOCOL_VERSION
} from '@yiqikan/shared';
import { useRoomStore } from '../store/useRoomStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveServerUrl } from './environment';

const SERVER_URL = resolveServerUrl();
const SESSION_KEY = '@yiqikan_session_id';
const SAFETY_TOKEN_KEY = '@yiqikan_safety_token';
import type { SafetyReportInput, SafetyBlock, SafetyResult, ChatMessageResult, CloseRoomPayload } from '@yiqikan/shared';

class SocketService {
  private socket: Socket | null = null;
  private safetyToken: string | null = null;
  private sessionId: string | null = null;
  private currentVideoPlaybackGetter: (() => { currentTime: number; paused: boolean; playbackRate: number; duration?: number }) | null = null;

  registerPlaybackGetter(getter: () => { currentTime: number; paused: boolean; playbackRate: number; duration?: number }) {
    this.currentVideoPlaybackGetter = getter;
  }

  unregisterPlaybackGetter() {
    this.currentVideoPlaybackGetter = null;
  }

  async initSession() {
    try {
      let storedId = await AsyncStorage.getItem(SESSION_KEY);
      if (!storedId) {
        storedId = 'mob_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        await AsyncStorage.setItem(SESSION_KEY, storedId);
      }
      this.sessionId = storedId;
      this.safetyToken = await AsyncStorage.getItem(SAFETY_TOKEN_KEY);
    } catch (e) {
      console.error('Failed to init session', e);
      this.sessionId = 'temp_' + Date.now();
    }
  }

  private connectPromise: Promise<void> | null = null;

  async connect(serverUrl: string = SERVER_URL) {
    if (this.socket?.connected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      if (!this.sessionId) {
        await this.initSession();
      }

      if (this.socket) {
        if (!this.socket.connected) {
          this.socket.connect();
        }
        return;
      }

      this.socket = io(serverUrl, {
        transports: ['websocket'],
        autoConnect: true,
        auth: {
          sessionId: this.sessionId,
          supportsSafety: true,
          ...(this.safetyToken ? { safetyToken: this.safetyToken } : {}),
          client: {
            appName: '异起看',
            appVersion: '1.0.0',
            hotVersion: null,
            protocolVersion: YIQIKAN_PROTOCOL_VERSION,
            platform: 'mobile',
            releaseChannel: 'stable',
          },
        }
      });

      this.setupListeners();
    })().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private lastRoomContext: { roomId: string; userName: string; password?: string; isHost?: boolean } | null = null;
  private hasReceivedSnapshotAfterConnect = false;

  private setupListeners() {
    if (!this.socket) return;

    this.socket.on(ROOM_EVENTS.SafetyIdentity, (identity: { userId: string; token: string }) => {
      this.sessionId = identity.userId;
      this.safetyToken = identity.token;
      if (this.socket) this.socket.auth = { ...(this.socket.auth as object), supportsSafety: true, safetyToken: identity.token, sessionId: identity.userId };
      AsyncStorage.multiSet([[SESSION_KEY, identity.userId], [SAFETY_TOKEN_KEY, identity.token]])
        .catch(() => useRoomStore.getState().showToast('房间身份保存失败，重启后屏蔽记录可能无法恢复'));
    });

    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket?.id);
      useRoomStore.getState().setConnected(true);
      this.hasReceivedSnapshotAfterConnect = false;

      // 断线重连自愈：检查是否需要恢复房间会话
      if (this.lastRoomContext) {
        const { roomId, userName, password } = this.lastRoomContext;
        setTimeout(() => {
          // 如果连接已恢复，但服务端未在 700ms 内自动下发快照（说明超过 30s 宽限期会话已被服务端移除），
          // 主动重新触发 joinRoom 恢复会话，避免成为孤儿假死客户端
          if (this.socket?.connected && this.lastRoomContext && !this.hasReceivedSnapshotAfterConnect) {
            console.log('[Socket] 服务端未自动恢复会话，尝试重新加入房间自愈:', roomId);
            this.joinRoom(userName, roomId, password);
          }
        }, 700);
      }
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      useRoomStore.getState().setConnected(false);
      this.hasReceivedSnapshotAfterConnect = false;
    });

    this.socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
      console.log('Socket connect error:', error.message);
      const restricted = error.data?.code === 'CONTENT_RESTRICTED' || error.message.startsWith('服务访问暂受限制');
      if (restricted) {
        this.lastRoomContext = null;
        useRoomStore.getState().reset();
      }
      useRoomStore.getState().setError(restricted ? '服务访问暂受限制，请通过帮助与反馈联系开发者' : '无法连接到服务器', restricted ? 'CONTENT_RESTRICTED' : 'CONNECT_ERROR');
      useRoomStore.getState().setConnected(false);
      this.hasReceivedSnapshotAfterConnect = false;
    });

    // 监听房间状态快照（加入/创建房间成功或断线重连恢复时下发）
    this.socket.on(ROOM_EVENTS.StateSnapshot, (state: RoomState) => {
      this.hasReceivedSnapshotAfterConnect = true;
      const myId = this.getUserId();
      const isHost = state.hostId === myId || state.hostId === `socket:${this.socket?.id}`;
      useRoomStore.getState().setRoomState(state);
      useRoomStore.getState().setIsHost(isHost);
      useRoomStore.getState().setConnected(true);
      useRoomStore.getState().setError(null);
      if (this.lastRoomContext) {
        this.lastRoomContext.roomId = state.id;
        this.lastRoomContext.isHost = isHost;
      }

      // [P1-1 修复]：非房主收到房间快照时，若快照包含播放进度，触发播放器同步以对齐最新进度
      if (!isHost && state.playback?.url) {
        useRoomStore.getState().handleRemotePlayerEvent({
          roomId: state.id,
          actorId: state.hostId || '',
          action: 'video_sync',
          currentTime: state.playback.currentTime || 0,
          playbackRate: state.playback.playbackRate || 1,
          paused: state.playback.paused ?? true,
          duration: state.playback.duration ?? undefined,
          syncId: state.playback.syncId,
        });
      }
    });

    // 监听房间状态更新（成员变化等）
    this.socket.on(ROOM_EVENTS.StateUpdate, (state: RoomState) => {
      const myId = this.getUserId();
      useRoomStore.getState().setRoomState(state);
      useRoomStore.getState().setIsHost(state.hostId === myId || state.hostId === `socket:${this.socket?.id}`);
    });

    // 监听聊天消息
    this.socket.on(ROOM_EVENTS.ChatMessage, (message) => {
      useRoomStore.getState().addChatMessage(message);
    });

    // 监听播放器事件同步
    this.socket.on(ROOM_EVENTS.PlayerEvent, (payload: PlayerEventPayload) => {
      useRoomStore.getState().handleRemotePlayerEvent(payload);
    });

    // 监听同步请求（房主响应跟播请求）
    this.socket.on(ROOM_EVENTS.PlaybackSyncRequest, (payload) => {
      const state = useRoomStore.getState();
      if (state.isHost && state.roomState) {
        const pb = this.currentVideoPlaybackGetter
          ? this.currentVideoPlaybackGetter()
          : (state.roomState.playback || { currentTime: 0, playbackRate: 1, paused: true, duration: null });
        const response: PlaybackSyncResponsePayload = {
          roomId: state.roomState.id,
          requesterId: payload.requesterId,
          currentTime: pb.currentTime ?? 0,
          playbackRate: pb.playbackRate || 1,
          paused: pb.paused ?? true,
          duration: pb.duration || null,
          syncId: Date.now(),
          localTimestamp: Date.now(),
          allowResume: true,
        };
        this.socket?.emit(ROOM_EVENTS.PlaybackSyncResponse, response);
      }
    });

    // 监听同步响应（成员收到房主回传的播放状态）
    this.socket.on(ROOM_EVENTS.PlaybackSyncResponse, (payload: PlaybackSyncResponsePayload) => {
      const state = useRoomStore.getState();
      if (!state.isHost && state.roomState && state.roomState.id === payload.roomId) {
        useRoomStore.getState().handleRemotePlayerEvent({
          roomId: payload.roomId,
          actorId: state.roomState.hostId || '',
          action: 'video_sync',
          currentTime: payload.currentTime,
          playbackRate: payload.playbackRate,
          paused: payload.paused,
          duration: payload.duration ?? undefined,
          syncId: payload.syncId,
        });
      }
    });

    // 监听房间关闭或被移出房间
    this.socket.on(ROOM_EVENTS.CloseRoom, (payload?: CloseRoomPayload) => {
      this.lastRoomContext = null;
      useRoomStore.getState().reset();
      if (payload?.reason === 'moderation') {
        useRoomStore.getState().setError('服务访问暂受限制，请通过帮助与反馈联系开发者', 'CONTENT_RESTRICTED');
        useRoomStore.getState().showToast('服务访问暂受限制，请通过帮助与反馈联系开发者');
      } else useRoomStore.getState().showToast('房主已解散房间');
    });

    this.socket.on(ROOM_EVENTS.Error, (error) => {
      if (error.code === 'HOST_ONLY') {
        console.log('[Socket] Ignore HOST_ONLY error:', error.message);
        return;
      }
      if (error.code === 'ROOM_NOT_FOUND' || error.code === 'KICKED' || error.code === 'MEMBER_BLOCKED') {
        this.lastRoomContext = null;
        useRoomStore.getState().reset();
      } else if (error.code === 'INVALID_PASSWORD') {
        this.lastRoomContext = null;
      }
      useRoomStore.getState().setError(error.message, error.code);
    });
  }

  private async safetyRequest<T>(event: string, payload: unknown): Promise<T> {
    if (!this.socket?.connected) throw new Error('连接已断开，请重连后重试');
    try {
      const result = await this.socket.timeout(10000).emitWithAck(event, payload) as SafetyResult<T>;
      if (!result.ok) throw new Error(result.error);
      return result.data;
    } catch (error) {
      if ((error as Error).message === 'operation has timed out') throw new Error('未收到服务器确认，请稍后重试');
      throw error;
    }
  }

  report(input: SafetyReportInput) { return this.safetyRequest<{ id: string }>(ROOM_EVENTS.SafetyReport, input); }
  listBlocks() { return this.safetyRequest<SafetyBlock[]>(ROOM_EVENTS.SafetyBlocks, {}); }
  unblock(targetId: string) { return this.safetyRequest(ROOM_EVENTS.SafetyUnblock, { targetId }); }
  listReports() { return this.safetyRequest<{ id: string; createdAt: number; status: 'pending' | 'reviewing' | 'resolved'; result: string | null }[]>(ROOM_EVENTS.SafetyReports, {}); }
  async blockAndLeave(roomId: string, targetId: string) {
    await this.safetyRequest(ROOM_EVENTS.SafetyBlock, { roomId, targetId });
    this.lastRoomContext = null;
    useRoomStore.getState().reset();
  }

  getUserId() {
    return this.sessionId || (this.socket?.id ? `socket:${this.socket.id}` : '');
  }

  // 发送指令
  createRoom(userName: string, roomId?: string, password?: string) {
    useRoomStore.getState().setError(null);
    if (!this.socket?.connected) {
      this.connect();
    }
    this.lastRoomContext = {
      roomId: roomId?.trim() || '',
      userName,
      password: password?.trim() || undefined,
      isHost: true,
    };
    const payload: CreateRoomPayload = {
      userName,
      roomId: roomId?.trim() || undefined,
      password: password?.trim() || undefined,
    };
    this.socket?.emit(ROOM_EVENTS.CreateRoom, payload);
  }

  joinRoom(userName: string, roomId: string, password?: string) {
    useRoomStore.getState().setError(null);
    if (!this.socket?.connected) {
      this.connect();
    }
    this.lastRoomContext = {
      roomId: roomId.trim(),
      userName,
      password: password?.trim() || undefined,
      isHost: false,
    };
    const payload: JoinRoomPayload = {
      userName,
      roomId: roomId.trim(),
      password: password?.trim() || undefined,
    };
    this.socket?.emit(ROOM_EVENTS.JoinRoom, payload);
  }

  updateRoomPassword(roomId: string, password?: string) {
    const payload: UpdateRoomPasswordPayload = {
      roomId,
      password: password !== undefined ? password : '',
    };
    this.socket?.emit(ROOM_EVENTS.UpdateRoomPassword, payload);
  }

  updateMemberName(roomId: string, userName: string) {
    const payload: UpdateMemberNamePayload = {
      roomId,
      userName: userName.trim(),
    };
    this.socket?.emit(ROOM_EVENTS.UpdateMemberName, payload);
  }

  leaveRoom(roomId: string) {
    this.lastRoomContext = null;
    const isHost = useRoomStore.getState().isHost;
    if (isHost) {
      this.socket?.emit(ROOM_EVENTS.CloseRoom, { roomId });
    } else {
      this.socket?.emit(ROOM_EVENTS.LeaveRoom, { roomId });
    }
    useRoomStore.getState().reset();
  }

  async sendChatMessage(roomId: string, message: string) {
    if (!this.socket?.connected) throw new Error('连接已断开，消息未发送，请重连后重试');
    const payload: ChatMessagePayload = { roomId, message, kind: 'text' };
    let result: ChatMessageResult;
    try {
      result = await this.socket.timeout(10000).emitWithAck(ROOM_EVENTS.ChatMessage, payload);
    } catch {
      throw new Error('未收到发送确认，请检查聊天记录后再重试');
    }
    if (!result.ok) throw new Error(result.error.message);
  }

  sendPlayerEvent(payload: PlayerEventPayload) {
    const actorId = payload.actorId || useRoomStore.getState().roomState?.hostId || this.getUserId();
    this.socket?.emit(ROOM_EVENTS.PlayerEvent, { ...payload, actorId });
  }

  requestPlaybackSync(roomId: string) {
    this.socket?.emit(ROOM_EVENTS.PlaybackSyncRequest, {
      roomId,
      requesterId: this.getUserId(),
    });
  }

  transferHost(roomId: string, targetId: string) {
    this.socket?.emit(ROOM_EVENTS.TransferHost, { roomId, targetId });
  }

  kickMember(roomId: string, targetId: string) {
    this.socket?.emit(ROOM_EVENTS.KickMember, { roomId, targetId });
  }
}

export const socketService = new SocketService();
