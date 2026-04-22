import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import {
  type DesktopRuntimeContext,
  type RoomState,
  YIQIKAN_PROTOCOL_VERSION,
} from "@yiqikan/shared";
import { BrowserPane } from "./components/app/browser-pane";
import { RightSidebar } from "./components/app/right-sidebar";
import { useChatDanmaku } from "./hooks/use-chat-danmaku";
import { useRoomActions } from "./hooks/use-room-actions";
import { useWebviewNavigation } from "./hooks/use-webview-navigation";
import { useRoomSocket } from "./hooks/use-room-socket";
import { useVideoSync } from "./hooks/use-video-sync";
import { useAudioBoost } from "./hooks/use-audio-boost";
import { useCollapsedToggleDrag } from "./hooks/use-collapsed-toggle-drag";
import type { AppUpdateState, AppUpdateStatus } from "../../shared/app-update";
import { desktopServerUrlFallback } from "../../shared/server-url";
import type { SyncWebviewElement } from "./types/sync";

const CLIENT_SESSION_STORAGE_KEY = "yiqikan:clientSessionId";

/* ------------------------------------------------------------------ */
/*  Socket singleton                                                   */
/* ------------------------------------------------------------------ */

let socket: Socket | null = null;
const rendererServerUrlFallback =
  import.meta.env.VITE_YIQIKAN_SERVER_URL?.trim() || desktopServerUrlFallback;
const desktopBridge = (window as any).yiqikan ?? {
  appName: "异起看",
  serverUrl: rendererServerUrlFallback,
  runtimeContext: {
    client: {
      appName: "异起看",
      appVersion: "0.0.0",
      protocolVersion: YIQIKAN_PROTOCOL_VERSION,
      platform: "desktop",
      releaseChannel: "stable",
    },
    updates: {
      enabled: false,
      checkOnLaunch: false,
      allowPrerelease: false,
      feedUrl: null,
    },
    remoteConfig: {
      enabled: false,
      url: null,
      refreshIntervalMs: 300000,
    },
  } satisfies DesktopRuntimeContext,
  getWebviewPreloadPath: () => Promise.resolve(""),
  getWebviewMediaSourceId: () => Promise.resolve(null),
  getHtmlFullScreenState: () => Promise.resolve(false),
  exitHtmlFullScreen: () => Promise.resolve(false),
  getAppUpdateState: () =>
    Promise.resolve({
      enabled: false,
      status: "disabled" as const,
      currentVersion: "0.0.0",
      availableVersion: null,
      downloadedVersion: null,
      feedUrl: null,
      message: null,
      error: null,
      progressPercent: null,
      checkedAt: null,
    }),
  checkForAppUpdates: () =>
    Promise.resolve({
      enabled: false,
      status: "disabled" as const,
      currentVersion: "0.0.0",
      availableVersion: null,
      downloadedVersion: null,
      feedUrl: null,
      message: null,
      error: null,
      progressPercent: null,
      checkedAt: null,
    }),
  quitAndInstallAppUpdate: () => Promise.resolve(false),
  clearBrowsingData: () => Promise.resolve(),
  onAppUpdateState: () => () => {},
  onWebviewWindowOpen: () => () => {},
  onHtmlFullScreenChange: () => () => {},
};

if (!(window as any).yiqikan) {
  console.warn("[yiqikan] preload bridge missing, using renderer fallback serverUrl:", desktopBridge.serverUrl);
} else {
  console.info("[yiqikan] preload serverUrl:", desktopBridge.serverUrl);
}

function createClientSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `desktop-${crypto.randomUUID()}`;
  }
  return `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getClientSessionId() {
  const existing = localStorage.getItem(CLIENT_SESSION_STORAGE_KEY)?.trim();
  if (existing) return existing;
  const next = createClientSessionId();
  localStorage.setItem(CLIENT_SESSION_STORAGE_KEY, next);
  return next;
}

function ensureSocket(runtimeContext: DesktopRuntimeContext, sessionId: string) {
  if (!socket) {
    socket = io(desktopBridge.serverUrl, {
      transports: ["websocket"],
      auth: {
        client: runtimeContext.client,
        sessionId,
      },
    });
  }
  return socket;
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export function App() {
  const runtimeContext = desktopBridge.runtimeContext;
  const clientSessionId = useMemo(() => getClientSessionId(), []);
  const socketClient = useMemo(() => ensureSocket(runtimeContext, clientSessionId), [clientSessionId, runtimeContext]);

  /* ---- state ---- */
  const [name, setName] = useState(() => localStorage.getItem("yiqikan:name") ?? "");
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem("yiqikan:roomCode") ?? "");
  const [password, setPassword] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [status, setStatus] = useState("等待连接服务端…");
  const [error, setError] = useState("");
  const [urlInput, setUrlInput] = useState(() => localStorage.getItem("yiqikan:lastUrl") ?? "");
  const [socketId, setSocketId] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [urlFocused, setUrlFocused] = useState(false);
  const [localVolume, setLocalVolume] = useState(100);
  const [copied, setCopied] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [roomPasswordVisible, setRoomPasswordVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [roomInfoCollapsed, setRoomInfoCollapsed] = useState(false);
  const [memberLocalPause, setMemberLocalPause] = useState(false);
  const [htmlFullScreenActive, setHtmlFullScreenActive] = useState(false);

  /* ---- refs ---- */
  const webviewRef = useRef<SyncWebviewElement | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const isHostRef = useRef(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const memberLocalPauseRef = useRef(false);
  const lastAppUpdateStatusRef = useRef<AppUpdateStatus | null>(null);

  const {
    top: collapsedToggleTop,
    left: collapsedToggleLeft,
    buttonRef: collapsedToggleButtonRef,
    dragRef: collapsedToggleDragRef,
    positionRef: collapsedTogglePositionRef,
    suppressClickRef: suppressCollapsedToggleClickRef,
  } = useCollapsedToggleDrag();

  /* ---- derived ---- */
  const currentUserId = useMemo(() => clientSessionId, [clientSessionId]);
  const isHost = useMemo(() => {
    if (!room?.hostId) return false;
    return room.hostId === currentUserId
      || room.hostId === socketId
      || room.hostId === `socket:${socketId}`;
  }, [currentUserId, room?.hostId, socketId]);

  useEffect(() => { localStorage.setItem("yiqikan:name", name); }, [name]);
  useEffect(() => { localStorage.setItem("yiqikan:roomCode", roomCode); }, [roomCode]);

  /* ---- keep refs in sync ---- */
  useEffect(() => {
    roomRef.current = room;
    isHostRef.current = isHost;
  }, [isHost, room]);

  useEffect(() => {
    memberLocalPauseRef.current = memberLocalPause;
  }, [memberLocalPause]);

  useEffect(() => {
    desktopBridge.getHtmlFullScreenState().then(setHtmlFullScreenActive).catch(() => {});
    return desktopBridge.onHtmlFullScreenChange(({ active }: { active: boolean }) => {
      setHtmlFullScreenActive(active);
      setCollapsed(active ? true : false);
    });
  }, []);

  useEffect(() => {
    if (collapsed || !htmlFullScreenActive) return;
    desktopBridge.exitHtmlFullScreen().catch(() => {});
  }, [collapsed, htmlFullScreenActive]);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    if (!runtimeContext.updates.enabled) return;

    const handleUpdateState = (nextState: AppUpdateState) => {
      if (lastAppUpdateStatusRef.current === nextState.status) return;
      lastAppUpdateStatusRef.current = nextState.status;

      if (
        (nextState.status === "available" || nextState.status === "downloaded") &&
        nextState.message
      ) {
        showToast(nextState.message);
      }
    };

    desktopBridge.getAppUpdateState().then(handleUpdateState).catch(() => {});
    return desktopBridge.onAppUpdateState(handleUpdateState);
  }, [runtimeContext.updates.enabled]);

  const {
    activeDanmaku,
    chatDraft,
    chatScrollRef,
    danmakuEnabled,
    handleIncomingChatMessage,
    hasUnreadChat,
    sendChatMessage,
    setChatDraft,
    setDanmakuEnabled,
    submitChatMessage,
  } = useChatDanmaku({
    client: socketClient,
    room,
    roomRef,
    currentUserId,
    collapsed,
    name,
  });

  const {
    activeUrl,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    loading,
    navigateUrl,
    normalizeUrl,
    pageTitle,
    preRoomUrl,
    reloadPage,
    webviewPreloadPath,
    webviewReady,
  } = useWebviewNavigation({
    client: socketClient,
    desktopBridge,
    room,
    roomRef,
    currentUserId,
    isHost,
    isHostRef,
    webviewRef,
    urlInput,
    setUrlInput,
    showToast,
  });

  const {
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
  } = useVideoSync({
    client: socketClient,
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
  });

  useAudioBoost({ webviewRef, webviewReady, videoDetected, localVolume, desktopBridge });

  /* ================================================================ */
  /*  Socket listeners                                                 */
  /* ================================================================ */

  useRoomSocket({
    client: socketClient,
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
    onChatMessage: handleIncomingChatMessage,
  });

  /* ---- notify webview of host mode changes ---- */
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    wv.send("yiqikan:set-host-mode", !room || isHost);
    wv.send("yiqikan:set-member-local-pause", memberLocalPause);
  }, [isHost, room, webviewReady, memberLocalPause]);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    wv.send("yiqikan:set-authoritative-playback-state", {
      paused: room?.playback.paused ?? null,
    });
  }, [room?.playback.paused, room?.playback.syncId, webviewReady]);

  /* ---- listen for member blocked action from webview ---- */
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    function handleIpc(event: any) {
      if (event.channel === "yiqikan:member-resume-request") {
        requestMemberResume();
        return;
      }
      if (event.channel === "yiqikan:member-blocked-action") {
        showToast("请使用右侧视频按钮暂停或继续跟播");
        return;
      }
      if (event.channel === "yiqikan:member-local-pause-change") {
        const payload = event.args?.[0] as { paused?: boolean } | undefined;
        setMemberLocalPause(Boolean(payload?.paused));
        return;
      }
    }
    wv.addEventListener("ipc-message", handleIpc);
    return () => wv.removeEventListener("ipc-message", handleIpc);
  }, [requestMemberResume, webviewReady]);

  const {
    createRoom,
    joinRoom,
    leaveRoom,
    closeRoom,
    saveRoomPassword,
  } = useRoomActions({
    client: socketClient,
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
  });

  const copyRoomCode = useCallback(() => {
    if (!room) return;
    navigator.clipboard.writeText(room.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [room]);

  function requestFullscreen() {
    // Collapse sidebar first, then fullscreen the webview
    setCollapsed(true);
    setTimeout(() => {
      const wv = webviewRef.current;
      if (!wv) return;
      try {
        (wv as any).requestFullscreen?.().catch(() => {});
      } catch { /* fallback not needed */ }
    }, 100);
  }

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  // Navigation is allowed for host in room, or when no room (free browsing)
  const canNavigate = (room && isHost) || !room;
  const showNoVideoHint = Boolean(room && activeUrl && webviewReady && !loading && !videoDetected && !videoSignalLost);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-4 py-2 rounded-full bg-black/70 backdrop-blur-md text-white text-sm font-medium shadow-lg pointer-events-none animate-fade-in-out">
          {toast}
        </div>
      )}
      <BrowserPane
        room={room}
        isHost={isHost}
        collapsed={collapsed}
        hasUnreadChat={hasUnreadChat}
        collapsedToggleTop={collapsedToggleTop}
        collapsedToggleLeft={collapsedToggleLeft}
        collapsedToggleButtonRef={collapsedToggleButtonRef}
        collapsedToggleDragRef={collapsedToggleDragRef}
        collapsedTogglePositionRef={collapsedTogglePositionRef}
        suppressCollapsedToggleClickRef={suppressCollapsedToggleClickRef}
        setCollapsed={setCollapsed}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        webviewReady={webviewReady}
        activeUrl={activeUrl}
        loading={loading}
        urlInput={urlInput}
        urlFocused={urlFocused}
        canNavigate={canNavigate}
        videoDetected={videoDetected}
        danmakuMessages={activeDanmaku}
        webviewPreloadPath={webviewPreloadPath}
        urlInputRef={urlInputRef}
        webviewRef={webviewRef}
        setUrlInput={setUrlInput}
        setUrlFocused={setUrlFocused}
        showToast={showToast}
        goBack={goBack}
        goForward={goForward}
        reloadPage={reloadPage}
        navigateUrl={navigateUrl}
        onClearBrowsingData={async () => {
          await desktopBridge.clearBrowsingData();
          showToast("缓存已清除");
        }}
      />

      {!collapsed && (
        <RightSidebar
          status={status}
          socketId={socketId}
          room={room}
          error={error}
          name={name}
          roomCode={roomCode}
          password={password}
          roomPasswordVisible={roomPasswordVisible}
          copied={copied}
          editingPassword={editingPassword}
          roomInfoCollapsed={roomInfoCollapsed}
          currentUserId={currentUserId}
          pageTitle={pageTitle}
          memberLocalPause={memberLocalPause}
          showNoVideoHint={showNoVideoHint}
          videoDetected={videoDetected}
          videoStatus={videoStatus}
          videoSignalLost={videoSignalLost}
          isHost={isHost}
          localVolume={localVolume}
          chatDraft={chatDraft}
          danmakuEnabled={danmakuEnabled}
          chatScrollRef={chatScrollRef}
          onCollapse={() => setCollapsed(true)}
          onNameChange={setName}
          onRoomCodeChange={setRoomCode}
          onPasswordChange={setPassword}
          onToggleRoomPasswordVisibility={() => setRoomPasswordVisible((value) => !value)}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onCloseRoom={isHost ? closeRoom : leaveRoom}
          onCopyRoomCode={copyRoomCode}
          onToggleRoomInfoCollapsed={() => setRoomInfoCollapsed((value) => !value)}
          onStartEditingPassword={() => {
            setEditingPassword(true);
            setRoomPasswordVisible(true);
          }}
          onSaveRoomPassword={saveRoomPassword}
          onTogglePlayPause={togglePlayPause}
          onSeekTo={seekTo}
          onRequestFullscreen={requestFullscreen}
          setLocalVolume={setLocalVolume}
          onChatDraftChange={setChatDraft}
          onToggleDanmaku={() => setDanmakuEnabled((value) => !value)}
          onSubmitChatMessage={submitChatMessage}
        />
      )}
    </div>
  );
}
