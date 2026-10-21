import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type {
  TelemetryEventItem,
  TelemetryEventName,
  TelemetryHeartbeatPayload,
  TelemetryPlatform,
} from "@yiqikan/shared";
import { resolveWebUrl, isTelemetryEnabled } from "./environment";

import { TelemetryConsent } from "./telemetry-consent";

const STORAGE_KEY_DISTINCT_ID = "@yiqikan_telemetry_distinct_id";

let distinctIdCache: string | null = null;
let sessionIdCache: string | null = null;

async function getDistinctId(): Promise<string | null> {
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
    return null;
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
  private webUrl: string = resolveWebUrl();
  private appVersion: string = Constants.expoConfig?.version || "1.12.0";
  private bundleVersion: string | null = null;
  private queue: TelemetryEventItem[] = [];
  private flushTimer: any = null;
  private heartbeatTimer: any = null;
  private currentRoomId: string | null = null;
  private currentUserId: string | null = null;
  private initialized = false;
  private consent = new TelemetryConsent(AsyncStorage);
  private initialHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private requests = new Set<AbortController>();

  private allowed() { return isTelemetryEnabled() && this.consent.enabled; }

  public async getEnabled() {
    await this.consent.load();
    return this.consent.enabled;
  }

  public async setEnabled(enabled: boolean) {
    this.stop();
    await this.consent.set(enabled);
    if (this.allowed()) {
      await this.trackLaunch();
      this.startHeartbeat();
    }
  }

  private stop() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.initialHeartbeatTimer) clearTimeout(this.initialHeartbeatTimer);
    this.flushTimer = this.heartbeatTimer = this.initialHeartbeatTimer = null;
    this.queue = [];
    this.requests.forEach(request => request.abort());
    this.requests.clear();
  }

  public async init(config?: { webUrl?: string; bundleVersion?: string | null; userId?: string | null }) {
    if (config?.webUrl) this.webUrl = config.webUrl.replace(/\/+$/, "");
    if (config?.bundleVersion) this.bundleVersion = config.bundleVersion;
    if (config?.userId) this.currentUserId = config.userId;
    if (this.initialized) return;
    this.initialized = true;
    await this.consent.load();
    if (!this.allowed()) return;

    // Track launch
    await this.trackLaunch();

    // Start heartbeat
    this.startHeartbeat();
  }

  public setRoomState(inRoom: boolean, roomId?: string | null) {
    this.currentRoomId = inRoom && roomId ? roomId : null;
  }

  public async track(eventName: TelemetryEventName, properties: Record<string, any> = {}) {
    if (!this.allowed()) {
      return;
    }
    const revision = this.consent.revision;
    const distinctId = await getDistinctId();
    if (!distinctId) return;
    const sessionId = await getSessionId();
    if (!this.consent.permits(revision)) return;

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
      clientTime: Date.now(),
      // No URLs, titles, nicknames, room numbers or free-form text in usage statistics.
      properties: Object.fromEntries(Object.entries(properties).filter(([key, value]) =>
        ['platform', 'osVersion', 'appVersion', 'bundleVersion', 'duration', 'inRoom'].includes(key)
        && ['string', 'number', 'boolean'].includes(typeof value))),
    };

    this.queue.push(event);
    if (this.queue.length >= 3) {
      this.flush();
    } else {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => this.flush(), 3000);
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
    if (!this.allowed()) {
      this.queue = [];
      return;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return;
    const batch = [...this.queue];
    this.queue = [];

    const revision = this.consent.revision;
    const request = new AbortController();
    this.requests.add(request);
    const endpoint = `${this.webUrl}/api/telemetry/report`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        signal: request.signal,
      });
      if (!response.ok) throw new Error('Telemetry report failed');
    } catch {
      if (this.consent.permits(revision)) this.queue = [...batch, ...this.queue].slice(0, 30);
    } finally {
      this.requests.delete(request);
    }
  }

  private startHeartbeat() {
    if (!this.allowed()) {
      return;
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    if (this.initialHeartbeatTimer) clearTimeout(this.initialHeartbeatTimer);
    this.initialHeartbeatTimer = setTimeout(() => this.sendHeartbeat(), 10000);
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 120000);
  }

  private async sendHeartbeat() {
    if (!this.allowed()) {
      return;
    }
    const revision = this.consent.revision;
    const distinctId = await getDistinctId();
    if (!distinctId) return;
    const sessionId = await getSessionId();
    if (!this.consent.permits(revision)) return;

    const payload: TelemetryHeartbeatPayload = {
      sessionId,
      distinctId,
      userId: this.currentUserId,
      platform: getPlatformType(),
      appVersion: this.appVersion,
      inRoom: Boolean(this.currentRoomId),
      roomId: null,
      activeSeconds: 120,
    };

    const request = new AbortController();
    this.requests.add(request);
    const endpoint = `${this.webUrl}/api/telemetry/heartbeat`;
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: request.signal,
      });
    } catch {
      // Ignore
    } finally {
      this.requests.delete(request);
    }
  }
}

export const mobileTelemetry = new MobileTelemetryService();
