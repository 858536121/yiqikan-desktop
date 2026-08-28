import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type {
  TelemetryEventItem,
  TelemetryEventName,
  TelemetryHeartbeatPayload,
  TelemetryPlatform,
} from "@yiqikan/shared";

const STORAGE_KEY_DISTINCT_ID = "@yiqikan_telemetry_distinct_id";
const STORAGE_KEY_SESSION_ID = "@yiqikan_telemetry_session_id";
const DEFAULT_WEB_URL = "https://yiqikan.cpolar.cn";

let distinctIdCache: string | null = null;
let sessionIdCache: string | null = null;

async function getDistinctId(): Promise<string> {
  if (distinctIdCache) return distinctIdCache;
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_DISTINCT_ID);
    if (stored) {
      distinctIdCache = stored;
      return stored;
    }
    const newId = `mob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await AsyncStorage.setItem(STORAGE_KEY_DISTINCT_ID, newId);
    distinctIdCache = newId;
    return newId;
  } catch {
    return "anonymous_mobile";
  }
}

async function getSessionId(): Promise<string> {
  if (sessionIdCache) return sessionIdCache;
  const newId = `mob_sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  sessionIdCache = newId;
  return newId;
}

function getPlatformType(): TelemetryPlatform {
  return Platform.OS === "android" ? "mobile_android" : "mobile_ios";
}

class MobileTelemetryService {
  private webUrl: string = DEFAULT_WEB_URL;
  private appVersion: string = Constants.expoConfig?.version || "1.12.0";
  private bundleVersion: string | null = null;
  private queue: TelemetryEventItem[] = [];
  private heartbeatTimer: any = null;
  private currentRoomId: string | null = null;
  private currentUserId: string | null = null;
  private isInitialized = false;

  public async init(config?: { webUrl?: string; bundleVersion?: string | null; userId?: string | null }) {
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (config?.webUrl) this.webUrl = config.webUrl.replace(/\/+$/, "");
    if (config?.bundleVersion) this.bundleVersion = config.bundleVersion;
    if (config?.userId) this.currentUserId = config.userId;

    // Track launch
    await this.trackLaunch();

    // Start heartbeat
    this.startHeartbeat();
  }

  public setRoomState(inRoom: boolean, roomId?: string | null) {
    this.currentRoomId = inRoom && roomId ? roomId : null;
  }

  public async track(eventName: TelemetryEventName, properties: Record<string, any> = {}) {
    const distinctId = await getDistinctId();
    const sessionId = await getSessionId();

    const event: TelemetryEventItem = {
      eventName,
      distinctId,
      userId: this.currentUserId,
      sessionId,
      platform: getPlatformType(),
      appVersion: this.appVersion,
      rendererVersion: this.bundleVersion,
      os: Platform.OS === "android" ? "Android" : "iOS",
      osVersion: String(Platform.Version || ""),
      deviceModel: Constants.deviceName || undefined,
      clientTime: Date.now(),
      properties: {
        roomId: this.currentRoomId,
        ...properties,
      },
    };

    this.queue.push(event);
    if (this.queue.length >= 3) {
      this.flush();
    }
  }

  public async trackLaunch() {
    await this.track("app:launch", {
      platform: Platform.OS,
      osVersion: Platform.Version,
      appVersion: this.appVersion,
      bundleVersion: this.bundleVersion,
    });
  }

  public async flush() {
    if (this.queue.length === 0) return;
    const batch = [...this.queue];
    this.queue = [];

    const endpoint = `${this.webUrl}/api/telemetry/report`;
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
    } catch {
      // Re-queue
      this.queue = [...batch, ...this.queue].slice(0, 30);
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    setTimeout(() => this.sendHeartbeat(), 10000);
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 120000);
  }

  private async sendHeartbeat() {
    const distinctId = await getDistinctId();
    const sessionId = await getSessionId();

    const payload: TelemetryHeartbeatPayload = {
      sessionId,
      distinctId,
      userId: this.currentUserId,
      platform: getPlatformType(),
      appVersion: this.appVersion,
      inRoom: Boolean(this.currentRoomId),
      roomId: this.currentRoomId,
      activeSeconds: 120,
    };

    const endpoint = `${this.webUrl}/api/telemetry/heartbeat`;
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Ignore
    }
  }
}

export const mobileTelemetry = new MobileTelemetryService();
