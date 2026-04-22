export const ROOM_EVENTS = {
  CreateRoom: "room:create",
  JoinRoom: "room:join",
  LeaveRoom: "room:leave",
  CloseRoom: "room:close",
  UpdateRoomPassword: "room:update_password",
  StateSnapshot: "room:state_snapshot",
  StateUpdate: "room:state:update",
  PlayerEvent: "player:event",
  PlaybackSyncRequest: "player:sync_request",
  PlaybackSyncResponse: "player:sync_response",
  ChatMessage: "chat:message",
  RuntimeNotice: "runtime:notice",
  Error: "room:error",
} as const;

export type RoomEventName = (typeof ROOM_EVENTS)[keyof typeof ROOM_EVENTS];
export const YIQIKAN_PROTOCOL_VERSION = 1;
export const ROOM_ID_MAX_LENGTH = 12;
export type ReleaseChannel = "stable" | "beta" | "alpha";

export interface ClientRuntimeInfo {
  appName: string;
  appVersion: string;
  protocolVersion: number;
  platform: "desktop" | "web";
  releaseChannel: ReleaseChannel;
}

export interface ClientSessionAuth {
  client?: ClientRuntimeInfo;
  sessionId?: string;
}

export interface UpdateReservationConfig {
  enabled: boolean;
  checkOnLaunch: boolean;
  allowPrerelease: boolean;
  feedUrl: string | null;
}

export interface RemoteConfigReservationConfig {
  enabled: boolean;
  url: string | null;
  refreshIntervalMs: number;
}

export interface DesktopRuntimeContext {
  client: ClientRuntimeInfo;
  updates: UpdateReservationConfig;
  remoteConfig: RemoteConfigReservationConfig;
}

export interface ServerCompatibilityConfig {
  minimumDesktopVersion: string | null;
  suggestedDesktopVersion: string | null;
  enforceMinimumDesktopVersion: boolean;
  minimumProtocolVersion: number;
}

export interface ServerRuntimeInfo {
  serverName: string;
  serverVersion: string;
  protocolVersion: number;
  compatibility: ServerCompatibilityConfig;
  updates: Omit<UpdateReservationConfig, "checkOnLaunch">;
  remoteConfig: RemoteConfigReservationConfig;
}

export interface RuntimeNoticePayload {
  code: "UPDATE_RECOMMENDED" | "UPDATE_REQUIRED" | "PROTOCOL_MISMATCH";
  severity: "info" | "warning" | "error";
  message: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  actorId: string;
  actorName: string;
  kind: "text" | "system";
  message: string;
  createdAt: number;
}

export interface MemberPresence {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface PlaybackState {
  url: string | null;
  pageTitle: string | null;
  paused: boolean;
  currentTime: number;
  playbackRate: number;
  duration: number | null;
  syncId: number;
  updatedAt: number;
}

export interface RoomState {
  id: string;
  hostId: string;
  hostName: string;
  hasPassword: boolean;
  members: MemberPresence[];
  chatMessages: ChatMessage[];
  playback: PlaybackState;
}

export interface CreateRoomPayload {
  roomId?: string;
  userName: string;
  password?: string;
  initialPlayback?: Partial<PlaybackState>;
}

export interface JoinRoomPayload {
  roomId: string;
  userName: string;
  password?: string;
}

export interface LeaveRoomPayload {
  roomId: string;
}

export interface CloseRoomPayload {
  roomId: string;
}

export interface UpdateRoomPasswordPayload {
  roomId: string;
  password?: string;
}

export interface ChatMessagePayload {
  roomId: string;
  message: string;
  kind?: "text" | "system";
}

export type PlayerAction = "load_url" | "navigate" | "reload" | "play" | "pause" | "seek" | "rate_change" | "video_sync";

export interface PlayerEventPayload {
  roomId: string;
  actorId: string;
  action: PlayerAction;
  url?: string | null;
  pageTitle?: string | null;
  currentTime?: number;
  playbackRate?: number;
  paused?: boolean;
  duration?: number | null;
  syncId?: number;
  localTimestamp?: number;
  allowResume?: boolean;
}

export interface PlaybackSyncRequestPayload {
  roomId: string;
  requesterId: string;
}

export interface PlaybackSyncResponsePayload {
  roomId: string;
  requesterId: string;
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  duration?: number | null;
  syncId: number;
  localTimestamp: number;
  allowResume: boolean;
}

export interface ServerErrorPayload {
  code: string;
  message: string;
}

function parseVersionPart(value: string) {
  const normalized = value.trim().split("-")[0] ?? "";
  return normalized
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

export function compareVersions(left: string, right: string) {
  const leftParts = parseVersionPart(left);
  const rightParts = parseVersionPart(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

export function isVersionAtLeast(version: string, minimumVersion: string) {
  return compareVersions(version, minimumVersion) >= 0;
}

export function normalizeRoomIdInput(value: string) {
  return value.trim().toLowerCase().slice(0, ROOM_ID_MAX_LENGTH);
}

export function createInitialPlaybackState(): PlaybackState {
  return {
    url: null,
    pageTitle: null,
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    duration: null,
    syncId: 0,
    updatedAt: Date.now(),
  };
}
