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
import Constants from 'expo-constants';

function resolveDefaultServerUrl(): string {
  if (process.env.EXPO_PUBLIC_SERVER_URL) {
    return process.env.EXPO_PUBLIC_SERVER_URL;
  }
  const debuggerHost = Constants.expoConfig?.hostUri;
  if (debuggerHost) {
    const ip = debuggerHost.split(':')[0];
    if (ip) {
      return `http://${ip}:8787`;
    }
  }
  return 'http://localhost:8787';
}

const SERVER_URL = resolveDefaultServerUrl();
const SESSION_KEY = '@yiqikan_session_id';

class SocketService {
  private socket: Socket | null = null;
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
    } catch (e) {
      console.error('Failed to init session', e);
      this.sessionId = 'temp_' + Date.now();
    }
  }

  async connect(serverUrl: string = SERVER_URL) {
    if (this.socket?.connected) return;

    if (!this.sessionId) {
      await this.initSession();
    }

    this.socket = io(serverUrl, {
      transports: ['websocket'],
      autoConnect: true,
      auth: {
        sessionId: this.sessionId,
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
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private setupListeners() {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket?.id);
      useRoomStore.getState().setConnected(true);
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      useRoomStore.getState().setConnected(false);
    });

    this.socket.on('connect_error', (error) => {
      console.log('Socket connect error:', error.message);
      useRoomStore.getState().setError('无法连接到服务器');
      useRoomStore.getState().setConnected(false);
    });

    // 监听房间状态快照（加入/创建房间成功时下发）
    this.socket.on(ROOM_EVENTS.StateSnapshot, (state: RoomState) => {
      const myId = this.getUserId();
      useRoomStore.getState().setRoomState(state);
      useRoomStore.getState().setIsHost(state.hostId === myId || state.hostId === `socket:${this.socket?.id}`);
      useRoomStore.getState().setConnected(true);
      useRoomStore.getState().setError(null);
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
      if (state.isHost && this.currentVideoPlaybackGetter && state.roomState) {
        const pb = this.currentVideoPlaybackGetter();
        const response: PlaybackSyncResponsePayload = {
          roomId: state.roomState.id,
          requesterId: payload.requesterId,
          currentTime: pb.currentTime,
          playbackRate: pb.playbackRate || 1,
          paused: pb.paused,
          duration: pb.duration || null,
          syncId: Date.now(),
          localTimestamp: Date.now(),
          allowResume: true,
        };
        this.socket?.emit(ROOM_EVENTS.PlaybackSyncResponse, response);
      }
    });

    this.socket.on(ROOM_EVENTS.Error, (error) => {
      useRoomStore.getState().setError(error.message);
    });
  }

  getUserId() {
    return this.sessionId || (this.socket?.id ? `socket:${this.socket.id}` : '');
  }

  // 发送指令
  createRoom(userName: string, roomId?: string, password?: string) {
    useRoomStore.getState().setError(null);
    const payload: CreateRoomPayload = {
      userName,
      roomId: roomId?.trim() || undefined,
      password: password?.trim() || undefined,
    };
    this.socket?.emit(ROOM_EVENTS.CreateRoom, payload);
  }

  joinRoom(userName: string, roomId: string, password?: string) {
    useRoomStore.getState().setError(null);
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
    const isHost = useRoomStore.getState().isHost;
    if (isHost) {
      this.socket?.emit(ROOM_EVENTS.CloseRoom, { roomId });
    } else {
      this.socket?.emit(ROOM_EVENTS.LeaveRoom, { roomId });
    }
    useRoomStore.getState().reset();
  }

  sendChatMessage(roomId: string, message: string) {
    const payload: ChatMessagePayload = { roomId, message, kind: 'text' };
    this.socket?.emit(ROOM_EVENTS.ChatMessage, payload);
  }

  sendPlayerEvent(payload: PlayerEventPayload) {
    this.socket?.emit(ROOM_EVENTS.PlayerEvent, payload);
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
