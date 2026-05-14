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
import type { RendererUpdateState } from "../../shared/renderer-update";
import { desktopServerUrlFallback } from "../../shared/server-url";
import type { SyncWebviewElement } from "./types/sync";
// Chinese
const CLIENT_SESSION_STORAGE_KEY = "yiqikan:clientSessionId";

/* ------------------------------------------------------------------ */
/*  Socket singleton                                                   */
/* ------------------------------------------------------------------ */

let socket: Socket | null = null;

function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
const rendererServerUrlFallback =
  import.meta.env.VITE_YIQIKAN_SERVER_URL?.trim() || desktopServerUrlFallback;
const desktopBridge = (window as any).yiqikan ?? {
  appName: "异起看",
  serverUrl: rendererServerUrlFallback,
  runtimeContext: {
    client: {
      appName: "异起看",
      appVersion: "0.0.0",
      hotVersion: null,
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
  getRendererUpdateState: () => Promise.resolve({ status: "disabled", currentVersion: null, availableVersion: null, progressPercent: null, message: null, error: null } as RendererUpdateState),
  getShellUpdateState: () => Promise.resolve({ status: "none" as const, message: null }),
  checkReleaseUpdate: () => Promise.resolve(),
  dismissShellUpdate: () => Promise.resolve(),
  onRendererUpdateState: () => () => {},
  onShellUpdateState: () => () => {},
  onDeepLink: () => () => {},
  getHotRendererVersion: () => Promise.resolve(null),
  applyRendererUpdate: () => Promise.resolve(),
};

if (!(window as any).yiqikan) {
  console.warn("[yiqikan] preload bridge missing, using renderer fallback serverUrl:", desktopBridge.serverUrl);
} else {
  console.info("[yiqikan] preload serverUrl:", desktopBridge.serverUrl);
}

const NAME_ADJECTIVES = ["快乐的", "可爱的", "帅气的", "温柔的", "勇敢的", "聪明的", "活泼的", "安静的", "开朗的", "神秘的"];
const NAME_NOUNS = ["熊猫", "柴犬", "猫咪", "兔子", "企鹅", "狐狸", "仓鼠", "小鹿", "水獭", "松鼠"];

function generateDefaultName() {
  const adj = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  return `${adj}${noun}`;
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
  const [hotVersion, setHotVersion] = useState<string | null>(null);

  useEffect(() => {
    desktopBridge.getHotRendererVersion().then(setHotVersion).catch(() => {});
  }, []);

  const runtimeContext = useMemo(() => {
    const base = desktopBridge.runtimeContext;
    return { ...base, client: { ...base.client, hotVersion: hotVersion ?? null } };
  }, [hotVersion]);

  const clientSessionId = useMemo(() => getClientSessionId(), []);
  const socketClient = useMemo(() => ensureSocket(runtimeContext, clientSessionId), [clientSessionId, runtimeContext]);

  /* ---- state ---- */
  const [name, setName] = useState(() => localStorage.getItem("yiqikan:name") || generateDefaultName());
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem("yiqikan:roomCode") ?? "");
  const [password, setPassword] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [status, setStatus] = useState("等待连接服务端…");
  const [error, setError] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [socketId, setSocketId] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [urlFocused, setUrlFocused] = useState(false);
  const [localVolume, setLocalVolume] = useState(100);
  const [copied, setCopied] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [roomPasswordVisible, setRoomPasswordVisible] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [roomInfoCollapsed, setRoomInfoCollapsed] = useState(false);
  const [memberLocalPause, setMemberLocalPause] = useState(false);
  const [htmlFullScreenActive, setHtmlFullScreenActive] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);

  /* ---- refs ---- */
  const webviewRef = useRef<SyncWebviewElement | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const isHostRef = useRef(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const memberLocalPauseRef = useRef(false);

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

  useEffect(() => {
    desktopBridge.getRendererUpdateState().then((s: RendererUpdateState) => {
      if (s.status === "ready") setRendererReady(true);
    }).catch(() => {});
    return desktopBridge.onRendererUpdateState((s: RendererUpdateState) => {
      setRendererReady(s.status === "ready");
    });
  }, []);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, message });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const copyTextToClipboard = useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage);
      return true;
    } catch {
      showToast("复制失败，请手动复制");
      return false;
    }
  }, [showToast]);

  // Deep link: yiqikan://join/<roomId>?password=<pwd>
  useEffect(() => {
    return desktopBridge.onDeepLink((url: string) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "yiqikan:") return;
        const roomId = (parsed.hostname || parsed.pathname.replace(/^\/+/, "")).trim().toLowerCase();
        if (!roomId) return;
        const password = parsed.searchParams.get("password") || undefined;
        if (room) {
          showToast("请先退出当前房间再加入新房间");
          return;
        }
        setRoomCode(roomId);
        if (password) setPassword(password);
      } catch { /* malformed url */ }
    });
  }, [room]);


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
    setTtsEnabled,
    submitChatMessage,
    ttsEnabled,
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
    goHome,
    openLastUrl,
    lastUrl,
    lastTitle,
    loading,
    navigateUrl,
    normalizeUrl,
    openUrlInCurrentView,
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

  const audioBoostStatus = useAudioBoost({ webviewRef, webviewReady, localVolume });

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
    onGoHome: goHome,
  });

  /* ---- notify webview of host mode changes ---- */
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !webviewReady) return;
    wv.send("yiqikan:set-host-mode", !room || isHost);
  }, [isHost, room, webviewReady]);

  const {
    createRoom,
    joinRoom,
    leaveRoom,
    closeRoom,
    saveRoomPassword,
    updateMemberName,
    kickMember,
    transferHost,
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
    copyTextToClipboard(room.id, "房间号已复制").then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [copyTextToClipboard, room]);

  const copyInviteLink = useCallback(() => {
    if (!room) return;
    const base = "https://yiqikan.cpolar.cn/join";
    const url = room.hasPassword && password
      ? `${base}/${room.id}?password=${encodeURIComponent(password)}`
      : `${base}/${room.id}`;
    copyTextToClipboard(url, room.hasPassword && password ? "邀请链接已复制，已包含密码" : "邀请链接已复制");
  }, [copyTextToClipboard, room, password]);

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
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-9999 pointer-events-none">
          <div key={toast.id} className="max-w-[min(480px,calc(100vw-32px))] rounded-lg border border-white/[0.12] bg-zinc-950/88 px-3.5 py-2 text-center text-sm font-medium leading-5 text-white shadow-[0_12px_36px_rgba(0,0,0,0.34)] backdrop-blur-xl animate-fade-in-out">
            {toast.message}
          </div>
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
        navigateToUrl={openUrlInCurrentView}
        onGoHome={() => {
          goHome();
          setUrlInput("");
        }}
        onClearBrowsingData={async () => {
          await desktopBridge.clearBrowsingData();
          showToast("缓存已清除");
        }}
        lastUrl={lastUrl}
        lastTitle={lastTitle}
        onOpenLastUrl={() => {
          if (lastUrl) openLastUrl(lastUrl);
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
          audioBoostStatus={audioBoostStatus}
          chatDraft={chatDraft}
          danmakuEnabled={danmakuEnabled}
          ttsEnabled={ttsEnabled}
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
          onCopyInviteLink={copyInviteLink}
          onToggleRoomInfoCollapsed={() => setRoomInfoCollapsed((value) => !value)}
          onUpdateMemberName={updateMemberName}
          onStartEditingPassword={() => {
            setEditingPassword(true);
            setRoomPasswordVisible(true);
          }}
          onSaveRoomPassword={saveRoomPassword}
          onKickMember={kickMember}
          onTransferHost={transferHost}
          onTogglePlayPause={togglePlayPause}
          onSeekTo={seekTo}
          onRequestFullscreen={requestFullscreen}
          setLocalVolume={setLocalVolume}
          onChatDraftChange={setChatDraft}
          onToggleDanmaku={() => setDanmakuEnabled((value) => !value)}
          onToggleTts={() => setTtsEnabled((value) => !value)}
          onSubmitChatMessage={submitChatMessage}
          rendererReady={rendererReady}
          onApplyRendererUpdate={() => {
            setRendererReady(false);
            disconnectSocket();
            desktopBridge.applyRendererUpdate().catch(() => {});
          }}
        />
      )}
    </div>
  );
}
