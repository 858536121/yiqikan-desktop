// Shared limits keep mobile statistics small and prevent free-form data collection.
export const TELEMETRY_BATCH_SIZE = 20;
export const TELEMETRY_BODY_BYTES = 64 * 1024;
export const MOBILE_TELEMETRY_EVENTS = [
  'app:launch', 'app:entry', 'room:create_request', 'room:create_result',
  'room:join_request', 'room:join_result', 'room:peer_arrived',
  'invite:action', 'playback:result', 'session:summary', 'voice:result',
] as const;
export type MobileTelemetryEvent = typeof MOBILE_TELEMETRY_EVENTS[number];
export type TelemetryEntrySource = 'manual' | 'search' | 'recommendation' | 'history' | 'clipboard' | 'deep_link' | 'reconnect';
export interface RoomEntryObservation {
  action: 'create' | 'join';
  outcome: 'request' | 'success' | 'failure' | 'cancelled' | 'unconfirmed';
  source: TelemetryEntrySource;
  flowId: string;
  elapsedMs: number;
  errorCode?: string;
  members?: number;
}

const enums: Record<string, readonly string[]> = {
  source: ['manual', 'search', 'recommendation', 'history', 'clipboard', 'deep_link', 'reconnect', 'address', 'home', 'room', 'profile', 'navigation'],
  action: ['create', 'join', 'copy', 'copy_code', 'open', 'accept', 'dismiss', 'watch', 'room', 'profile'],
  outcome: ['success', 'failure', 'cancelled', 'unconfirmed', 'ready', 'playing', 'request', 'timeout', 'ended'],
  reason: ['leave', 'background', 'interval', 'room_change', 'disable', 'close', 'navigation', 'unmount'],
  errorCode: ['ROOM_NOT_FOUND', 'ROOM_EXISTS', 'INVALID_PASSWORD', 'ALREADY_IN_ROOM', 'ROOM_FULL', 'CONTENT_RESTRICTED',
    'MEMBER_BLOCKED', 'KICKED', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'UPDATE_REQUIRED', 'AUTH_UNAVAILABLE',
    'CONNECT_ERROR', 'TIMEOUT', 'VERIFICATION_CANCELLED', 'ROOM_CREATION_PAUSED', 'RATE_LIMITED', 'CONTENT_REJECTED',
    'INVALID_NAME', 'INVALID_ROOM_ID', 'CREATE_FAILED', 'JOIN_FAILED', 'NETWORK', 'HTTP', 'RENDER_PROCESS', 'MEDIA', 'UNKNOWN'],
  environment: ['production', 'development'],
};
const numericLimits: Record<string, number> = {
  duration: 86400, elapsedMs: 600000, foregroundSeconds: 600, playingSeconds: 600,
  pauseCount: 1000, failureCount: 1000, reconnectCount: 1000, memberCount: 10,
};

export function readTelemetryRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^mt_[a-z0-9_]{8,70}$/.test(value) ? value : undefined;
}

export function sanitizeMobileTelemetryProperties(input: unknown): Record<string, string | number | boolean> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Object.hasOwn(enums, key) && enums[key].includes(value as string)) result[key] = value as string;
    else if (key === 'schemaVersion' && value === 1) result[key] = 1;
    else if (key === 'errorCode' && typeof value === 'string') result[key] = 'UNKNOWN';
    else if (Object.hasOwn(numericLimits, key) && typeof value === 'number' && Number.isFinite(value)) {
      result[key] = Math.max(0, Math.min(numericLimits[key], Math.floor(value)));
    } else if (['inRoom', 'isHost'].includes(key) && typeof value === 'boolean') result[key] = value;
    else if (['flowId', 'sceneId'].includes(key) && typeof value === 'string' && /^mt_[a-z0-9_]{8,70}$/.test(value)) result[key] = value;
    else if (['platform', 'osVersion', 'appVersion', 'bundleVersion'].includes(key) && typeof value === 'string' && /^[a-zA-Z0-9._-]{1,50}$/.test(value)) result[key] = value;
  }
  return result;
}
