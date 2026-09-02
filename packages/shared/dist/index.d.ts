export declare const ROOM_EVENTS: {
    readonly CreateRoom: "room:create";
    readonly JoinRoom: "room:join";
    readonly LeaveRoom: "room:leave";
    readonly CloseRoom: "room:close";
    readonly UpdateRoomPassword: "room:update_password";
    readonly UpdateMemberName: "room:update_member_name";
    readonly KickMember: "room:kick_member";
    readonly TransferHost: "room:transfer_host";
    readonly StateSnapshot: "room:state_snapshot";
    readonly StateUpdate: "room:state:update";
    readonly PlayerEvent: "player:event";
    readonly PlaybackSyncRequest: "player:sync_request";
    readonly PlaybackSyncResponse: "player:sync_response";
    readonly ChatMessage: "chat:message";
    readonly UpdatePublicRoom: "room:update_public";
    readonly RuntimeNotice: "runtime:notice";
    readonly Error: "room:error";
};
export type RoomEventName = (typeof ROOM_EVENTS)[keyof typeof ROOM_EVENTS];
export declare const YIQIKAN_PROTOCOL_VERSION = 1;
export declare const ROOM_ID_MAX_LENGTH = 12;
export type ReleaseChannel = "stable" | "beta" | "alpha";
export interface ClientRuntimeInfo {
    appName: string;
    appVersion: string;
    hotVersion: string | null;
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
export interface MobileReleaseConfig {
    appMinVersion: string | null;
    appDownloadUrl: string | null;
    forceAppUpdate: boolean;
    bundleVersion: string | null;
    bundleUrl: string | null;
    bundleHash?: string | null;
    releaseNotes?: string | null;
    updateMode?: "silent" | "prompt";
}
export interface AppReleaseConfig {
    shellMinVersion: string | null;
    forceShellUpdate: boolean;
    rendererVersion: string | null;
    rendererUrl: string | null;
    mobile?: MobileReleaseConfig | null;
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
export interface PublicRoomMeta {
    isPublic: boolean;
    title: string;
    hostUserId: string;
    hostNickname: string;
    publishedAt: number;
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
    publicMeta?: PublicRoomMeta | null;
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
export interface UpdateMemberNamePayload {
    roomId: string;
    userName: string;
}
export interface UpdatePublicRoomPayload {
    roomId: string;
    isPublic: boolean;
    title?: string;
    authToken?: string;
}
export interface PublicRoomSummary {
    roomId: string;
    title: string;
    hostNickname: string;
    memberCount: number;
    hasPassword: boolean;
    pageTitle: string | null;
    paused: boolean;
    updatedAt: number;
    publishedAt: number;
}
export interface KickMemberPayload {
    roomId: string;
    targetId: string;
}
export interface TransferHostPayload {
    roomId: string;
    targetId: string;
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
export declare function compareVersions(left: string, right: string): 1 | 0 | -1;
export declare function isVersionAtLeast(version: string, minimumVersion: string): boolean;
export declare function normalizeRoomIdInput(value: string): string;
export declare function createInitialPlaybackState(): PlaybackState;
export type TelemetryPlatform = "desktop_mac_arm64" | "desktop_mac_x64" | "desktop_windows" | "desktop_linux" | "mobile_android" | "mobile_ios" | "web_windows" | "web_mac" | "web_mobile" | "web_linux" | "web_other" | "web" | "web_chrome" | "web_safari" | "web_firefox" | "web_edge" | "unknown";
export declare const TELEMETRY_EVENTS: {
    readonly WebPageView: "web:page_view";
    readonly WebDownloadClick: "web:download_click";
    readonly WebFeatureClick: "web:feature_click";
    readonly WebExtensionDetected: "web:extension_detected";
    readonly WebExtensionMissing: "web:extension_missing";
    readonly AuthSendCode: "auth:send_code";
    readonly AuthLoginSuccess: "auth:login_success";
    readonly AuthRegisterSuccess: "auth:register_success";
    readonly AuthDesktopGrant: "auth:desktop_grant";
    readonly AppLaunch: "app:launch";
    readonly AppHeartbeat: "app:heartbeat";
    readonly AppExit: "app:exit";
    readonly RoomCreate: "room:create";
    readonly RoomJoin: "room:join";
    readonly RoomLeave: "room:leave";
    readonly BrowserNavigate: "browser:navigate";
    readonly VideoSniffResult: "video:sniff_result";
    readonly PlaybackSyncAction: "playback:sync_action";
    readonly VoiceJoin: "voice:join";
    readonly VoiceConnected: "voice:connected";
    readonly VoiceLeave: "voice:leave";
    readonly ChatSendMessage: "chat:send_message";
};
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS] | (string & {});
export interface TelemetryEventItem {
    eventName: TelemetryEventName;
    distinctId: string;
    userId?: string | null;
    sessionId: string;
    platform: TelemetryPlatform;
    appVersion: string;
    rendererVersion?: string | null;
    os?: string;
    osVersion?: string;
    deviceModel?: string;
    properties?: Record<string, any>;
    clientTime?: number;
}
export interface TelemetryReportPayload {
    events: TelemetryEventItem[];
}
export interface TelemetryHeartbeatPayload {
    sessionId: string;
    distinctId: string;
    userId?: string | null;
    platform: TelemetryPlatform;
    appVersion: string;
    inRoom?: boolean;
    roomId?: string | null;
    activeSeconds?: number;
}
