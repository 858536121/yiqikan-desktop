import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { ROOM_EVENTS, type ChatMessage, type ChatMessagePayload, type RoomState } from "@yiqikan/shared";
import type { Socket } from "socket.io-client";

const DANMAKU_LANE_COUNT = 6;
const DANMAKU_BASE_TOP_PERCENT = 16;
const DANMAKU_LANE_GAP_PERCENT = 8;

interface DanmakuItem {
  id: string;
  actorName: string;
  message: string;
  topPercent: number;
  durationMs: number;
}

interface UseChatDanmakuOptions {
  client: Socket;
  room: RoomState | null;
  roomRef: MutableRefObject<RoomState | null>;
  currentUserId: string;
  collapsed: boolean;
  name: string;
}

export function useChatDanmaku({
  client,
  room,
  roomRef,
  currentUserId,
  collapsed,
  name,
}: UseChatDanmakuOptions) {
  const [chatDraft, setChatDraft] = useState("");
  const [danmakuEnabled, setDanmakuEnabled] = useState(() => localStorage.getItem("yiqikan:danmakuEnabled") !== "0");
  const [ttsEnabled, setTtsEnabled] = useState(() => localStorage.getItem("yiqikan:ttsEnabled") !== "0");
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [activeDanmaku, setActiveDanmaku] = useState<DanmakuItem[]>([]);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const danmakuLaneRef = useRef(0);
  const danmakuTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const optimisticDanmakuMessagesRef = useRef<Array<{ message: string; createdAt: number }>>([]);

  useEffect(() => {
    localStorage.setItem("yiqikan:danmakuEnabled", danmakuEnabled ? "1" : "0");
  }, [danmakuEnabled]);

  useEffect(() => {
    localStorage.setItem("yiqikan:ttsEnabled", ttsEnabled ? "1" : "0");
  }, [ttsEnabled]);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [room?.chatMessages.length]);

  useEffect(() => {
    if (!collapsed) {
      setHasUnreadChat(false);
    }
  }, [collapsed]);

  const clearDanmaku = useCallback(() => {
    danmakuTimersRef.current.forEach((timer) => clearTimeout(timer));
    danmakuTimersRef.current.clear();
    optimisticDanmakuMessagesRef.current = [];
    danmakuLaneRef.current = 0;
    setActiveDanmaku([]);
  }, []);

  useEffect(() => {
    return () => {
      danmakuTimersRef.current.forEach((timer) => clearTimeout(timer));
      danmakuTimersRef.current.clear();
      optimisticDanmakuMessagesRef.current = [];
    };
  }, []);

  useEffect(() => {
    setHasUnreadChat(false);
    clearDanmaku();
  }, [clearDanmaku, room?.id]);

  useEffect(() => {
    if (danmakuEnabled) return;
    clearDanmaku();
  }, [clearDanmaku, danmakuEnabled]);

  const enqueueDanmaku = useCallback((entry: Pick<DanmakuItem, "id" | "actorName" | "message">) => {
    const nextItem: DanmakuItem = {
      ...entry,
      topPercent: DANMAKU_BASE_TOP_PERCENT + ((danmakuLaneRef.current % DANMAKU_LANE_COUNT) * DANMAKU_LANE_GAP_PERCENT),
      durationMs: 7600 + Math.min(entry.message.length * 80, 2200),
    };

    danmakuLaneRef.current += 1;
    setActiveDanmaku((current) => [...current.filter((item) => item.id !== nextItem.id), nextItem].slice(-12));

    const existingTimer = danmakuTimersRef.current.get(nextItem.id);
    if (existingTimer) clearTimeout(existingTimer);

    const timeout = setTimeout(() => {
      setActiveDanmaku((current) => current.filter((item) => item.id !== nextItem.id));
      danmakuTimersRef.current.delete(nextItem.id);
    }, nextItem.durationMs + 600);

    danmakuTimersRef.current.set(nextItem.id, timeout);
  }, []);

  const consumeOptimisticDanmaku = useCallback((messageText: string) => {
    const now = Date.now();
    const queue = optimisticDanmakuMessagesRef.current.filter((item) => now - item.createdAt < 3000);
    const matchIndex = queue.findIndex((item) => item.message === messageText);
    if (matchIndex < 0) {
      optimisticDanmakuMessagesRef.current = queue;
      return false;
    }

    queue.splice(matchIndex, 1);
    optimisticDanmakuMessagesRef.current = queue;
    return true;
  }, []);

  const handleIncomingChatMessage = useCallback((message: ChatMessage) => {
    if (message.kind !== "text") return;

    if (message.actorId !== currentUserId && collapsed) {
      setHasUnreadChat(true);
    }

    if (ttsEnabled && "speechSynthesis" in window) {
      const text = message.actorId === currentUserId
        ? message.message
        : `${message.actorName}说：${message.message}`;
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = "zh-CN";
      utt.rate = 1.1;
      window.speechSynthesis.cancel(); // cancel any ongoing speech first
      window.speechSynthesis.speak(utt);
    }

    if (!danmakuEnabled) return;
    if (message.actorId === currentUserId && consumeOptimisticDanmaku(message.message)) return;

    enqueueDanmaku({
      id: message.id,
      actorName: message.actorName,
      message: message.message,
    });
  }, [collapsed, consumeOptimisticDanmaku, currentUserId, danmakuEnabled, enqueueDanmaku, ttsEnabled]);

  const sendChatMessage = useCallback((message: string, kind: "text" | "system" = "text") => {
    const activeRoom = roomRef.current;
    if (!activeRoom) return;
    const trimmed = message.trim();
    if (!trimmed) return;

    client.emit(ROOM_EVENTS.ChatMessage, {
      roomId: activeRoom.id,
      message: trimmed,
      kind,
    } satisfies ChatMessagePayload);
  }, [client, roomRef]);

  const submitChatMessage = useCallback(() => {
    const trimmed = chatDraft.trim();
    if (!trimmed) return;

    if (danmakuEnabled) {
      optimisticDanmakuMessagesRef.current = [
        ...optimisticDanmakuMessagesRef.current.filter((item) => Date.now() - item.createdAt < 3000),
        { message: trimmed, createdAt: Date.now() },
      ];

      enqueueDanmaku({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        actorName: name || "你",
        message: trimmed,
      });
    }

    sendChatMessage(trimmed, "text");
    setChatDraft("");
  }, [chatDraft, danmakuEnabled, enqueueDanmaku, name, sendChatMessage]);

  return {
    activeDanmaku,
    chatDraft,
    chatScrollRef,
    danmakuEnabled,
    handleIncomingChatMessage,
    hasUnreadChat,
    sendChatMessage,
    setChatDraft,
    setDanmakuEnabled,
    setTtsEnabled,
    submitChatMessage,
    ttsEnabled,
  };
}
