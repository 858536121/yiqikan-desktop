import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { ROOM_EVENTS, type PlayerEventPayload, type RoomState } from "@yiqikan/shared";
import type { Socket } from "socket.io-client";
import type { SyncWebviewElement } from "../types/sync";

type DesktopBridge = Exclude<Window["yiqikan"], undefined>;

interface UseWebviewNavigationOptions {
  client: Socket;
  desktopBridge: DesktopBridge;
  room: RoomState | null;
  roomRef: MutableRefObject<RoomState | null>;
  currentUserId: string;
  isHost: boolean;
  isHostRef: MutableRefObject<boolean>;
  webviewRef: MutableRefObject<SyncWebviewElement | null>;
  urlInput: string;
  setUrlInput: Dispatch<SetStateAction<string>>;
  showToast: (message: string) => void;
}

export function useWebviewNavigation({
  client,
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
}: UseWebviewNavigationOptions) {
  const [pageTitle, setPageTitle] = useState("一起打开一个页面吧");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [webviewReady, setWebviewReady] = useState(false);
  const [webviewPreloadPath, setWebviewPreloadPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preRoomUrl, setPreRoomUrl] = useState("");
  const [lastUrl] = useState(() => localStorage.getItem("yiqikan:lastUrl") ?? "");
  const [lastTitle] = useState(() => localStorage.getItem("yiqikan:lastTitle") ?? "");

  const requestedUrlRef = useRef<string | null>(null);
  const suppressHostSyncRef = useRef(false);

  const activeUrl = room?.playback.url || preRoomUrl || null;

  const normalizeUrl = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    // Resolve protocol-relative URLs (e.g. //search.bilibili.com/...)
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    // Already has a protocol (http://, ftp://, etc.)
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return trimmed;
    // Looks like a domain: contains a dot and no spaces, e.g. "bilibili.com" or "192.168.1.1"
    const looksLikeDomain = /^[^\s]+\.[^\s]+$/.test(trimmed);
    if (looksLikeDomain) return `https://${trimmed}`;
    // Otherwise treat as a search query
    return `https://www.baidu.com/s?wd=${encodeURIComponent(trimmed)}`;
  }, []);

  const persistLastViewedUrl = useCallback((nextUrl: string | null | undefined) => {
    if (!nextUrl || nextUrl === "about:blank") return;
    setPreRoomUrl(nextUrl);
    localStorage.setItem("yiqikan:lastUrl", nextUrl);
  }, []);

  const safeLoadUrl = useCallback((targetUrl: string) => {
    const webview = webviewRef.current;
    if (!webview) return;

    try {
      const result = webview.loadURL(targetUrl);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((error) => {
          const message = String((error as Error | undefined)?.message ?? error ?? "");
          if (message.includes("ERR_ABORTED")) return;
          console.warn("[yiqikan] webview loadURL failed:", error);
        });
      }
    } catch (error) {
      console.warn("[yiqikan] webview loadURL threw:", error);
    }
  }, [webviewRef]);

  const emitPlayerEvent = useCallback((action: PlayerEventPayload["action"], nextUrl?: string | null, nextTitle?: string | null) => {
    const activeRoom = roomRef.current;
    if (!activeRoom || !currentUserId) return;

    client.emit(ROOM_EVENTS.PlayerEvent, {
      roomId: activeRoom.id,
      actorId: currentUserId,
      action,
      url: nextUrl ?? activeRoom.playback.url,
      pageTitle: nextTitle ?? activeRoom.playback.pageTitle,
      paused: activeRoom.playback.paused,
      currentTime: activeRoom.playback.currentTime,
      playbackRate: activeRoom.playback.playbackRate,
      duration: activeRoom.playback.duration,
    } satisfies PlayerEventPayload);
  }, [client, currentUserId, roomRef]);

  const openUrlInCurrentView = useCallback((targetUrl: string) => {
    const normalizedUrl = normalizeUrl(targetUrl);
    if (!normalizedUrl) return;

    if (roomRef.current?.id && !isHostRef.current) {
      showToast("只有房主可以导航，成员只能刷新当前页面");
      return;
    }

    setUrlInput(normalizedUrl);

    const activeRoom = roomRef.current;
    if (activeRoom?.id && isHostRef.current) {
      persistLastViewedUrl(normalizedUrl);
      requestedUrlRef.current = normalizedUrl;
      suppressHostSyncRef.current = true;
      emitPlayerEvent("load_url", normalizedUrl, normalizedUrl);
    }

    if (webviewReady) {
      safeLoadUrl(normalizedUrl);
    } else if (!activeRoom) {
      persistLastViewedUrl(normalizedUrl);
      setPreRoomUrl(normalizedUrl);
    }
  }, [emitPlayerEvent, isHostRef, normalizeUrl, persistLastViewedUrl, roomRef, safeLoadUrl, setUrlInput, showToast, webviewReady]);

  const navigateUrl = useCallback(() => {
    openUrlInCurrentView(urlInput);
  }, [openUrlInCurrentView, urlInput]);

  const reloadPage = useCallback(() => {
    if (!webviewReady) return;
    if (room && isHost) {
      emitPlayerEvent("reload", room.playback.url, room.playback.pageTitle);
    }
    webviewRef.current?.reload();
  }, [emitPlayerEvent, isHost, room, webviewReady, webviewRef]);

  const goBack = useCallback(() => {
    if (room && !isHost) {
      showToast("只有房主可以导航，成员只能刷新当前页面");
      return;
    }
    if (!webviewReady || !webviewRef.current?.canGoBack()) return;
    webviewRef.current.goBack();
  }, [isHost, room, showToast, webviewReady, webviewRef]);

  const goForward = useCallback(() => {
    if (room && !isHost) {
      showToast("只有房主可以导航，成员只能刷新当前页面");
      return;
    }
    if (!webviewReady || !webviewRef.current?.canGoForward()) return;
    webviewRef.current.goForward();
  }, [isHost, room, showToast, webviewReady, webviewRef]);

  useEffect(() => {
    if (room?.playback.pageTitle) {
      setPageTitle(room.playback.pageTitle);
      return;
    }
    if (room?.playback.url) {
      setPageTitle(room.playback.url);
    }
  }, [room?.playback.pageTitle, room?.playback.url]);

  useEffect(() => {
    desktopBridge.getWebviewPreloadPath().then((path: string) => {
      setWebviewPreloadPath(path ? `file://${path}` : "");
    });
  }, [desktopBridge]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    function tryAttach() {
      const webview = webviewRef.current;
      if (!webview || cancelled) return false;

      const view = webview;

      function syncNavigationState() {
        try {
          setCanGoBack(view.canGoBack());
          setCanGoForward(view.canGoForward());
        } catch {
          setCanGoBack(false);
          setCanGoForward(false);
        }
      }

      function handleNavigated() {
        syncNavigationState();
        const nextUrl = view.getURL();
        if (nextUrl && nextUrl !== "about:blank") {
          setUrlInput(nextUrl);
          persistLastViewedUrl(nextUrl);
        }
      }

      function handleStartLoading() {
        setLoading(true);
      }

      function handleStopLoading() {
        setLoading(false);
        syncNavigationState();

        const nextUrl = view.getURL();
        const nextTitle = view.getTitle() || nextUrl;
        setPageTitle(nextTitle);
        persistLastViewedUrl(nextUrl);
        if (nextUrl && nextUrl !== "about:blank") {
          localStorage.setItem("yiqikan:lastTitle", nextTitle);
        }

        const activeRoom = roomRef.current;
        if (!activeRoom) {
          if (nextUrl && nextUrl !== "about:blank") {
            setUrlInput(nextUrl);
          }
          return;
        }

        if (!isHostRef.current) return;
        if (suppressHostSyncRef.current && requestedUrlRef.current === nextUrl) {
          suppressHostSyncRef.current = false;
          requestedUrlRef.current = null;
          return;
        }

        if (activeRoom.playback.url !== nextUrl || activeRoom.playback.pageTitle !== nextTitle) {
          emitPlayerEvent("navigate", nextUrl, nextTitle);
        }
      }

      function handleTitleUpdated(event: Event) {
        const title = (event as { title?: string }).title;
        if (title) setPageTitle(title);
      }

      function handleDomReady() {
        setWebviewReady(true);
        setLoading(false);
        syncNavigationState();
      }

      view.addEventListener("dom-ready", handleDomReady);
      view.addEventListener("did-start-loading", handleStartLoading);
      view.addEventListener("did-stop-loading", handleStopLoading);
      view.addEventListener("page-title-updated", handleTitleUpdated as EventListener);
      view.addEventListener("did-navigate", handleNavigated);
      view.addEventListener("did-navigate-in-page", handleNavigated);

      cleanup = () => {
        view.removeEventListener("dom-ready", handleDomReady);
        view.removeEventListener("did-start-loading", handleStartLoading);
        view.removeEventListener("did-stop-loading", handleStopLoading);
        view.removeEventListener("page-title-updated", handleTitleUpdated as EventListener);
        view.removeEventListener("did-navigate", handleNavigated);
        view.removeEventListener("did-navigate-in-page", handleNavigated);
      };

      return true;
    }

    if (!tryAttach()) {
      const interval = setInterval(() => {
        if (tryAttach() || cancelled) clearInterval(interval);
      }, 200);

      return () => {
        cancelled = true;
        clearInterval(interval);
        cleanup?.();
      };
    }

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [activeUrl, emitPlayerEvent, isHostRef, persistLastViewedUrl, roomRef, setUrlInput, webviewRef]);

  useEffect(() => {
    const webview = webviewRef.current;
    const nextUrl = room?.playback.url;
    if (!webview || !webviewReady || !nextUrl) return;

    const timer = setTimeout(() => {
      try {
        const currentUrl = webview.getURL();
        if (currentUrl !== nextUrl) safeLoadUrl(nextUrl);
      } catch {
        // webview may still be initializing
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [room?.playback.updatedAt, room?.playback.url, safeLoadUrl, webviewReady, webviewRef]);

  useEffect(() => {
    if (!room?.playback.url) return;
    persistLastViewedUrl(room.playback.url);
  }, [persistLastViewedUrl, room?.playback.url]);

  useEffect(() => {
    return desktopBridge.onWebviewWindowOpen((payload: { url: string }) => {
      if (payload.url) openUrlInCurrentView(payload.url);
    });
  }, [desktopBridge, openUrlInCurrentView]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !webviewReady) return;

    function handleIpc(event: any) {
      if (event.channel !== "yiqikan:open-url") return;
      const payload = event.args?.[0] as { url?: string } | undefined;
      if (payload?.url) openUrlInCurrentView(payload.url);
    }

    webview.addEventListener("ipc-message", handleIpc);
    return () => webview.removeEventListener("ipc-message", handleIpc);
  }, [openUrlInCurrentView, webviewReady, webviewRef]);

  return {
    activeUrl,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    goHome: () => {
      setPreRoomUrl("");
      setUrlInput("");
      // If in a room as host, broadcast "go home" to all members
      const activeRoom = roomRef.current;
      if (activeRoom?.id && isHostRef.current) {
        emitPlayerEvent("load_url", "", "");
      }
    },
    openLastUrl: (url: string) => {
      setPreRoomUrl("");           // 先清空，确保 React 检测到变化
      requestAnimationFrame(() => setPreRoomUrl(url));
    },
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
  };
}
