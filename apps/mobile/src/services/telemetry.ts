import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import {
  MOBILE_TELEMETRY_EVENTS, TELEMETRY_BATCH_SIZE, sanitizeMobileTelemetryProperties,
  type TelemetryEventItem, type TelemetryEventName, type TelemetryHeartbeatPayload,
  type RoomEntryObservation,
} from '@yiqikan/shared';
import { resolveWebUrl, isTelemetryEnabled } from './environment';
import { TelemetryConsent } from './telemetry-consent';
import { TelemetrySession } from './telemetry-session';

const STORAGE_KEY_DISTINCT_ID = '@yiqikan_telemetry_distinct_id';
const newId = () => `mt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 13)}`;
const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
let distinctIdTask: Promise<string | null> | null = null;
function getDistinctId(): Promise<string | null> {
  return distinctIdTask ??= (async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY_DISTINCT_ID);
      if (stored) return stored;
      const id = `mob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await AsyncStorage.setItem(STORAGE_KEY_DISTINCT_ID, id);
      return id;
    } catch { distinctIdTask = null; return null; }
  })();
}

class MobileTelemetryService {
  private webUrl = resolveWebUrl();
  private appVersion = Constants.nativeAppVersion || Constants.expoConfig?.version || 'unknown';
  private bundleVersion: string | null = null;
  private sessionId = newId();
  private queue: Array<TelemetryEventItem & { retries: number }> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledFlushAt = 0;
  private retryAfter = 0;
  private summaryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private initialHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private requests = new Set<AbortController>();
  private requestTimeouts = new Map<AbortController, ReturnType<typeof setTimeout>>();
  private flushing = false;
  private initialized = false;
  private pendingLaunch: 'home' | 'resume' | null = null;
  private consent = new TelemetryConsent(AsyncStorage);
  private active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
  private roomId: string | null = null;
  private sceneId = newId();
  private nextSceneId: string | null = null;
  private isHost = false;
  private peerObserved = false;
  private metrics = new TelemetrySession();
  private heartbeatAt = 0;
  private heartbeatBusy = false;
  private playback = { id: newId(), at: clock(), ready: false, playing: false, errors: new Set<string>() };

  private allowed() { return isTelemetryEnabled() && this.consent.enabled; }
  public measurementEnabled() { return this.allowed(); }
  public async getEnabled() { await this.consent.load(); return this.consent.enabled; }
  public async setEnabled(enabled: boolean) {
    this.stop();
    await this.consent.set(enabled);
    if (this.allowed()) {
      this.sceneId = newId();
      this.nextSceneId = null;
      this.playback = { id: newId(), at: clock(), ready: false, playing: false, errors: new Set() };
      await this.launchWhenActive();
      this.startHeartbeat();
    }
  }
  private stop() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.initialHeartbeatTimer) clearTimeout(this.initialHeartbeatTimer);
    if (this.summaryTimer) clearTimeout(this.summaryTimer);
    this.flushTimer = this.heartbeatTimer = this.initialHeartbeatTimer = null;
    this.summaryTimer = null;
    this.retryAfter = this.scheduledFlushAt = 0;
    this.pendingLaunch = null;
    this.queue = [];
    this.metrics = new TelemetrySession();
    this.requests.forEach(request => request.abort());
    this.requests.clear();
    this.requestTimeouts.forEach(timeout => clearTimeout(timeout));
    this.requestTimeouts.clear();
  }
  public async init(config?: { webUrl?: string; appVersion?: string; bundleVersion?: string | null }) {
    if (config?.webUrl) this.webUrl = config.webUrl.replace(/\/+$/, '');
    if (config?.appVersion) this.appVersion = config.appVersion;
    if (config?.bundleVersion) this.bundleVersion = config.bundleVersion;
    if (this.initialized) return;
    this.initialized = true;
    await this.consent.load();
    this.active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    AppState.addEventListener('change', state => {
      if (state === 'active') this.setForeground(true);
      else if (state === 'background') this.setForeground(false);
    });
    if (!this.allowed()) return;
    await this.launchWhenActive(true);
    this.startHeartbeat();
  }
  private setForeground(active: boolean) {
    if (this.active === active) return;
    if (!active && this.allowed()) {
      this.summarize('background');
      void this.sendHeartbeat();
      // track() resolves the anonymous identity before adding its event.
      void Promise.resolve().then(() => this.flush());
    }
    this.active = active;
    this.metrics.foreground(active && this.allowed(), clock());
    this.scheduleSummary();
    this.heartbeatAt = clock();
    if (active && this.allowed() && this.pendingLaunch) void this.launchWhenActive(this.pendingLaunch === 'home');
    if (active && this.allowed()) void this.sendHeartbeat(0);
  }
  public setRoomState(inRoom: boolean, roomId?: string | null, members = 1, isHost = false) {
    const next = inRoom && roomId ? roomId : null;
    if (next !== this.roomId) {
      if (this.allowed()) this.summarize(next ? 'room_change' : 'leave');
      this.roomId = next;
      this.sceneId = this.nextSceneId || newId();
      this.nextSceneId = null;
      this.peerObserved = false;
    }
    this.isHost = isHost;
    if (next && members >= 2 && !this.peerObserved && this.allowed()) {
      this.peerObserved = true;
      void this.track('room:peer_arrived', { memberCount: members });
    }
  }
  public observeRoomEntry(event: RoomEntryObservation) {
    if (!this.allowed()) return;
    if (event.source === 'reconnect') { this.metrics.reconnectCount++; return; }
    if (event.outcome === 'success') this.nextSceneId = event.flowId;
    void this.track(`room:${event.action}_${event.outcome === 'request' ? 'request' : 'result'}`, {
      source: event.source, flowId: event.flowId, outcome: event.outcome === 'request' ? undefined : event.outcome,
      ...(event.outcome === 'success' ? { sceneId: event.flowId } : {}),
      elapsedMs: event.elapsedMs, errorCode: event.errorCode, memberCount: event.members,
    });
  }
  public beginPlayback() {
    this.metrics.resetPlayback();
    this.playback = { id: newId(), at: clock(), ready: false, playing: false, errors: new Set() };
  }
  public playerReady() {
    if (!this.allowed() || this.playback.ready) return;
    this.playback.ready = true;
    void this.track('playback:result', { outcome: 'ready', flowId: this.playback.id, elapsedMs: clock() - this.playback.at });
  }
  public samplePlayback(position: number, paused: boolean) {
    if (!this.allowed()) return;
    if (this.metrics.playback(position, paused, clock()) && !this.playback.playing) {
      this.playback.playing = true;
      void this.track('playback:result', { outcome: 'playing', flowId: this.playback.id, elapsedMs: clock() - this.playback.at });
    }
  }
  public playbackFailure(errorCode: 'NETWORK' | 'HTTP' | 'RENDER_PROCESS' | 'MEDIA') {
    if (!this.allowed() || this.playback.errors.has(errorCode)) return;
    this.playback.errors.add(errorCode);
    this.metrics.failureCount++;
    this.metrics.resetPlayback();
    void this.track('playback:result', { outcome: 'failure', errorCode, flowId: this.playback.id, elapsedMs: clock() - this.playback.at });
  }
  private summarize(reason: string) {
    const metrics = this.metrics.drain(clock());
    this.scheduleSummary();
    if (Object.values(metrics).some(value => value > 0)) void this.track('session:summary', { ...metrics, reason });
  }
  private scheduleSummary() {
    if (this.summaryTimer) clearTimeout(this.summaryTimer);
    this.summaryTimer = null;
    if (this.active && this.allowed()) this.summaryTimer = setTimeout(() => {
      this.summaryTimer = null;
      if (this.active && this.allowed()) this.summarize('interval');
    }, 600000);
  }
  public async track(eventName: TelemetryEventName, properties: Record<string, unknown> = {}) {
    if (!this.allowed() || !(MOBILE_TELEMETRY_EVENTS as readonly string[]).includes(eventName)) return;
    const revision = this.consent.revision;
    const context = { sceneId: properties.sceneId ?? this.sceneId, inRoom: !!this.roomId, isHost: this.isHost };
    const clientTime = Date.now();
    const distinctId = await getDistinctId();
    if (!distinctId || !this.consent.permits(revision)) return;
    this.queue.push({
      eventId: newId(), eventName, distinctId, sessionId: this.sessionId,
      platform: Platform.OS === 'android' ? 'mobile_android' : 'mobile_ios',
      appVersion: this.appVersion, rendererVersion: this.bundleVersion,
      os: Platform.OS === 'android' ? 'Android' : 'iOS', osVersion: String(Platform.Version || ''), clientTime,
      properties: sanitizeMobileTelemetryProperties({ ...properties, ...context, schemaVersion: 1,
        environment: typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'production' }), retries: 0,
    });
    this.queue = this.queue.slice(-100);
    if (this.queue.length >= TELEMETRY_BATCH_SIZE) void this.flush();
    else this.scheduleFlush();
  }
  private scheduleFlush(delay = 15000) {
    if (!this.queue.length || !this.allowed()) return;
    const at = Math.max(clock() + delay, this.retryAfter);
    if (this.flushTimer && this.scheduledFlushAt >= this.retryAfter && this.scheduledFlushAt <= at) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.scheduledFlushAt = at;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null; void this.flush();
    }, Math.max(0, at - clock()));
  }
  public async trackLaunch() { await this.track('app:launch', { platform: Platform.OS }); }
  private async launchWhenActive(home = false) {
    if (!this.active) { this.pendingLaunch = home ? 'home' : 'resume'; return; }
    this.pendingLaunch = null;
    await this.trackLaunch();
    if (home) void this.track('app:entry', { source: 'home' });
  }
  public async flush() {
    if (!this.allowed()) { this.queue = []; return; }
    if (this.flushing) return;
    if (clock() < this.retryAfter) { this.scheduleFlush(0); return; }
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.queue.length) return;
    this.flushing = true;
    const batch = this.queue.splice(0, TELEMETRY_BATCH_SIZE);
    const revision = this.consent.revision;
    const request = new AbortController();
    this.requests.add(request);
    const timeout = setTimeout(() => request.abort(), 10000);
    this.requestTimeouts.set(request, timeout);
    let retry = false;
    try {
      const response = await fetch(`${this.webUrl}/api/telemetry/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch.map(({ retries, ...event }) => event) }), signal: request.signal,
      });
      retry = response.status === 429 || response.status >= 500;
    } catch { retry = true; }
    finally {
      clearTimeout(timeout);
      this.requestTimeouts.delete(request);
      if (retry && this.consent.permits(revision)) {
        this.queue = [...batch.filter(event => event.retries < 2).map(event => ({ ...event, retries: event.retries + 1 })), ...this.queue].slice(0, 100);
      }
      if (this.consent.permits(revision)) this.retryAfter = retry ? clock() + 30000 : 0;
      this.requests.delete(request);
      this.flushing = false;
      this.scheduleFlush(retry ? 30000 : 15000);
    }
  }
  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.initialHeartbeatTimer) clearTimeout(this.initialHeartbeatTimer);
    this.metrics.foreground(this.active, clock());
    this.heartbeatAt = clock();
    this.scheduleSummary();
    this.initialHeartbeatTimer = setTimeout(() => { this.initialHeartbeatTimer = null; void this.sendHeartbeat(); }, 10000);
    this.heartbeatTimer = setInterval(() => {
      if (this.active && this.allowed()) {
        void this.sendHeartbeat();
      }
    }, 120000);
  }
  private async sendHeartbeat(seconds?: number) {
    if (!this.allowed() || !this.active || this.heartbeatBusy) return;
    this.heartbeatBusy = true;
    const now = clock();
    const activeSeconds = seconds ?? Math.max(0, Math.min(120, Math.floor((now - this.heartbeatAt) / 1000)));
    this.heartbeatAt = now;
    const revision = this.consent.revision;
    const request = new AbortController();
    this.requests.add(request);
    const timeout = setTimeout(() => request.abort(), 10000);
    this.requestTimeouts.set(request, timeout);
    try {
      const distinctId = await getDistinctId();
      if (!distinctId || !this.consent.permits(revision)) return;
      const payload: TelemetryHeartbeatPayload = {
        sessionId: this.sessionId, distinctId, platform: Platform.OS === 'android' ? 'mobile_android' : 'mobile_ios',
        appVersion: this.appVersion, rendererVersion: this.bundleVersion, inRoom: !!this.roomId, roomId: null, activeSeconds,
      };
      await fetch(`${this.webUrl}/api/telemetry/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: request.signal });
    } catch { /* Statistics must never interrupt playback. */ }
    finally { clearTimeout(timeout); this.requestTimeouts.delete(request); this.requests.delete(request); this.heartbeatBusy = false; }
  }
}
export const mobileTelemetry = new MobileTelemetryService();
