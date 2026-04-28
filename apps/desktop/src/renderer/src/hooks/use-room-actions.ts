import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  ROOM_EVENTS,
  normalizeRoomIdInput,
  type RoomState,
  type UpdateRoomPasswordPayload,
} from "@yiqikan/shared";
import type { Socket } from "socket.io-client";
import type { SyncWebviewElement, VideoStatus } from "../types/sync";

interface UseRoomActionsOptions {
  client: Socket;
  room: RoomState | null;
  isHost: boolean;
  roomCode: string;
  name: string;
  password: string;
  pageTitle: string;
  preRoomUrl: string;
  urlInput: string;
  webviewRef: MutableRefObject<SyncWebviewElement | null>;
  videoStatusRef: MutableRefObject<VideoStatus | null>;
  normalizeUrl: (value: string) => string;
  resetVideoState: () => void;
  showToast: (message: string) => void;
  setRoom: Dispatch<SetStateAction<RoomState | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setMemberLocalPause: (paused: boolean) => void;
  setEditingPassword: Dispatch<SetStateAction<boolean>>;
  setRoomPasswordVisible: Dispatch<SetStateAction<boolean>>;
}

export function useRoomActions({
  client,
  room,
  isHost,
  roomCode,
  name,
  password,
  pageTitle,
  preRoomUrl,
  urlInput,
  webviewRef,
  videoStatusRef,
  normalizeUrl,
  resetVideoState,
  showToast,
  setRoom,
  setStatus,
  setError,
  setMemberLocalPause,
  setEditingPassword,
  setRoomPasswordVisible,
}: UseRoomActionsOptions) {
  const createRoom = useCallback(() => {
    const initialPlayback = (() => {
      const fallbackUrl = normalizeUrl(preRoomUrl || urlInput);
      const currentUrl = (() => {
        try {
          const nextUrl = webviewRef.current?.getURL();
          return nextUrl && nextUrl !== "about:blank" ? nextUrl : null;
        } catch {
          return null;
        }
      })();
      const nextUrl = currentUrl || fallbackUrl || null;
      if (!nextUrl) return undefined;

      const nextTitle = (() => {
        try {
          return webviewRef.current?.getTitle() || null;
        } catch {
          return null;
        }
      })();
      const currentVideoStatus = videoStatusRef.current;

      return {
        url: nextUrl,
        pageTitle: nextTitle || pageTitle || nextUrl,
        paused: currentVideoStatus?.paused ?? true,
        currentTime: currentVideoStatus?.currentTime ?? 0,
        playbackRate: currentVideoStatus?.playbackRate ?? 1,
        duration: currentVideoStatus?.duration ?? null,
        syncId: 0,
      };
    })();

    client.emit(ROOM_EVENTS.CreateRoom, {
      roomId: normalizeRoomIdInput(roomCode) || undefined,
      userName: name,
      password: password.trim() || undefined,
      initialPlayback,
    });
  }, [client, name, normalizeUrl, pageTitle, password, preRoomUrl, roomCode, urlInput, videoStatusRef, webviewRef]);

  const joinRoom = useCallback(() => {
    client.emit(ROOM_EVENTS.JoinRoom, {
      roomId: normalizeRoomIdInput(roomCode),
      userName: name,
      password: password.trim() || undefined,
    });
  }, [client, name, password, roomCode]);

  const leaveRoom = useCallback(() => {
    if (!room || isHost) return;
    client.emit(ROOM_EVENTS.LeaveRoom, { roomId: room.id });
    setRoom(null);
    setStatus("已退出房间");
    setError("");
    setMemberLocalPause(false);
    resetVideoState();
  }, [client, isHost, resetVideoState, room, setError, setMemberLocalPause, setRoom, setStatus]);

  const closeRoom = useCallback(() => {
    if (!room || !isHost) return;
    client.emit(ROOM_EVENTS.CloseRoom, { roomId: room.id });
    setRoom(null);
    setStatus("已关闭房间");
    resetVideoState();
  }, [client, isHost, resetVideoState, room, setRoom, setStatus]);

  const saveRoomPassword = useCallback(() => {
    if (!room || !isHost) return;
    client.emit(ROOM_EVENTS.UpdateRoomPassword, {
      roomId: room.id,
      password: password.trim() || undefined,
    } satisfies UpdateRoomPasswordPayload);
    setEditingPassword(false);
    setRoomPasswordVisible(false);
    showToast(password.trim() ? "房间密码已更新" : "已移除房间密码");
  }, [client, isHost, password, room, setEditingPassword, setRoomPasswordVisible, showToast]);

  return {
    createRoom,
    joinRoom,
    leaveRoom,
    closeRoom,
    saveRoomPassword,
  };
}
