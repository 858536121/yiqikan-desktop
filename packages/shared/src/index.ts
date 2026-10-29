export const ROOM_EVENTS = {
  CreateRoom: "room:create",
  JoinRoom: "room:join",
  LeaveRoom: "room:leave",
  CloseRoom: "room:close",
  UpdateRoomPassword: "room:update_password",
  UpdateMemberName: "room:update_member_name",
  KickMember: "room:kick_member",
  TransferHost: "room:transfer_host",
  StateSnapshot: "room:state_snapshot",
  StateUpdate: "room:state:update",
  PlayerEvent: "player:event",
  PlaybackSyncRequest: "player:sync_request",
  PlaybackSyncResponse: "player:sync_response",
  ChatMessage: "chat:message",
  SafetyIdentity: "safety:identity",
  AccountIdentity: "account:identity",
  SafetyReport: "safety:report",
  SafetyBlock: "safety:block",
  SafetyBlocks: "safety:blocks",
  SafetyUnblock: "safety:unblock",
  SafetyReports: "safety:reports",
  UpdatePublicRoom: "room:update_public",
  RuntimeNotice: "runtime:notice",
  Error: "room:error",
} as const;

export type RoomEventName = (typeof ROOM_EVENTS)[keyof typeof ROOM_EVENTS];
export const YIQIKAN_PROTOCOL_VERSION = 1;
export const ROOM_ID_MAX_LENGTH = 12;
export type ReleaseChannel = "stable" | "beta" | "alpha";
export type RoomDeviceType = "ios" | "android" | "mobile" | "web" | "desktop" | "unknown";

export interface ClientRuntimeInfo {
  appName: string;
  appVersion: string;
  hotVersion: string | null;
  protocolVersion: number;
  platform: "desktop" | "web" | "mobile";
  /** Optional for older mobile clients; sent only with the connection handshake. */
  os?: "ios" | "android";
  releaseChannel: ReleaseChannel;
}

export interface ClientSessionAuth {
  client?: ClientRuntimeInfo;
  sessionId?: string;
  supportsSafety?: boolean;
  safetyToken?: string;
  /** V2 always requires a single-use device proof. Invalid V2 never falls back to V1. */
  accountProof?: AccountProof;
}

export interface AccountProof { accessToken: string; challengeId: string; signature: string }
export type SupportOperation = 'enable' | 'clearRestriction';
export const SUPPORT_OPERATION_LABELS: Record<SupportOperation, string> = {
  enable: '启用账号', clearRestriction: '解除禁言或封禁',
};
export function getSupportOperation(action: unknown, restriction?: unknown): SupportOperation | null {
  return action === 'enable' ? 'enable' : action === 'restriction' && restriction === 'clear' ? 'clearRestriction' : null;
}
export function normalizeSupportCode(value: string): string | null {
  const compact = value.normalize('NFKC').replace(/[\s-]/g, '').toUpperCase();
  return /^[A-HJ-NP-Z2-9]{8}$/.test(compact) ? compact : null;
}
export interface SupportCodeResult {
  userId: string;
  publicId: string;
  code: string;
  expiresAt: number;
  expiresInSeconds: number;
}
export interface SupportGrantResult {
  token: string;
  publicId: string;
  operation: SupportOperation;
  expiresAt: number;
  expiresInSeconds: number;
}
/** Public support information. This never grants account or room access. */
export interface ClientAccountSummary {
  userId: string;
  publicId: string;
  disabled: boolean;
  deviceRevoked: boolean;
  restriction: SafetyRestriction | null;
  nickname?: string;
  avatar?: ProfileAvatar;
  avatarId?: string | null;
  avatarPath?: string | null;
  profileUpdatedAt?: number | null;
}
export const PROFILE_AVATARS = ['yi', 'moon', 'mountain', 'sea'] as const;
export type ProfileAvatar = typeof PROFILE_AVATARS[number];
export const FEEDBACK_CATEGORIES = ['playback', 'room', 'account', 'suggestion'] as const;
export const FEEDBACK_CATEGORY_LABELS = { playback: '播放与同步', room: '房间与连麦', account: '账号与限制', suggestion: '建议与其他' } as const;
export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];
export const FEEDBACK_STATUS_LABELS = { pending: '待处理', processing: '处理中', replied: '已回复', closed: '已结束' } as const;
export type FeedbackStatus = keyof typeof FEEDBACK_STATUS_LABELS;
export interface FeedbackDiagnostics { platform: string; osVersion: string; model: string; appVersion: string; bundleVersion: string; errorCode: string }
export interface ClientFeedbackItem { id: string; reference: string; category: FeedbackCategory; description: string; status: FeedbackStatus; reply: string | null; createdAt: number; updatedAt: number }
export interface ClientFeedbackPage { items: ClientFeedbackItem[]; nextCursor: string | null }
export function normalizePublicUserId(value: string): string | null {
  const compact = value.normalize('NFKC').replace(/[\s-]/g, '').toUpperCase();
  const candidate = /^\d{10}$/.test(compact) ? `YQK${compact}` : compact;
  return /^YQK\d{10}$/.test(candidate) ? candidate : null;
}
export function formatPublicUserId(value: string): string {
  const id = normalizePublicUserId(value);
  return id ? `${id.slice(0, 3)} ${id.slice(3, 7)} ${id.slice(7, 11)} ${id.slice(11)}` : value;
}
export function isClientAccountSummary(value: unknown): value is ClientAccountSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as ClientAccountSummary;
  return typeof v.userId === 'string' && v.userId.length > 0 && v.userId.length <= 128 &&
    typeof v.publicId === 'string' && normalizePublicUserId(v.publicId) === v.publicId &&
    typeof v.disabled === 'boolean' && typeof v.deviceRevoked === 'boolean' &&
    (v.nickname === undefined || (typeof v.nickname === 'string' && v.nickname.length > 0 && v.nickname.length <= 30)) &&
    (v.avatar === undefined || PROFILE_AVATARS.includes(v.avatar)) &&
    (v.avatarId === undefined || v.avatarId === null || (typeof v.avatarId === 'string' && /^[a-f0-9-]{36}$/.test(v.avatarId))) &&
    (v.avatarPath === undefined || v.avatarPath === null || (typeof v.avatarPath === 'string' && /^\/api\/client-avatar\/image\/[a-f0-9-]{36}$/.test(v.avatarPath))) &&
    (v.profileUpdatedAt === undefined || v.profileUpdatedAt === null || (Number.isSafeInteger(v.profileUpdatedAt) && v.profileUpdatedAt > 0)) &&
    (v.restriction === null || Boolean(v.restriction && ['ban', 'mute'].includes(v.restriction.action) &&
      Number.isSafeInteger(v.restriction.until) && v.restriction.until > 0));
}
export type SecurityRule = 'connect' | 'register' | 'packet' | 'createRoom' | 'joinRoom' | 'chatMessage' | 'safety';
export interface SecurityPolicy {
  allowLegacy: boolean;
  registrationEnabled: boolean;
  roomCreationEnabled: boolean;
  limits: Record<SecurityRule, { limit: number; windowSeconds: number }>;
}
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  allowLegacy: true, registrationEnabled: true, roomCreationEnabled: true,
  limits: {
    connect: { limit: 60, windowSeconds: 60 }, register: { limit: 20, windowSeconds: 3600 },
    packet: { limit: 120, windowSeconds: 10 },
    createRoom: { limit: 4, windowSeconds: 60 }, joinRoom: { limit: 10, windowSeconds: 60 },
    chatMessage: { limit: 12, windowSeconds: 10 }, safety: { limit: 30, windowSeconds: 60 },
  },
};

export const SAFETY_REASONS = ['骚扰辱骂', '不当内容', '广告诈骗', '侵权内容', '其他'] as const;
export interface SafetyReportInput {
  requestId: string;
  roomId: string;
  targetId: string;
  messageId?: string;
  reason: (typeof SAFETY_REASONS)[number];
  details: string;
}
export interface SafetyReport extends SafetyReportInput {
  id: string;
  reporterId: string;
  targetName: string;
  evidence?: { message: string; createdAt: number };
  createdAt: number;
  status: 'pending' | 'reviewing' | 'resolved';
  result?: string;
  handledBy?: string;
  handledAt?: number;
  resolvedAt?: number;
  handledAction?: SafetyDecision['action'];
}
export interface SafetyRestriction { action: 'mute' | 'ban'; until: number }
export interface SafetyReviewReport extends SafetyReport { restriction: SafetyRestriction | null }
export interface SafetyBlock { targetId: string; targetName: string; createdAt: number }
export interface SafetyDecision {
  status: SafetyReport['status'];
  result: string;
  action: 'none' | 'mute' | 'ban';
}
export type SafetyResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

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
  /** Effective OTA switch for the requesting platform and native binary version. */
  otaEnabled?: boolean;
  appMinVersion: string | null;
  appDownloadUrl: string | null;
  forceAppUpdate: boolean;
  iosAppMinVersion?: string | null;
  iosAppStoreUrl?: string | null;
  iosForceAppUpdate?: boolean;
  bundleVersion: string | null;
  bundleUrl: string | null;
  bundleHash?: string | null;
  releaseNotes?: string | null;
  updateMode?: "silent" | "prompt";
}

/** Accept a specific App Store product page, never an APK or a third-party download page. */
export function normalizeAppStoreUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['apps.apple.com', 'itunes.apple.com'].includes(url.hostname) ||
        !/\/id\d+\/?$/.test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}

/** Stable iOS app versions use three numeric components, without a v prefix or prerelease suffix. */
export function normalizeIosAppVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version) ||
      !version.split('.').every(part => Number.isSafeInteger(Number(part)))) return null;
  return version;
}

export interface IosReviewConfig {
  reviewVersion: string;
  isReviewing: boolean;
  whitelistUrls: string[];
}

export type MobilePlatform = 'ios' | 'android';
export interface RecommendedSite {
  name: string;
  url: string;
  color: string;
  tag: string;
  desc?: string;
  platforms?: ('web' | MobilePlatform)[];
}
export interface MobileVersionSettings {
  /** null inherits the platform default, or the global setting for defaults. */
  searchEngine: { name: string; templateUrl: string } | null;
  /** null inherits; [] deliberately hides all homepage cards. */
  recommendSites: RecommendedSite[] | null;
  otaEnabled: boolean;
}
export interface MobileVersionRule extends MobileVersionSettings { version: string }
export type MobileVersionPolicies = Record<MobilePlatform, {
  defaults: MobileVersionSettings;
  versions: MobileVersionRule[];
}>;
export interface MobileVersionMutation {
  platform: MobilePlatform;
  /** null targets platform defaults. */
  version: string | null;
  /** null deletes an exact version rule. */
  settings: MobileVersionSettings | null;
}
export function normalizeMobileAppVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const version = value.trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  const parts = version.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts.join('.') : null;
}

export interface ExtensionReleaseConfig {
  version: string | null;
  downloadUrl: string | null;
  hash?: string | null;
  forceUpdate?: boolean;
  releaseNotes?: string | null;
  updateMode?: "silent" | "prompt";
}

export interface AppReleaseConfig {
  shellMinVersion: string | null;
  forceShellUpdate: boolean;
  rendererVersion: string | null;
  rendererUrl: string | null;
  mobile?: MobileReleaseConfig | null;
  extension?: ExtensionReleaseConfig | null;
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
  avatar?: string;
  avatarPath?: string | null;
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

// A host-generated playback generation, independent of CDN URLs and tokens.
export interface PlaybackMedia {
  id: string;
  pageUrl: string;
  contentId?: string;
  title?: string;
  episode?: { label: string; url?: string };
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
  media?: PlaybackMedia | null;
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
  reason?: 'moderation';
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

export type PlayerAction = "load_url" | "navigate" | "reload" | "media_change" | "play" | "pause" | "seek" | "rate_change" | "video_sync";

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
  media?: PlaybackMedia | null;
}

export interface PlaybackSyncRequestPayload {
  roomId: string;
  requesterId: string;
  /** Optional opaque request ID for direct member/host clock measurement. */
  clockProbeId?: string;
}

export interface PlaybackClockReply {
  id: string;
  /** Host wall-clock milliseconds, independent of localTimestamp's legacy units. */
  receivedAt: number;
  sentAt: number;
  /** Host processing duration measured with a monotonic clock. */
  elapsedMs: number;
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
  media?: PlaybackMedia | null;
  clockReply?: PlaybackClockReply;
}

export interface ServerErrorPayload {
  code: string;
  message: string;
}

export type ChatMessageResult = { ok: true } | { ok: false; error: ServerErrorPayload };

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

export function normalizeRoomIdInput(value: unknown) {
  if (typeof value !== "string") return "";
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

/* ------------------------------------------------------------------ */
/*  Telemetry & Analytics Types                                       */
/* ------------------------------------------------------------------ */

export type TelemetryPlatform =
  | "desktop_mac_arm64"
  | "desktop_mac_x64"
  | "desktop_windows"
  | "desktop_linux"
  | "mobile_android"
  | "mobile_ios"
  | "web_windows"
  | "web_mac"
  | "web_mobile"
  | "web_linux"
  | "web_other"
  | "web"
  | "web_chrome"
  | "web_safari"
  | "web_firefox"
  | "web_edge"
  | "unknown";

export const TELEMETRY_EVENTS = {
  // Web events
  WebPageView: "web:page_view",
  WebDownloadClick: "web:download_click",
  WebFeatureClick: "web:feature_click",
  WebExtensionDetected: "web:extension_detected",
  WebExtensionMissing: "web:extension_missing",

  // Auth events
  AuthSendCode: "auth:send_code",
  AuthLoginSuccess: "auth:login_success",
  AuthRegisterSuccess: "auth:register_success",
  AuthDesktopGrant: "auth:desktop_grant",

  // App & Session Lifecycle
  AppLaunch: "app:launch",
  AppHeartbeat: "app:heartbeat",
  AppExit: "app:exit",

  // Room lifecycle
  RoomCreate: "room:create",
  RoomJoin: "room:join",
  RoomLeave: "room:leave",

  // Playback & Video Sniffing
  BrowserNavigate: "browser:navigate",
  VideoSniffResult: "video:sniff_result",
  PlaybackSyncAction: "playback:sync_action",

  // Voice & Interaction
  VoiceJoin: "voice:join",
  VoiceConnected: "voice:connected",
  VoiceLeave: "voice:leave",
  ChatSendMessage: "chat:send_message",
} as const;

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

export { MEDIA_CONTEXT_SCRIPT } from "./media-context-script";
export * from './registration';
export * from './playback-clock';
