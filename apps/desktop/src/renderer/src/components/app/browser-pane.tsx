import type { MutableRefObject } from "react";
import { useState } from "react";
import type { RoomState } from "@yiqikan/shared";
import {
  ArrowLeft,
  ArrowRight,
  Film,
  Globe,
  Home,
  Lamp,
  Menu,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import { EmptyState } from "./empty-state";
import { cn } from "../../lib/utils";
import type { SyncWebviewElement } from "../../types/sync";

type CollapsedToggleDragState = {
  pointerId: number | null;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
};

interface DanmakuItem {
  id: string;
  actorName: string;
  message: string;
  topPercent: number;
  durationMs: number;
}

interface BrowserPaneProps {
  room: RoomState | null;
  isHost: boolean;
  collapsed: boolean;
  hasUnreadChat: boolean;
  collapsedToggleTop: number;
  collapsedToggleLeft: number;
  collapsedToggleButtonRef: MutableRefObject<HTMLButtonElement | null>;
  collapsedToggleDragRef: MutableRefObject<CollapsedToggleDragState>;
  collapsedTogglePositionRef: MutableRefObject<{ left: number; top: number }>;
  suppressCollapsedToggleClickRef: MutableRefObject<boolean>;
  setCollapsed: (value: boolean) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  webviewReady: boolean;
  activeUrl: string | null;
  loading: boolean;
  urlInput: string;
  urlFocused: boolean;
  canNavigate: boolean;
  videoDetected: boolean;
  danmakuMessages: DanmakuItem[];
  webviewPreloadPath: string | null;
  urlInputRef: MutableRefObject<HTMLInputElement | null>;
  webviewRef: MutableRefObject<SyncWebviewElement | null>;
  setUrlInput: (value: string) => void;
  setUrlFocused: (value: boolean) => void;
  showToast: (message: string) => void;
  goBack: () => void;
  goForward: () => void;
  reloadPage: () => void;
  navigateUrl: () => void;
  onClearBrowsingData: () => void;
  onGoHome: () => void;
  lastUrl: string;
  lastTitle: string;
  onOpenLastUrl: () => void;
}

export function BrowserPane({
  room,
  isHost,
  collapsed,
  hasUnreadChat,
  collapsedToggleTop,
  collapsedToggleLeft,
  collapsedToggleButtonRef,
  collapsedToggleDragRef,
  collapsedTogglePositionRef,
  suppressCollapsedToggleClickRef,
  setCollapsed,
  canGoBack,
  canGoForward,
  webviewReady,
  activeUrl,
  loading,
  urlInput,
  urlFocused,
  canNavigate,
  videoDetected,
  danmakuMessages,
  webviewPreloadPath,
  urlInputRef,
  webviewRef,
  setUrlInput,
  setUrlFocused,
  showToast,
  goBack,
  goForward,
  reloadPage,
  navigateUrl,
  onClearBrowsingData,
  onGoHome,
  lastUrl,
  lastTitle,
  onOpenLastUrl,
}: BrowserPaneProps) {
  const addressBarVisible = !collapsed;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <div className="flex-1 flex flex-col min-w-0">
        {addressBarVisible && (
          <div className="flex flex-col shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/[0.08] bg-[#111113]">
              <Button variant="icon" disabled={!webviewReady} onClick={onGoHome} title="首页" className="w-8 h-8 p-0">
                <Home className="w-3.5 h-3.5" />
              </Button>
              <Button variant="icon" disabled={!webviewReady || !canGoBack} onClick={goBack} title="后退" className="w-8 h-8 p-0">
                <ArrowLeft className="w-3.5 h-3.5" />
              </Button>
              <Button variant="icon" disabled={!webviewReady || !canGoForward} onClick={goForward} title="前进" className="w-8 h-8 p-0">
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
              <Button variant="icon" disabled={!webviewReady || !activeUrl} onClick={reloadPage} title="刷新" className="w-8 h-8 p-0">
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>

              <form
                className="flex-1 flex items-center gap-1.5 min-w-0"
                onSubmit={(event) => {
                  event.preventDefault();
                  navigateUrl();
                  urlInputRef.current?.blur();
                }}
              >
                <div
                  className={cn(
                    "relative flex-1 flex items-center rounded-lg border transition-all",
                    urlFocused ? "border-orange-500/40 ring-1 ring-orange-500/20 bg-white/[0.06]" : "border-white/[0.1] bg-white/[0.04]",
                  )}
                >
                  <Globe className="absolute left-3 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                  <input
                    ref={(node) => {
                      urlInputRef.current = node;
                    }}
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    onPointerDown={(event) => {
                      if (room && !isHost) {
                        event.preventDefault();
                        showToast("只有房主可以导航，成员只能刷新当前页面");
                      }
                    }}
                    onKeyDown={(event) => {
                      if (room && !isHost) {
                        event.preventDefault();
                        showToast("只有房主可以导航，成员只能刷新当前页面");
                      }
                    }}
                    onFocus={() => {
                      if (room && !isHost) {
                        urlInputRef.current?.blur();
                        showToast("只有房主可以导航，成员只能刷新当前页面");
                        return;
                      }
                      setUrlFocused(true);
                      window.setTimeout(() => urlInputRef.current?.select(), 0);
                    }}
                    onBlur={() => setUrlFocused(false)}
                    placeholder={room && !isHost ? "等待房主导航…" : "输入网址，如 bilibili.com"}
                    readOnly={room ? !isHost : false}
                    className="w-full bg-transparent pl-9 pr-8 py-1.5 text-sm text-white placeholder:text-zinc-500 outline-none read-only:opacity-70"
                  />
                  {urlInput && canNavigate && (
                    <button
                      type="button"
                      onClick={() => {
                        setUrlInput("");
                        urlInputRef.current?.focus();
                      }}
                      className="absolute right-2 w-5 h-5 rounded-md bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center transition-colors"
                      title="清空"
                    >
                      <X className="w-3 h-3 text-zinc-500" />
                    </button>
                  )}
                </div>
                <Button type="submit" disabled={!canNavigate || !urlInput.trim()} className="shrink-0 h-8 px-3 text-xs">
                  <Send className="w-3.5 h-3.5" />
                  <span>前往</span>
                </Button>
              </form>

              {videoDetected && (
                <div className="flex items-center gap-1 text-[10px] text-orange-400 bg-orange-500/10 rounded-lg px-2 py-1 shrink-0" title="已检测到视频">
                  <Film className="w-3 h-3" />
                  <span>视频同步中</span>
                </div>
              )}

              <div className="relative shrink-0">
                <Button
                  variant="icon"
                  className="w-8 h-8 p-0"
                  title="更多选项"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <Menu className="w-3.5 h-3.5" />
                </Button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-white/[0.08] bg-[#1a1a1c] shadow-xl py-1">
                      <button
                        className="w-full px-3 py-1.5 text-left text-xs text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                        onClick={() => {
                          setMenuOpen(false);
                          onClearBrowsingData();
                        }}
                      >
                        清除缓存
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {loading && (
              <div className="h-0.5 bg-orange-500/20 overflow-hidden">
                <div className="h-full bg-orange-500 loading-bar" />
              </div>
            )}
          </div>
        )}

        <div className="relative flex-1 min-h-0 bg-[#0a0a0b]">
          {activeUrl && webviewPreloadPath !== null ? (
            <>
              <webview
                ref={(node) => {
                  webviewRef.current = node as SyncWebviewElement | null;
                }}
                className="browser-webview"
                partition="persist:yiqikan"
                src={activeUrl}
                preload={webviewPreloadPath}
                {...{ allowpopups: "" } as any}
              />
              {danmakuMessages.length > 0 && (
                <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                  {danmakuMessages.map((item) => (
                    <div
                      key={item.id}
                      className="danmaku-item"
                      style={{
                        top: `${item.topPercent}%`,
                        animationDuration: `${item.durationMs}ms`,
                      }}
                    >
                      <span className="danmaku-actor">{item.actorName}</span>
                      <span>{item.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState room={room} lastUrl={lastUrl} lastTitle={lastTitle} onOpenLastUrl={onOpenLastUrl} />
          )}
        </div>
      </div>

      {collapsed && (
        <button
          ref={(node) => {
            collapsedToggleButtonRef.current = node;
          }}
          onPointerDown={(event) => {
            const startLeft = collapsedTogglePositionRef.current.left;
            const startTop = collapsedTogglePositionRef.current.top;
            collapsedToggleDragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              startLeft,
              startTop,
            };
            collapsedTogglePositionRef.current = {
              left: startLeft,
              top: startTop,
            };
            suppressCollapsedToggleClickRef.current = false;
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onClick={() => {
            if (suppressCollapsedToggleClickRef.current) {
              suppressCollapsedToggleClickRef.current = false;
              return;
            }
            setCollapsed(false);
          }}
          className="fixed z-50 flex h-12 w-12 cursor-grab select-none items-center justify-center rounded-2xl border border-orange-500/20 bg-[#111113]/90 text-white shadow-lg backdrop-blur-md transition-all duration-150 hover:scale-105 active:cursor-grabbing"
          style={{ top: collapsedToggleTop, left: collapsedToggleLeft, touchAction: "none" }}
          title="展开面板"
        >
          {/* glow layers */}
          <span className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-orange-500/10 via-orange-500/5 to-transparent" />
          <span className="pointer-events-none absolute -inset-2 rounded-3xl bg-orange-500/10 blur-md" />
          <span className="pointer-events-none absolute -inset-4 rounded-full bg-orange-500/5 blur-xl" />
          <Lamp className="relative z-10 h-5 w-5 text-orange-400 drop-shadow-[0_0_6px_rgba(249,115,22,0.8)]" />
          {hasUnreadChat && (
            <span className="absolute right-1.5 top-1.5 z-20 h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_0_3px_rgba(17,17,19,0.95)]" />
          )}
        </button>
      )}
    </>
  );
}
