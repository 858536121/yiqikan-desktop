import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Socket } from "socket.io-client";
import {
  ROOM_EVENTS,
  type PlaybackSyncRequestPayload,
  type PlaybackSyncResponsePayload,
  type PlayerEventPayload,
  type RoomState,
} from "@yiqikan/shared";
import type { SyncWebviewElement, VideoStatus } from "../types/sync";

const VIDEO_STATUS_GRACE_MS = 15000;
const MEMBER_RESUME_REQUEST_DEDUPE_MS = 800;
const MEMBER_RESUME_REQUEST_TIMEOUT_MS = 4000;
// How long after a sync command to suppress play-attempt forwarding from preload
const SYNC_SUPPRESS_PLAY_ATTEMPT_MS = 800;
// Time windows for intent tracking (mirrors old preload constants)
const MEMBER_SYNC_INTENT_PAUSE_MS = 1500;
const MEMBER_SYNC_INTENT_RESUME_MS = 6000;
const AUTHORITATIVE_SYNC_EVENT_WINDOW_MS = 5000;

interface UseVideoSyncOptions {
  client: Socket;
  currentUserId: string;
  room: RoomState | null;
  roomRef: MutableRefObject<RoomState | null>;
  isHost: boolean;
  isHostRef: MutableRefObject<boolean>;
  webviewRef: MutableRefObject<SyncWebviewElement | null>;
  webviewReady: boolean;
  activeUrl: string | null;
  memberLocalPauseRef: MutableRefObject<boolean>;
  setMemberLocalPause: (paused: boolean) => void;
  showToast: (message: string) => void;
  name: string;
  sendChatMessage: (message: string, kind?: "text" | "system") => void;
}

export function useVideoSync({
  client,
  currentUserId,
  room,
  roomRef,
  isHost,
  isHostRef,
  webviewRef,
  webviewReady,
  activeUrl,
  memberLocalPauseRef,
  setMemberLocalPause,
  showToast,
  name,
  sendChatMessage,
}: UseVideoSyncOptions) {
  const [videoDetected, setVideoDetected] = useState(false);
  const [videoStatus, setVideoStatus] = useState<VideoStatus | null>(null);
  const [videoSignalLost, setVideoSignalLost] = useState(false);

  const hasDetectedVideoRef = useRef(false);
  const lastVideoSeenAtRef = useRef(0);
  const clearVideoStatusTimerRef = useRef<number | null>(null);
  const videoStatusRef = useRef<VideoStatus | null>(null);
  const hostVideoSyncIdRef = useRef(0);
  const latestAppliedVideoSyncRef = useRef({ syncId: 0, localTimestamp: 0 });
  const lastBroadcastRef = useRef({ ct: -1, paused: true, rate: 1, ts: 0 });
  const memberResumeRequestRef = useRef<{ pending: boolean; requestedAt: number; timeoutId: number | null }>({
    pending: false,
    requestedAt: 0,
    timeoutId: null,
  });

  // --- Member play/pause intent tracking (moved from preload) ---
  const memberSyncIntentRef = useRef<{ paused: boolean; until: number } | null>(null);
  const authoritativePlaybackPausedRef = useRef<boolean | null>(null);
  const authoritativeSyncEventRef = useRef<{ paused: boolean; until: number } | null>(null);
  const lastSyncCommandAtRef = useRef(0);

  const resetVideoState = useCallback(() => {
    setVideoDetected(false);
    setVideoStatus(null);
    setVideoSignalLost(false);
    hasDetectedVideoRef.current = false;
    lastVideoSeenAtRef.current = 0;
    if (clearVideoStatusTimerRef.current) {
      window.clearTimeout(clearVideoStatusTimerRef.current);
      clearVideoStatusTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    videoStatusRef.current = videoStatus;
  }, [videoStatus]);

  useEffect(() => {
    setMemberLocalPause(false);
    memberSyncIntentRef.current = null;
    authoritativePlaybackPausedRef.current = null;
    authoritativeSyncEventRef.current = null;
  }, [activeUrl, isHost, room?.id, setMemberLocalPause]);

  useEffect(() => {
    latestAppliedVideoSyncRef.current = { syncId: 0, localTimestamp: 0 };
  }, [room?.id]);

  useEffect(() => {
    hostVideoSyncIdRef.current = Math.max(hostVideoSyncIdRef.current, room?.playback.syncId ?? 0);
  }, [room?.playback.syncId]);

  useEffect(() => {
    resetVideoState();
  }, [activeUrl, resetVideoState]);

  useEffect(() => {
    return () => {
      if (clearVideoStatusTimerRef.current) window.clearTimeout(clearVideoStatusTimerRef.current);
      if (memberResumeRequestRef.current.timeoutId) window.clearTimeout(memberResumeRequestRef.current.timeoutId);
    };
  }, []);

  // --- Intent helpers ---

  function markMemberSyncIntent(paused: boolean) {
    memberSyncIntentRef.current = { paused, until: Date.now() + (paused ? MEMBER_SYNC_INTENT_PAUSE_MS : MEMBER_SYNC_INTENT_RESUME_MS) };
  }

  function hasMemberSyncIntent(paused: boolean): boolean {
    const intent = memberSyncIntentRef.current;
    if (!intent || intent.paused !== paused) return false;
    if (Date.now() > intent.until) { memberSyncIntentRef.current = null; return false; }
    return true;
  }

  function markAuthoritativeSyncEvent(paused: boolean) {
    authoritativeSyncEventRef.current = { paused, until: Date.now() + AUTHORITATIVE_SYNC_EVENT_WINDOW_MS };
  }

  function hasAuthoritativeSyncEvent(paused: boolean): boolean {
    const ev = authoritativeSyncEventRef.current;
    if (!ev || ev.paused !== paused) return false;
    if (Date.now() > ev.until) { authoritativeSyncEventRef.current = null; return false; }
    return true;
  }

  function shouldBlockLocalResume(): boolean {
    const effectivePaused = authoritativePlaybackPausedRef.current === null ? true : authoritativePlaybackPausedRef.current;
    return !isHostRef.current && effectivePaused === true && !hasAuthoritativeSyncEvent(false) && !hasMemberSyncIntent(false);
  }

  // --- Video status handling ---

  const createVideoSyncMeta = useCallback((localTimestamp = Date.now() / 1000) => {
    hostVideoSyncIdRef.current += 1;
    return { syncId: hostVideoSyncIdRef.current, localTimestamp };
  }, []);

  const shouldIgnoreIncomingVideoSync = useCallback((payload: Pick<PlayerEventPayload, "syncId" | "localTimestamp">) => {
    const nextSyncId = payload.syncId ?? 0;
    const nextTimestamp = payload.localTimestamp ?? 0;
    const last = latestAppliedVideoSyncRef.current;

    if (nextSyncId > 0 && nextSyncId < last.syncId) return true;
    if (nextSyncId === last.syncId && nextTimestamp > 0 && nextTimestamp <= last.localTimestamp) return true;
    if (nextSyncId === 0 && last.syncId > 0 && nextTimestamp > 0 && nextTimestamp <= last.localTimestamp) return true;

    latestAppliedVideoSyncRef.current = {
      syncId: Math.max(last.syncId, nextSyncId),
      localTimestamp: Math.max(last.localTimestamp, nextTimestamp),
    };
    return false;
  }, []);

  // --- IPC message handler for webview events ---

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;

    function handleIpcMessage(event: any) {
      const channel: string = event.channel;

      // --- Video status reports ---
      if (channel === "yiqikan:video-status") {
        const nextStatus = event.args?.[0] as VideoStatus | undefined;
        if (!nextStatus) return;

        if (nextStatus.found) {
          if (clearVideoStatusTimerRef.current) {
            window.clearTimeout(clearVideoStatusTimerRef.current);
            clearVideoStatusTimerRef.current = null;
          }
          lastVideoSeenAtRef.current = Date.now();
          hasDetectedVideoRef.current = true;
          setVideoSignalLost(false);
          setVideoDetected(true);
          setVideoStatus(nextStatus);

          const activeRoom = roomRef.current;
          if (isHostRef.current && activeRoom && currentUserId) {
            const last = lastBroadcastRef.current;
            const now = Date.now();
            const pauseChanged = nextStatus.paused !== last.paused;
            const rateChanged = nextStatus.playbackRate !== last.rate;
            const elapsedSeconds = !last.paused && last.ts > 0 ? ((now - last.ts) / 1000) * (last.rate || 1) : 0;
            const expectedCurrentTime = last.ct >= 0 ? last.ct + elapsedSeconds : (nextStatus.currentTime ?? 0);
            const timeDrift = Math.abs((nextStatus.currentTime ?? 0) - expectedCurrentTime);
            const isUserAction = pauseChanged || rateChanged;
            const isSignificantDrift = timeDrift > 1.25;
            const interval = nextStatus.paused ? 10000 : 5000;
            const heartbeatDue = now - last.ts > interval;

            if (isUserAction || isSignificantDrift || heartbeatDue) {
              const syncMeta = createVideoSyncMeta(nextStatus.localTimestamp);
              lastBroadcastRef.current = {
                ct: nextStatus.currentTime ?? 0,
                paused: !!nextStatus.paused,
                rate: nextStatus.playbackRate ?? 1,
                ts: now,
              };
              client.emit(ROOM_EVENTS.PlayerEvent, {
                roomId: activeRoom.id,
                actorId: currentUserId,
                action: "video_sync",
                currentTime: nextStatus.currentTime,
                paused: nextStatus.paused,
                playbackRate: nextStatus.playbackRate,
                duration: nextStatus.duration,
                syncId: syncMeta.syncId,
                localTimestamp: syncMeta.localTimestamp,
                allowResume: pauseChanged && !nextStatus.paused,
              } satisfies PlayerEventPayload);
            }
          }
          return;
        }

        const lastSeenAt = lastVideoSeenAtRef.current;
        const staleFor = lastSeenAt ? Date.now() - lastSeenAt : VIDEO_STATUS_GRACE_MS;

        if (!hasDetectedVideoRef.current && staleFor >= VIDEO_STATUS_GRACE_MS) {
          setVideoDetected(false);
          setVideoStatus(null);
          setVideoSignalLost(false);
          return;
        }

        if (clearVideoStatusTimerRef.current) window.clearTimeout(clearVideoStatusTimerRef.current);
        clearVideoStatusTimerRef.current = window.setTimeout(() => {
          if (Date.now() - lastVideoSeenAtRef.current >= VIDEO_STATUS_GRACE_MS) {
            if (hasDetectedVideoRef.current) {
              setVideoDetected(true);
              setVideoSignalLost(true);
            } else {
              setVideoDetected(false);
              setVideoStatus(null);
              setVideoSignalLost(false);
            }
          }
        }, VIDEO_STATUS_GRACE_MS - staleFor);
        return;
      }

      // --- Play attempt from user (preload deferred decision to renderer) ---
      if (channel === "yiqikan:play-attempt") {
        if (isHostRef.current) return;
        // Suppress if this came right after a sync command we sent
        if (Date.now() - lastSyncCommandAtRef.current < SYNC_SUPPRESS_PLAY_ATTEMPT_MS) return;

        const wv = webviewRef.current;
        if (!wv) return;

        if (memberLocalPauseRef.current) {
          wv.send("yiqikan:force-pause");
          return;
        }
        if (hasAuthoritativeSyncEvent(false) || hasMemberSyncIntent(false)) return;
        if (shouldBlockLocalResume()) {
          wv.send("yiqikan:force-pause");
          ipcRenderer_sendMemberResumeRequest();
        }
        return;
      }

      // --- Pause attempt from user ---
      if (channel === "yiqikan:pause-attempt") {
        if (isHostRef.current) return;
        if (Date.now() - lastSyncCommandAtRef.current < SYNC_SUPPRESS_PLAY_ATTEMPT_MS) return;
        if (hasAuthoritativeSyncEvent(true) || hasMemberSyncIntent(true) || hasMemberSyncIntent(false)) return;
        // It's a genuine user pause — record local pause state
        setMemberLocalPause(true);
        sendChatMessage(`${name || "成员"} 暂停了视频`, "system");
        return;
      }

      // --- Navigation attempt from subframe ---
      if (channel === "yiqikan:navigation-attempt") {
        if (!isHostRef.current) {
          showToast("请使用右侧视频按钮暂停或继续跟播");
        }
        return;
      }

      // --- Legacy member-blocked-action from preload ---
      if (channel === "yiqikan:member-blocked-action") {
        showToast("请使用右侧视频按钮暂停或继续跟播");
        return;
      }

      // --- Member resume request ---
      if (channel === "yiqikan:member-resume-request") {
        requestMemberResumeInner();
        return;
      }

      // --- Member local pause change (from preload keydown/click) ---
      if (channel === "yiqikan:member-local-pause-change") {
        const payload = event.args?.[0] as { paused?: boolean } | undefined;
        setMemberLocalPause(Boolean(payload?.paused));
        return;
      }
    }

    wv.addEventListener("ipc-message", handleIpcMessage);
    return () => wv.removeEventListener("ipc-message", handleIpcMessage);
  }, [
    client,
    createVideoSyncMeta,
    currentUserId,
    isHostRef,
    memberLocalPauseRef,
    name,
    roomRef,
    sendChatMessage,
    setMemberLocalPause,
    showToast,
    webviewReady,
    webviewRef,
  ]);

  // Thin wrapper so the closure above can call it without capturing requestMemberResume
  // (which would need to be in the dep array before it's defined)
  const requestMemberResumeInnerRef = useRef<() => void>(() => {});

  function ipcRenderer_sendMemberResumeRequest() {
    requestMemberResumeInnerRef.current();
  }

  // --- Incoming video sync from socket ---

  useEffect(() => {
    function handleVideoSync(payload: PlayerEventPayload) {
      if (payload.action !== "video_sync") return;
      if (isHostRef.current) return;
      if (memberLocalPauseRef.current && !payload.paused) return;
      if (shouldIgnoreIncomingVideoSync(payload)) return;

      // Update authoritative state before sending to preload
      if (typeof payload.paused === "boolean") {
        authoritativePlaybackPausedRef.current = payload.paused;
        markAuthoritativeSyncEvent(payload.paused);
        if (payload.paused || payload.allowResume) markMemberSyncIntent(payload.paused);
      }

      lastSyncCommandAtRef.current = Date.now();
      const wv = webviewRef.current;
      if (!wv) return;
      wv.send("yiqikan:video-sync", {
        currentTime: payload.currentTime,
        paused: payload.paused,
        playbackRate: payload.playbackRate,
        syncId: payload.syncId,
        localTimestamp: payload.localTimestamp,
        allowResume: payload.allowResume,
      });
    }

    client.on(ROOM_EVENTS.PlayerEvent, handleVideoSync);
    return () => { client.off(ROOM_EVENTS.PlayerEvent, handleVideoSync); };
  }, [client, isHostRef, memberLocalPauseRef, shouldIgnoreIncomingVideoSync, webviewRef]);

  // --- Room playback state sync on join ---

  useEffect(() => {
    if (!room || isHost || !videoDetected || !webviewReady) return;
    if (memberLocalPauseRef.current && !room.playback.paused) return;
    const wv = webviewRef.current;
    if (!wv) return;

    const playback = room.playback;
    if (shouldIgnoreIncomingVideoSync({ syncId: playback.syncId, localTimestamp: playback.updatedAt / 1000 })) return;

    // Update authoritative state
    authoritativePlaybackPausedRef.current = playback.paused;
    markAuthoritativeSyncEvent(playback.paused);

    const timer = window.setTimeout(() => {
      lastSyncCommandAtRef.current = Date.now();
      wv.send("yiqikan:video-sync", {
        currentTime: playback.currentTime,
        paused: playback.paused,
        playbackRate: playback.playbackRate,
        syncId: playback.syncId,
        localTimestamp: playback.updatedAt / 1000,
        allowResume: !playback.paused,
      });
    }, 200);

    return () => window.clearTimeout(timer);
  }, [
    isHost, memberLocalPauseRef, room?.id,
    room?.playback.currentTime, room?.playback.paused, room?.playback.playbackRate,
    room?.playback.syncId, room?.playback.updatedAt,
    shouldIgnoreIncomingVideoSync, videoDetected, webviewReady, webviewRef, room,
  ]);

  // --- Playback sync request/response ---

  const clearMemberResumeRequest = useCallback(() => {
    if (memberResumeRequestRef.current.timeoutId) window.clearTimeout(memberResumeRequestRef.current.timeoutId);
    memberResumeRequestRef.current = { pending: false, requestedAt: 0, timeoutId: null };
  }, []);

  const scheduleMemberResumeRequestTimeout = useCallback(() => {
    if (memberResumeRequestRef.current.timeoutId) window.clearTimeout(memberResumeRequestRef.current.timeoutId);
    memberResumeRequestRef.current.timeoutId = window.setTimeout(() => {
      memberResumeRequestRef.current.timeoutId = null;
      memberResumeRequestRef.current.pending = false;
    }, MEMBER_RESUME_REQUEST_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    function handlePlaybackSyncRequest(payload: PlaybackSyncRequestPayload) {
      if (!isHostRef.current) return;
      const activeRoom = roomRef.current;
      if (!activeRoom || activeRoom.id !== payload.roomId) return;

      const liveStatus = videoStatusRef.current;
      const fallbackPlayback = activeRoom.playback;
      const paused = liveStatus?.found ? !!liveStatus.paused : fallbackPlayback.paused;
      const playbackRate = liveStatus?.found ? (liveStatus.playbackRate ?? fallbackPlayback.playbackRate) : fallbackPlayback.playbackRate;
      const currentTime = liveStatus?.found ? (liveStatus.currentTime ?? fallbackPlayback.currentTime) : fallbackPlayback.currentTime;
      const duration = liveStatus?.found ? (liveStatus.duration ?? fallbackPlayback.duration) : fallbackPlayback.duration;
      const localTimestamp = liveStatus?.found && typeof liveStatus.localTimestamp === "number" && liveStatus.localTimestamp > 0
        ? liveStatus.localTimestamp
        : Date.now() / 1000;

      client.emit(ROOM_EVENTS.PlaybackSyncResponse, {
        roomId: payload.roomId,
        requesterId: payload.requesterId,
        currentTime,
        playbackRate,
        paused,
        duration,
        syncId: Math.max(hostVideoSyncIdRef.current, fallbackPlayback.syncId),
        localTimestamp,
        allowResume: !paused,
      } satisfies PlaybackSyncResponsePayload);
    }

    function handlePlaybackSyncResponse(payload: PlaybackSyncResponsePayload) {
      if (isHostRef.current) return;
      if (payload.requesterId !== currentUserId) return;
      const activeRoom = roomRef.current;
      const wv = webviewRef.current;
      if (!activeRoom || activeRoom.id !== payload.roomId || !wv) return;

      clearMemberResumeRequest();
      if (shouldIgnoreIncomingVideoSync({ syncId: payload.syncId, localTimestamp: payload.localTimestamp })) return;

      authoritativePlaybackPausedRef.current = payload.paused;
      markAuthoritativeSyncEvent(payload.paused);
      if (payload.paused || payload.allowResume) markMemberSyncIntent(payload.paused);

      lastSyncCommandAtRef.current = Date.now();
      wv.send("yiqikan:video-sync", {
        currentTime: payload.currentTime,
        paused: payload.paused,
        playbackRate: payload.playbackRate,
        syncId: payload.syncId,
        localTimestamp: payload.localTimestamp,
        allowResume: payload.allowResume,
      });

      if (payload.paused) {
        showToast("房主当前已暂停，已同步到房主状态");
        sendChatMessage(`${name || "成员"} 尝试恢复跟播，但房主当前已暂停`, "system");
        return;
      }
      sendChatMessage(`${name || "成员"} 恢复了跟播`, "system");
    }

    client.on(ROOM_EVENTS.PlaybackSyncRequest, handlePlaybackSyncRequest);
    client.on(ROOM_EVENTS.PlaybackSyncResponse, handlePlaybackSyncResponse);
    return () => {
      client.off(ROOM_EVENTS.PlaybackSyncRequest, handlePlaybackSyncRequest);
      client.off(ROOM_EVENTS.PlaybackSyncResponse, handlePlaybackSyncResponse);
    };
  }, [
    clearMemberResumeRequest, client, currentUserId, isHostRef,
    name, roomRef, sendChatMessage, shouldIgnoreIncomingVideoSync, showToast, webviewRef,
  ]);

  const requestMemberResumeInner = useCallback(() => {
    if (isHost) return;
    const activeRoom = roomRef.current;
    if (!activeRoom || !currentUserId) return;

    const now = Date.now();
    if (memberResumeRequestRef.current.pending && now - memberResumeRequestRef.current.requestedAt < MEMBER_RESUME_REQUEST_DEDUPE_MS) return;

    memberResumeRequestRef.current.pending = true;
    memberResumeRequestRef.current.requestedAt = now;
    scheduleMemberResumeRequestTimeout();
    setMemberLocalPause(false);

    client.emit(ROOM_EVENTS.PlaybackSyncRequest, {
      roomId: activeRoom.id,
      requesterId: currentUserId,
    } satisfies PlaybackSyncRequestPayload);
  }, [client, currentUserId, isHost, roomRef, scheduleMemberResumeRequestTimeout, setMemberLocalPause]);

  useEffect(() => {
    requestMemberResumeInnerRef.current = requestMemberResumeInner;
  }, [requestMemberResumeInner]);

  const requestMemberResume = useCallback(() => {
    requestMemberResumeInner();
  }, [requestMemberResumeInner]);

  // --- Playback controls ---

  const togglePlayPause = useCallback(() => {
    if (!videoStatus?.found) return;
    const wantPause = !videoStatus.paused;

    if (isHost) {
      const wv = webviewRef.current;
      if (!wv) return;

      const now = Date.now();
      const syncMeta = createVideoSyncMeta(now / 1000);
      const command = {
        currentTime: videoStatus.currentTime,
        paused: wantPause,
        playbackRate: videoStatus.playbackRate,
        syncId: syncMeta.syncId,
        localTimestamp: syncMeta.localTimestamp,
        allowResume: !wantPause,
      };

      lastSyncCommandAtRef.current = now;
      wv.send("yiqikan:video-sync", command);

      if (!room) return;

      lastBroadcastRef.current = {
        ct: videoStatus.currentTime ?? 0,
        paused: wantPause,
        rate: videoStatus.playbackRate ?? 1,
        ts: now,
      };

      client.emit(ROOM_EVENTS.PlayerEvent, {
        roomId: room.id,
        actorId: currentUserId,
        action: "video_sync",
        currentTime: videoStatus.currentTime,
        paused: wantPause,
        playbackRate: videoStatus.playbackRate,
        duration: videoStatus.duration,
        syncId: syncMeta.syncId,
        localTimestamp: syncMeta.localTimestamp,
        allowResume: !wantPause,
      } satisfies PlayerEventPayload);
      return;
    }

    if (!room) return;
    const wv = webviewRef.current;
    if (!wv) return;

    if (wantPause) {
      lastSyncCommandAtRef.current = Date.now();
      wv.send("yiqikan:video-sync", {
        currentTime: videoStatus.currentTime,
        paused: true,
        playbackRate: videoStatus.playbackRate,
        localTimestamp: Date.now() / 1000,
        allowResume: false,
      });
      setMemberLocalPause(true);
      sendChatMessage(`${name || "成员"} 暂停了视频`, "system");
      return;
    }

    requestMemberResume();
  }, [client, createVideoSyncMeta, currentUserId, isHost, requestMemberResume, room, sendChatMessage, setMemberLocalPause, videoStatus, webviewRef]);

  const seekTo = useCallback((time: number) => {
    if (!isHost || !videoStatus?.found) return;
    const wv = webviewRef.current;
    if (!wv) return;

    const now = Date.now();
    const syncMeta = createVideoSyncMeta(now / 1000);
    const command = {
      currentTime: time,
      paused: videoStatus.paused,
      playbackRate: videoStatus.playbackRate,
      syncId: syncMeta.syncId,
      localTimestamp: syncMeta.localTimestamp,
      allowResume: false,
    };

    lastSyncCommandAtRef.current = now;
    wv.send("yiqikan:video-sync", command);

    if (!room) return;

    lastBroadcastRef.current = {
      ct: time,
      paused: !!videoStatus.paused,
      rate: videoStatus.playbackRate ?? 1,
      ts: now,
    };

    client.emit(ROOM_EVENTS.PlayerEvent, {
      roomId: room.id,
      actorId: currentUserId,
      action: "video_sync",
      currentTime: time,
      paused: videoStatus.paused,
      playbackRate: videoStatus.playbackRate,
      duration: videoStatus.duration,
      syncId: syncMeta.syncId,
      localTimestamp: syncMeta.localTimestamp,
      allowResume: false,
    } satisfies PlayerEventPayload);
  }, [client, createVideoSyncMeta, currentUserId, isHost, room, videoStatus, webviewRef]);

  return {
    videoDetected,
    videoSignalLost,
    videoStatus,
    videoStatusRef,
    setVideoDetected,
    setVideoStatus,
    resetVideoState,
    togglePlayPause,
    requestMemberResume,
    seekTo,
  };
}
