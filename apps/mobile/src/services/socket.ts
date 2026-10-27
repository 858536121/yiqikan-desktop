import { io, Socket } from 'socket.io-client';
import { Platform } from 'react-native';
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
import { hasDeviceAuthentication, prepareAccountSession, createAccountProof, expireAccountSession } from './account-auth';
import { resolveServerUrl } from './environment';
import { MobileSyncReceiver, type RealtimePlayback } from '../utils/playback-sync';

const SERVER_URL = resolveServerUrl();
const SESSION_KEY = '@yiqikan_session_id';
const SAFETY_TOKEN_KEY = '@yiqikan_safety_token';
import type { SafetyReportInput, SafetyBlock, SafetyResult, ChatMessageResult, CloseRoomPayload } from '@yiqikan/shared';

class SocketService {
  private socket: Socket | null = null;
  private safetyToken: string | null = null;
  private sessionId: string | null = null;
  private renewalTimer: ReturnType<typeof setTimeout> | null = null;
  private authAttempt = 0;
  private currentVideoPlaybackGetter: (() => Promise<RealtimePlayback | null>) | null = null;
  private syncReceiver = new MobileSyncReceiver();
  private lastSentSyncId = 0;
  private syncRequestedAt = 0;
  private forceRequestedUntil = 0;
  private localControlRevision = 0;
  private hostMedia: PlayerEventPayload['media'];
  private hostMediaRoom = '';

  registerPlaybackGetter(getter: () => Promise<RealtimePlayback | null>) {
    this.currentVideoPlaybackGetter = getter;
  }

  unregisterPlaybackGetter() {
    this.currentVideoPlaybackGetter = null;
  }

  private async sampleCurrentPlayback(): Promise<RealtimePlayback | null> {
    try {
      const sample = await this.currentVideoPlaybackGetter?.();
      if (!sample || !Number.isFinite(sample.currentTime) || sample.currentTime < 0
        || !Number.isFinite(sample.playbackRate) || sample.playbackRate <= 0) return null;
      return sample;
    } catch {
      return null;
    }
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

  reportConnectionError(error: unknown) {
    const failure = error as { message?: string; code?: string } | null;
    useRoomStore.getState().setError(failure?.message || '连接失败，请稍后重试', failure?.code || 'AUTH_UNAVAILABLE');
  }

  async connect(serverUrl: string = SERVER_URL) {
    if (this.socket?.connected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      const generation = this.authAttempt;
      if (!this.sessionId) {
        await this.initSession();
      }

      if (this.socket) {
        if (!this.socket.connected) {
          this.socket.connect();
        }
        return;
      }

      // Finish any human verification before opening a transport with a server
      // handshake timeout. Existing device sessions complete without a prompt.
      if (hasDeviceAuthentication()) await prepareAccountSession(this.safetyToken);
      if (generation !== this.authAttempt) return;
      this.socket = io(serverUrl, {
        transports: ['websocket'],
        autoConnect: true,
        auth: hasDeviceAuthentication() ? (callback) => {
          const attempt = ++this.authAttempt;
          void createAccountProof(this.safetyToken).then(({ proof, userId, expiresAt }) => {
            if (attempt !== this.authAttempt || !this.socket?.active) return;
            this.sessionId = userId;
            if (this.renewalTimer) clearTimeout(this.renewalTimer);
            this.renewalTimer = setTimeout(() => {
              if (!this.socket?.connected) return;
              expireAccountSession(); this.socket.disconnect(); this.socket.connect();
            }, Math.max(1000, expiresAt - Date.now() - 30000));
            callback({ accountProof: proof, client: { appName: '异起看', appVersion: '1.20.6', hotVersion: null, protocolVersion: YIQIKAN_PROTOCOL_VERSION, platform: 'mobile', os: Platform.OS, releaseChannel: 'stable' } });
          }).catch(error => {
            if (attempt !== this.authAttempt || !this.socket?.active) return;
            useRoomStore.getState().setError(error.message || '设备验证失败，请稍后重试', error.code || 'AUTH_UNAVAILABLE');
            // Stop before sending a handshake, including against older servers
            // which do not understand V2 fields and would accept an empty guest.
            this.socket?.disconnect();
          });
        } : {
          sessionId: this.sessionId,
          supportsSafety: true,
          ...(this.safetyToken ? { safetyToken: this.safetyToken } : {}),
          client: {
            appName: '异起看',
            appVersion: '1.0.0',
            hotVersion: null,
            protocolVersion: YIQIKAN_PROTOCOL_VERSION,
            platform: 'mobile',
            ...(Platform.OS === 'ios' || Platform.OS === 'android' ? { os: Platform.OS } : {}),
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
    this.authAttempt++;
    if (this.renewalTimer) { clearTimeout(this.renewalTimer); this.renewalTimer = null; }
    this.localControlRevision++;
    this.syncReceiver.reset();
    this.syncRequestedAt = 0;
    this.forceRequestedUntil = 0;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private lastRoomContext: { roomId: string; userName: string; password?: string; isHost?: boolean } | null = null;
  private hasReceivedSnapshotAfterConnect = false;

  private receivePlayback(payload: PlayerEventPayload, source: 'event' | 'response') {
    const state = useRoomStore.getState();
    const room = state.roomState;
    if (!room || state.isHost || payload.roomId !== room.id || payload.actorId !== room.hostId) return;
    const navigation = payload.action === 'load_url' || payload.action === 'navigate';
    const replacement = payload.action === 'media_change';
    if (!navigation && !replacement && payload.media?.id && room.playback.media?.id && payload.media.id !== room.playback.media.id) return;
    const event = this.syncReceiver.accept(payload, source);
    if (!event) return;
    const requested = this.syncRequestedAt > 0 && Date.now() - this.syncRequestedAt < 4000;
    if (requested && typeof event.currentTime === 'number') {
      event.forceSync = Date.now() < this.forceRequestedUntil;
      this.syncRequestedAt = 0;
      this.forceRequestedUntil = 0;
    }
    state.setRoomState({ ...room, playback: {
        ...room.playback,
        ...(navigation ? { url: event.url || '', media: event.media?.pageUrl === event.url ? event.media : null } : {}),
        ...(event.media !== undefined && !navigation ? { media: event.media } : {}),
        currentTime: navigation || replacement ? 0 : event.currentTime ?? room.playback.currentTime,
        paused: navigation || replacement ? true : event.action === 'play' ? false : event.action === 'pause' ? true : event.paused ?? room.playback.paused,
        playbackRate: event.playbackRate ?? room.playback.playbackRate,
        duration: navigation || replacement ? null : event.duration ?? room.playback.duration,
        syncId: event.syncId ?? room.playback.syncId,
        updatedAt: event.sampledAt ?? Date.now(),
      } });
    state.handleRemotePlayerEvent(event);
  }

  private setupListeners() {
    if (!this.socket) return;

    this.socket.on(ROOM_EVENTS.AccountIdentity, ({ userId }: { userId: string }) => { this.sessionId = userId; });

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
      this.localControlRevision++;
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
      useRoomStore.getState().setError(restricted ? '服务访问暂受限制，请通过帮助与反馈联系开发者' : error.data?.code ? error.message : '无法连接到服务器', restricted ? 'CONTENT_RESTRICTED' : error.data?.code || 'CONNECT_ERROR');
      useRoomStore.getState().setConnected(false);
      this.hasReceivedSnapshotAfterConnect = false;
    });

    // 监听房间状态快照（加入/创建房间成功或断线重连恢复时下发）
    const handleStateSnapshot = (state: RoomState) => {
      const reconnecting = !this.hasReceivedSnapshotAfterConnect;
      const previous = useRoomStore.getState();
      const context = `${state.id}|${state.hostId}|${state.playback.url || ''}|${state.playback.media?.id || ''}`;
      const changed = this.syncReceiver.setContext(context);
      // Legacy hosts may restart their counters while disconnected.
      if (reconnecting) this.syncReceiver.reset(context);
      this.hasReceivedSnapshotAfterConnect = true;
      const myId = this.getUserId();
      const isHost = state.hostId === myId || state.hostId === `socket:${this.socket?.id}`;
      if (isHost && this.hostMediaRoom !== state.id) { this.hostMediaRoom = state.id; this.hostMedia = state.playback.media; }
      // A membership snapshot must not replace a fresher locally received heartbeat.
      const nextState = !isHost && !changed && !reconnecting && previous.roomState && previous.lastRemotePlayerEvent
        ? { ...state, playback: previous.roomState.playback } : state;
      useRoomStore.getState().setRoomState(nextState);
      useRoomStore.getState().setIsHost(isHost);
      useRoomStore.getState().setConnected(true);
      useRoomStore.getState().setError(null);
      if (this.lastRoomContext) {
        this.lastRoomContext.roomId = state.id;
        this.lastRoomContext.isHost = isHost;
      }

      if (changed || reconnecting) {
        this.syncRequestedAt = 0;
        this.forceRequestedUntil = 0;
        useRoomStore.setState({ lastRemotePlayerEvent: null });
      }
      // A paused snapshot has a fixed position. A playing snapshot can be old:
      // request a live sample and also accept the next heartbeat from legacy Web hosts.
      if (!isHost && state.playback?.url && (changed || reconnecting)) {
        if (state.playback.paused) {
          useRoomStore.getState().handleRemotePlayerEvent({
            roomId: state.id,
            actorId: state.hostId || '',
            action: 'video_sync',
            currentTime: state.playback.currentTime || 0,
            playbackRate: state.playback.playbackRate || 1,
            paused: state.playback.paused ?? true,
            duration: state.playback.duration ?? undefined,
            syncId: state.playback.syncId,
            media: state.playback.media,
            receivedAt: Date.now(),
            sampledAt: Date.now(),
            forceSync: true,
          });
        }
        this.requestPlaybackSync(state.id);
      }
    };
    this.socket.on(ROOM_EVENTS.StateSnapshot, handleStateSnapshot);
    this.socket.on(ROOM_EVENTS.StateUpdate, handleStateSnapshot);

    // 监听聊天消息
    this.socket.on(ROOM_EVENTS.ChatMessage, (message) => {
      useRoomStore.getState().addChatMessage(message);
    });

    // 监听播放器事件同步
    this.socket.on(ROOM_EVENTS.PlayerEvent, (payload: PlayerEventPayload) => {
      this.receivePlayback(payload, 'event');
    });

    // 监听同步请求（房主响应跟播请求）
    this.socket.on(ROOM_EVENTS.PlaybackSyncRequest, async (payload) => {
      const state = useRoomStore.getState();
      if (state.isHost && state.roomState) {
        const roomId = state.roomState.id;
        const playbackUrl = state.roomState.playback.url;
        const controlRevision = this.localControlRevision;
        const pb = await this.sampleCurrentPlayback();
        const current = useRoomStore.getState();
        if (!pb || controlRevision !== this.localControlRevision || !current.isHost
          || current.roomState?.id !== roomId || current.roomState.playback.url !== playbackUrl || !this.socket?.connected) return;
        const response: PlaybackSyncResponsePayload = {
          roomId: state.roomState.id,
          requesterId: payload.requesterId,
          currentTime: pb.currentTime ?? 0,
          playbackRate: pb.playbackRate || 1,
          paused: pb.paused ?? true,
          duration: pb.duration || null,
          syncId: this.nextSyncId(),
          localTimestamp: (pb.sampledAt ?? Date.now()) / 1000,
          allowResume: true,
          media: this.hostMedia,
        };
        this.socket?.emit(ROOM_EVENTS.PlaybackSyncResponse, response);
      }
    });

    // 监听同步响应（成员收到房主回传的播放状态）
    this.socket.on(ROOM_EVENTS.PlaybackSyncResponse, (payload: PlaybackSyncResponsePayload) => {
      const state = useRoomStore.getState();
      if (!state.isHost && state.roomState && state.roomState.id === payload.roomId) {
        this.receivePlayback({
          roomId: payload.roomId,
          actorId: state.roomState.hostId || '',
          action: 'video_sync',
          currentTime: payload.currentTime,
          playbackRate: payload.playbackRate,
          paused: payload.paused,
          duration: payload.duration ?? undefined,
          syncId: payload.syncId,
          localTimestamp: payload.localTimestamp,
          media: payload.media,
        }, 'response');
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
      if (error.code === 'SESSION_EXPIRED') {
        expireAccountSession();
        setTimeout(() => { if (this.socket && !this.socket.connected) this.socket.connect(); }, 100);
      }
      if (error.code === 'HOST_ONLY') {
        console.log('[Socket] Ignore HOST_ONLY error:', error.message);
        return;
      }
      if (['ROOM_NOT_FOUND', 'KICKED', 'MEMBER_BLOCKED', 'CONTENT_RESTRICTED', 'SESSION_REVOKED', 'UPDATE_REQUIRED'].includes(error.code)) {
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
  private nextSyncId() {
    this.lastSentSyncId = Math.max(this.lastSentSyncId + 1, Date.now());
    return this.lastSentSyncId;
  }

  createRoom(userName: string, roomId?: string, password?: string) {
    useRoomStore.getState().setError(null);
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
    this.sendRoomEntry(ROOM_EVENTS.CreateRoom, payload);
  }

  joinRoom(userName: string, roomId: string, password?: string) {
    useRoomStore.getState().setError(null);
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
    this.sendRoomEntry(ROOM_EVENTS.JoinRoom, payload);
  }

  private sendRoomEntry(event: string, payload: CreateRoomPayload | JoinRoomPayload) {
    const context = this.lastRoomContext;
    // Registration can pause here for human verification. A cancelled or
    // superseded request must never be replayed by a later connection.
    void this.connect().then(() => {
      if (this.lastRoomContext === context) this.socket?.emit(event, payload);
    }).catch(error => {
      if (this.lastRoomContext !== context) return;
      this.lastRoomContext = null;
      this.reportConnectionError(error);
    });
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
    this.localControlRevision++;
    const navigation = payload.action === 'load_url' || payload.action === 'navigate' || payload.action === 'reload';
    if (navigation && this.hostMedia?.pageUrl !== payload.url) this.hostMedia = null;
    else if (payload.action === 'media_change') this.hostMedia = payload.media;
    const contextChange = navigation || payload.action === 'media_change';
    if (!this.socket || (!this.socket.connected && !contextChange)) return;
    // Socket.IO preserves context changes in order across reconnects. Clock
    // commands are discarded offline and sampled anew when connected again.
    const actorId = payload.actorId || useRoomStore.getState().roomState?.hostId || this.getUserId();
    this.socket.emit(ROOM_EVENTS.PlayerEvent, {
      ...payload, actorId, syncId: payload.syncId ?? this.nextSyncId(),
      media: payload.media ?? this.hostMedia,
      localTimestamp: payload.localTimestamp ?? Date.now() / 1000,
    });
  }

  async publishCurrentPlayback(action: 'play' | 'pause') {
    const initial = useRoomStore.getState();
    if (!initial.isHost || !initial.roomState) return;
    const revision = ++this.localControlRevision;
    const { id, hostId } = initial.roomState;
    const url = initial.roomState.playback.url;
    const sample = await this.sampleCurrentPlayback();
    const current = useRoomStore.getState();
    if (!sample || revision !== this.localControlRevision || !current.isHost || current.roomState?.id !== id || current.roomState.hostId !== hostId
      || current.roomState.playback.url !== url || (action === 'pause' && !sample.paused)) return;
    this.sendPlayerEvent({
      roomId: id, actorId: hostId, action: action === 'play' && sample.paused ? 'video_sync' : action,
      currentTime: sample.currentTime, paused: sample.paused, playbackRate: sample.playbackRate,
      duration: sample.duration, localTimestamp: (sample.sampledAt ?? Date.now()) / 1000,
    });
  }

  requestPlaybackSync(roomId: string, force = true) {
    if (!this.socket?.connected) return;
    const state = useRoomStore.getState();
    if (state.isHost || state.roomState?.id !== roomId || state.memberLocalPause || state.memberMediaPending) return;
    const now = Date.now();
    if (force) this.forceRequestedUntil = now + 4000;
    if (this.syncRequestedAt > 0 && now - this.syncRequestedAt < 800) {
      return;
    }
    this.syncRequestedAt = now;
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
