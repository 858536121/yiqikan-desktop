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
  }, [activeUrl, isHost, room?.id, setMemberLocalPause]);

  useEffect(() => {
    latestAppliedVideoSyncRef.current = {
      syncId: 0,
      localTimestamp: 0,
    };
  }, [room?.id]);

  useEffect(() => {
    hostVideoSyncIdRef.current = Math.max(hostVideoSyncIdRef.current, room?.playback.syncId ?? 0);
  }, [room?.playback.syncId]);

  useEffect(() => {
    resetVideoState();
  }, [activeUrl, resetVideoState]);

  useEffect(() => {
    return () => {
      if (clearVideoStatusTimerRef.current) {
        window.clearTimeout(clearVideoStatusTimerRef.current);
      }
      if (memberResumeRequestRef.current.timeoutId) {
        window.clearTimeout(memberResumeRequestRef.current.timeoutId);
      }
    };
  }, []);

  const createVideoSyncMeta = useCallback((localTimestamp = Date.now() / 1000) => {
    hostVideoSyncIdRef.current += 1;
    return {
      syncId: hostVideoSyncIdRef.current,
      localTimestamp,
    };
  }, []);

  const shouldIgnoreIncomingVideoSync = useCallback((payload: Pick<PlayerEventPayload, "syncId" | "localTimestamp">) => {
    const nextSyncId = payload.syncId ?? 0;
    const nextTimestamp = payload.localTimestamp ?? 0;
    const last = latestAppliedVideoSyncRef.current;

    if (nextSyncId > 0 && nextSyncId < last.syncId) {
      return true;
    }
    if (nextSyncId === last.syncId && nextTimestamp > 0 && nextTimestamp <= last.localTimestamp) {
      return true;
    }
    if (nextSyncId === 0 && last.syncId > 0 && nextTimestamp > 0 && nextTimestamp <= last.localTimestamp) {
      return true;
    }

    latestAppliedVideoSyncRef.current = {
      syncId: Math.max(last.syncId, nextSyncId),
      localTimestamp: Math.max(last.localTimestamp, nextTimestamp),
    };
    return false;
  }, []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;

    function handleIpcMessage(event: any) {
      if (event.channel !== "yiqikan:video-status" && event.channel !== "yiqikan:video-status-from-subframe") {
        return;
      }

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
          const elapsedSeconds =
            !last.paused && last.ts > 0
              ? ((now - last.ts) / 1000) * (last.rate || 1)
              : 0;
          const expectedCurrentTime =
            last.ct >= 0 ? last.ct + elapsedSeconds : (nextStatus.currentTime ?? 0);
          const timeDrift = Math.abs((nextStatus.currentTime ?? 0) - expectedCurrentTime);

          const isUserAction = pauseChanged || rateChanged;
          const isSignificantDrift = timeDrift > 1.25;
          const interval = nextStatus.paused ? 10000 : 5000;
          const heartbeatDue = now - last.ts > interval;
          const shouldSend = isUserAction || isSignificantDrift || heartbeatDue;

          if (shouldSend) {
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

      if (clearVideoStatusTimerRef.current) {
        window.clearTimeout(clearVideoStatusTimerRef.current);
      }

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
    }

    wv.addEventListener("ipc-message", handleIpcMessage);
    return () => wv.removeEventListener("ipc-message", handleIpcMessage);
  }, [client, createVideoSyncMeta, currentUserId, isHostRef, roomRef, webviewReady, webviewRef]);

  useEffect(() => {
    function handleVideoSync(payload: PlayerEventPayload) {
      if (payload.action !== "video_sync") return;
      if (isHostRef.current) return;
      // 本地暂停时，只允许房主的暂停指令通过（同步暂停状态），播放指令忽略
      if (memberLocalPauseRef.current && !payload.paused) return;
      if (shouldIgnoreIncomingVideoSync(payload)) return;

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
    return () => {
      client.off(ROOM_EVENTS.PlayerEvent, handleVideoSync);
    };
  }, [client, isHostRef, memberLocalPauseRef, shouldIgnoreIncomingVideoSync, webviewRef]);

  useEffect(() => {
    if (!room || isHost || !videoDetected || !webviewReady) return;
    // 本地暂停时，只允许房主暂停状态同步，播放状态忽略
    if (memberLocalPauseRef.current && !room.playback.paused) return;
    const wv = webviewRef.current;
    if (!wv) return;

    const playback = room.playback;
    if (shouldIgnoreIncomingVideoSync({
      syncId: playback.syncId,
      localTimestamp: playback.updatedAt / 1000,
    })) {
      return;
    }

    const timer = window.setTimeout(() => {
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
  }, [isHost, memberLocalPauseRef, room?.id, room?.playback.currentTime, room?.playback.paused, room?.playback.playbackRate, room?.playback.syncId, room?.playback.updatedAt, shouldIgnoreIncomingVideoSync, videoDetected, webviewReady, webviewRef, room]);

  const clearMemberResumeRequest = useCallback(() => {
    if (memberResumeRequestRef.current.timeoutId) {
      window.clearTimeout(memberResumeRequestRef.current.timeoutId);
    }
    memberResumeRequestRef.current = {
      pending: false,
      requestedAt: 0,
      timeoutId: null,
    };
  }, []);

  const scheduleMemberResumeRequestTimeout = useCallback(() => {
    if (memberResumeRequestRef.current.timeoutId) {
      window.clearTimeout(memberResumeRequestRef.current.timeoutId);
    }
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
      const localTimestamp =
        liveStatus?.found && typeof liveStatus.localTimestamp === "number" && liveStatus.localTimestamp > 0
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

      if (shouldIgnoreIncomingVideoSync({
        syncId: payload.syncId,
        localTimestamp: payload.localTimestamp,
      })) {
        return;
      }

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
    clearMemberResumeRequest,
    client,
    currentUserId,
    isHostRef,
    name,
    roomRef,
    sendChatMessage,
    shouldIgnoreIncomingVideoSync,
    showToast,
    webviewRef,
  ]);

  const requestMemberResume = useCallback(() => {
    if (isHost) return;
    const activeRoom = roomRef.current;
    if (!activeRoom || !currentUserId) return;

    const now = Date.now();
    if (memberResumeRequestRef.current.pending && now - memberResumeRequestRef.current.requestedAt < MEMBER_RESUME_REQUEST_DEDUPE_MS) {
      return;
    }

    memberResumeRequestRef.current.pending = true;
    memberResumeRequestRef.current.requestedAt = now;
    scheduleMemberResumeRequestTimeout();
    setMemberLocalPause(false);

    client.emit(ROOM_EVENTS.PlaybackSyncRequest, {
      roomId: activeRoom.id,
      requesterId: currentUserId,
    } satisfies PlaybackSyncRequestPayload);
  }, [client, currentUserId, isHost, roomRef, scheduleMemberResumeRequestTimeout, setMemberLocalPause]);

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
