import type {
  TelemetryEventItem,
  TelemetryEventName,
  TelemetryHeartbeatPayload,
  TelemetryPlatform,
} from "@yiqikan/shared";

const DISTINCT_ID_KEY = "yiqikan:telemetry:distinct_id";
const SESSION_ID_KEY = "yiqikan:telemetry:session_id";

function getDistinctId(): string {
  try {
    let id = localStorage.getItem(DISTINCT_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `desk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(DISTINCT_ID_KEY, id);
    }
    return id;
  } catch {
    return "anonymous_desktop";
  }
}

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return "session_desktop";
  }
}

export function detectDesktopPlatform(): {
  platform: TelemetryPlatform;
  os: string;
  arch: string;
} {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let os = "Desktop";
  let arch = "x64";
  let platform: TelemetryPlatform = "desktop_windows";

  if (/macintosh|mac os x/i.test(ua)) {
    os = "macOS";
    // Check for Apple Silicon indicators
    // In Chromium / Electron on Apple Silicon, WebGL renderer or UA may specify ARM/Intel or we check process arch
    const isArm = /arm64|aarch64/i.test(ua) || (navigator as any).userAgentData?.architecture === "arm";
    const isMacArmFallback = (navigator as any).platform === "MacIntel" && (navigator.maxTouchPoints > 0 || (window as any).process?.arch === "arm64");
    if (isArm || isMacArmFallback) {
      arch = "arm64";
      platform = "desktop_mac_arm64";
    } else {
      arch = "x64";
      platform = "desktop_mac_x64";
    }
  } else if (/windows/i.test(ua)) {
    os = "Windows";
    platform = "desktop_windows";
    arch = "x64";
  } else if (/linux/i.test(ua)) {
    os = "Linux";
    platform = "desktop_linux";
  }

  return { platform, os, arch };
}

class DesktopTelemetryService {
  private webUrl: string = "https://yiqikan.club";
  private appVersion: string = "0.2.4";
  private rendererVersion: string | null = null;
  private queue: TelemetryEventItem[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentRoomId: string | null = null;
  private currentUserId: string | null = null;
  private isInitialized = false;

  public init(config: {
    webUrl: string;
    appVersion: string;
    rendererVersion?: string | null;
    userId?: string | null;
  }) {
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.webUrl = config.webUrl.replace(/\/+$/, "");
    this.appVersion = config.appVersion;
    this.rendererVersion = config.rendererVersion ?? null;
    this.currentUserId = config.userId ?? null;

    // Track app launch
    this.trackLaunch();

    // Start 2-minute heartbeat
    this.startHeartbeat();

    // Flush queue when window is closing
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        this.flush(true);
      });
    }
  }

  public setUserId(userId: string | null) {
    this.currentUserId = userId;
  }

  public setRoomState(inRoom: boolean, roomId?: string | null) {
    this.currentRoomId = inRoom && roomId ? roomId : null;
  }

  public track(eventName: TelemetryEventName, properties: Record<string, any> = {}) {
    const { platform, os, arch } = detectDesktopPlatform();

    const event: TelemetryEventItem = {
      eventName,
      distinctId: getDistinctId(),
      userId: this.currentUserId,
      sessionId: getSessionId(),
      platform,
      appVersion: this.appVersion,
      rendererVersion: this.rendererVersion,
      os,
      deviceModel: arch,
      clientTime: Date.now(),
      properties: {
        screen: typeof window !== "undefined" ? `${window.screen.width}x${window.screen.height}` : undefined,
        roomId: this.currentRoomId,
        ...properties,
      },
    };

    this.queue.push(event);

    if (this.queue.length >= 5) {
      this.flush();
    } else {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => this.flush(), 3000);
    }
  }

  public trackLaunch() {
    const { os, arch } = detectDesktopPlatform();
    this.track("app:launch", {
      os,
      arch,
      app_version: this.appVersion,
      renderer_version: this.rendererVersion,
    });
  }

  public trackRoomCreate(roomId: string, isPublic: boolean, hasPassword: boolean) {
    this.track("room:create", {
      roomId,
      isPublic,
      hasPassword,
    });
  }

  public trackRoomJoin(roomId: string) {
    this.track("room:join", {
      roomId,
    });
  }

  public trackRoomLeave(roomId: string, durationSeconds?: number) {
    this.track("room:leave", {
      roomId,
      duration_seconds: durationSeconds,
    });
  }

  public trackVideoSniff(domain: string, success: boolean, videoCount: number) {
    this.track("video:sniff_result", {
      domain,
      success,
      videoCount,
    });
  }

  public async flush(useBeacon = false) {
    if (this.queue.length === 0) return;
    const batch = [...this.queue];
    this.queue = [];

    const endpoint = `${this.webUrl}/api/telemetry/report`;
    const payload = JSON.stringify({ events: batch });

    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(endpoint, blob);
      return;
    }

    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
    } catch {
      // Keep in queue
      this.queue = [...batch, ...this.queue].slice(0, 50);
    }
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    // Initial heartbeat after 10s
    setTimeout(() => this.sendHeartbeat(), 10000);

    // Then every 2 minutes (120,000ms)
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 120000);
  }

  private async sendHeartbeat() {
    const { platform } = detectDesktopPlatform();
    const payload: TelemetryHeartbeatPayload = {
      sessionId: getSessionId(),
      distinctId: getDistinctId(),
      userId: this.currentUserId,
      platform,
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
      // Heartbeat failure ignored
    }
  }
}

export const desktopTelemetry = new DesktopTelemetryService();
