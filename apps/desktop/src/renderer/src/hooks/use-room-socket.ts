import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Socket } from "socket.io-client";
import {
  ROOM_EVENTS,
  type ChatMessage,
  type PlayerEventPayload,
  type RoomState,
  type RuntimeNoticePayload,
  type ServerErrorPayload,
} from "@yiqikan/shared";
import type { SyncWebviewElement, VideoStatus } from "../types/sync";

interface UseRoomSocketOptions {
  client: Socket;
  roomRef: MutableRefObject<RoomState | null>;
  webviewRef: MutableRefObject<SyncWebviewElement | null>;
  isHostRef: MutableRefObject<boolean>;
  setSocketId: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setRoom: Dispatch<SetStateAction<RoomState | null>>;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setUrlInput: Dispatch<SetStateAction<string>>;
  setVideoDetected: Dispatch<SetStateAction<boolean>>;
  setVideoStatus: Dispatch<SetStateAction<VideoStatus | null>>;
  onChatMessage?: (message: ChatMessage) => void;
  onGoHome?: () => void;
}

export function useRoomSocket({
  client,
  roomRef,
  webviewRef,
  isHostRef,
  setSocketId,
  setStatus,
  setRoom,
  setRoomCode,
  setError,
  setUrlInput,
  setVideoDetected,
  setVideoStatus,
  onChatMessage,
  onGoHome,
}: UseRoomSocketOptions) {
  useEffect(() => {
    const handleConnect = () => {
      setSocketId(client.id ?? "");
      setStatus("已连接实时服务");
    };

    const handleStateSnapshot = (nextRoom: RoomState) => {
      const isFirstJoin = !roomRef.current;
      setRoom(nextRoom);
      if (isFirstJoin) setRoomCode(nextRoom.id);
      setStatus(`已进入房间 ${nextRoom.id}`);
      setError("");
      if (nextRoom.playback.url) setUrlInput(nextRoom.playback.url);
    };

    const handleError = (payload: ServerErrorPayload) => {
      setError(payload.message);
    };

    const handleRuntimeNotice = (payload: RuntimeNoticePayload) => {
      if (payload.severity === "error") {
        setError(payload.message);
        return;
      }

      setStatus(payload.message);
    };

    const handlePlayerEvent = (payload: PlayerEventPayload) => {
      setRoom((currentRoom) => {
        if (!currentRoom || currentRoom.id !== payload.roomId) {
          return currentRoom;
        }

        if (payload.action !== "video_sync") {
          return currentRoom;
        }

        return {
          ...currentRoom,
          playback: {
            ...currentRoom.playback,
            currentTime: payload.currentTime ?? currentRoom.playback.currentTime,
            paused: payload.paused ?? currentRoom.playback.paused,
            playbackRate: payload.playbackRate ?? currentRoom.playback.playbackRate,
            duration: payload.duration ?? currentRoom.playback.duration,
            syncId: payload.syncId ?? currentRoom.playback.syncId,
            updatedAt: typeof payload.localTimestamp === "number" ? payload.localTimestamp * 1000 : Date.now(),
          },
        };
      });

      if (payload.action === "load_url" || payload.action === "navigate") {
        if (!payload.url && !isHostRef.current) {
          // Host navigated to home — members follow
          onGoHome?.();
        } else {
          setUrlInput(payload.url ?? "");
        }
      }
      if (payload.action === "reload" && !isHostRef.current) {
        webviewRef.current?.reload();
      }
    };

    const handleCloseRoom = () => {
      setRoom(null);
      setStatus("房间已关闭");
      setVideoDetected(false);
      setVideoStatus(null);
    };

    const handleChatMessage = (message: ChatMessage) => {
      onChatMessage?.(message);
      setRoom((currentRoom) => {
        if (!currentRoom || currentRoom.id !== message.roomId) {
          return currentRoom;
        }
        if (currentRoom.chatMessages.some((item) => item.id === message.id)) {
          return currentRoom;
        }
        return {
          ...currentRoom,
          chatMessages: [...currentRoom.chatMessages, message].slice(-100),
        };
      });
    };

    client.on("connect", handleConnect);
    client.on(ROOM_EVENTS.StateSnapshot, handleStateSnapshot);
    client.on(ROOM_EVENTS.Error, handleError);
    client.on(ROOM_EVENTS.RuntimeNotice, handleRuntimeNotice);
    client.on(ROOM_EVENTS.PlayerEvent, handlePlayerEvent);
    client.on(ROOM_EVENTS.CloseRoom, handleCloseRoom);
    client.on(ROOM_EVENTS.ChatMessage, handleChatMessage);

    return () => {
      client.off("connect", handleConnect);
      client.off(ROOM_EVENTS.StateSnapshot, handleStateSnapshot);
      client.off(ROOM_EVENTS.Error, handleError);
      client.off(ROOM_EVENTS.RuntimeNotice, handleRuntimeNotice);
      client.off(ROOM_EVENTS.PlayerEvent, handlePlayerEvent);
      client.off(ROOM_EVENTS.CloseRoom, handleCloseRoom);
      client.off(ROOM_EVENTS.ChatMessage, handleChatMessage);
    };
  }, [
    client,
    isHostRef,
    roomRef,
    webviewRef,
    setError,
    setRoom,
    setRoomCode,
    setSocketId,
    setStatus,
    setUrlInput,
    setVideoDetected,
    setVideoStatus,
    onChatMessage,
  ]);
}
