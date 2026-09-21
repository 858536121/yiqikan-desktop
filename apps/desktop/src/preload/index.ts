import { contextBridge, ipcRenderer } from "electron";
import type { AppUpdateState } from "../shared/app-update.js";
import { resolveDesktopServerUrl } from "../shared/server-url.js";
import { desktopRuntimeContext } from "./runtime-context";

contextBridge.exposeInMainWorld("yiqikan", {
  appName: "异起看",
  serverUrl: resolveDesktopServerUrl(),
  runtimeContext: desktopRuntimeContext,
  getWebviewPreloadPath: () => ipcRenderer.invoke("get-webview-preload-path"),
  getWebviewMediaSourceId: () => ipcRenderer.invoke("get-webview-media-source-id"),
  getHtmlFullScreenState: () => ipcRenderer.invoke("yiqikan:get-html-full-screen-state") as Promise<boolean>,
  exitHtmlFullScreen: () => ipcRenderer.invoke("yiqikan:exit-html-full-screen") as Promise<boolean>,
  getAppUpdateState: () => ipcRenderer.invoke("yiqikan:get-app-update-state") as Promise<AppUpdateState>,
  checkForAppUpdates: () => ipcRenderer.invoke("yiqikan:check-for-app-updates") as Promise<AppUpdateState>,
  quitAndInstallAppUpdate: () => ipcRenderer.invoke("yiqikan:quit-and-install-app-update") as Promise<boolean>,
  clearBrowsingData: () => ipcRenderer.invoke("yiqikan:clear-browsing-data") as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke("yiqikan:open-external", url) as Promise<boolean>,
  voiceRpc: (payload: { host?: string; method: string; params?: any[] }) =>
    ipcRenderer.invoke("yiqikan:voice-rpc", payload) as Promise<any>,
  logToTerminal: (level: string, message: string, data?: any) => {
    ipcRenderer.send("yiqikan:log", { level, message, data });
  },
  onAppUpdateState: (listener: (payload: AppUpdateState) => void) => {
    const wrapped = (_event: unknown, payload: AppUpdateState) => listener(payload);
    ipcRenderer.on("yiqikan:update-state", wrapped);
    return () => ipcRenderer.removeListener("yiqikan:update-state", wrapped);
  },
  onWebviewWindowOpen: (listener: (payload: { url: string; frameName?: string; disposition?: string; referrer?: string }) => void) => {
    const wrapped = (_event: unknown, payload: { url: string; frameName?: string; disposition?: string; referrer?: string }) => listener(payload);
    ipcRenderer.on("yiqikan:webview-window-open", wrapped);
    return () => ipcRenderer.removeListener("yiqikan:webview-window-open", wrapped);
  },
  onHtmlFullScreenChange: (listener: (payload: { active: boolean }) => void) => {
    const wrapped = (_event: unknown, payload: { active: boolean }) => listener(payload);
    ipcRenderer.on("yiqikan:html-full-screen-change", wrapped);
    return () => ipcRenderer.removeListener("yiqikan:html-full-screen-change", wrapped);
  },
  onDeepLink: (listener: (url: string) => void) => {
    const wrapped = (_event: unknown, url: string) => listener(url);
    ipcRenderer.on("yiqikan:deep-link", wrapped);
    return () => ipcRenderer.removeListener("yiqikan:deep-link", wrapped);
  },
  isDesktop: true,
  reload: () => {
    ipcRenderer.send("yiqikan:reload");
  },
  forceReload: () => {
    ipcRenderer.send("yiqikan:force-reload");
  },
  retryOnline: (targetUrl?: string) => {
    ipcRenderer.send("yiqikan:retry-online", targetUrl);
  },
  launchOfflineMode: () => {
    ipcRenderer.send("yiqikan:launch-offline-mode");
  },
  openVerificationWindow: (url: string) => {
    return ipcRenderer.invoke("yiqikan:open-verification-window", url) as Promise<boolean>;
  },
  onVerificationComplete: (listener: (payload: { domain: string; url: string }) => void) => {
    const wrapped = (_event: unknown, payload: { domain: string; url: string }) => listener(payload);
    ipcRenderer.on("yiqikan:verification-complete", wrapped);
    return () => ipcRenderer.removeListener("yiqikan:verification-complete", wrapped);
  },
  writeClipboard: (text: string) => ipcRenderer.invoke("yiqikan:write-clipboard", text) as Promise<boolean>,
  readClipboard: () => ipcRenderer.invoke("yiqikan:read-clipboard") as Promise<string>,
  getLoadedExtensionVersion: () => ipcRenderer.invoke("yiqikan:get-loaded-extension-version") as Promise<string | null>,
  relaunch: () => ipcRenderer.invoke("yiqikan:relaunch") as Promise<void>,
  onExtensionUpdateReady: (listener: (payload: { currentVersion?: string; targetVersion: string }) => void) => {
    const wrapped = (_event: unknown, payload: { currentVersion?: string; targetVersion: string }) => listener(payload);
    ipcRenderer.on("yiqikan:extension-update-ready", wrapped);
    return () => ipcRenderer.removeListener("yiqikan:extension-update-ready", wrapped);
  },
});

// Forward verification completion from Electron main process to window.postMessage for web-room listeners
ipcRenderer.on("yiqikan:verification-complete", (_event, payload) => {
  try {
    window.postMessage({
      source: "yiqikan-bridge",
      channel: "yiqikan:verification-complete",
      payload,
    }, "*");
  } catch (_) {}
});

// Forward extension update ready from Electron main process to window.postMessage for web-room listeners
ipcRenderer.on("yiqikan:extension-update-ready", (_event, payload) => {
  try {
    window.postMessage({
      source: "yiqikan-bridge",
      channel: "yiqikan:extension-update-ready",
      payload,
    }, "*");
  } catch (_) {}
});

// Cache real loaded extension version from main process
let cachedLoadedExtVersion: string | null = null;
ipcRenderer.invoke("yiqikan:get-loaded-extension-version").then((ver) => {
  if (typeof ver === "string" && ver.trim()) {
    cachedLoadedExtVersion = ver.trim();
  }
}).catch(() => {});

// Auto-respond to extension ping from web room with real extension version (or undefined if not loaded)
window.addEventListener("message", (event) => {
  if (event.data?.source === "yiqikan-ping") {
    window.postMessage({
      source: "yiqikan-pong",
      version: cachedLoadedExtVersion || undefined,
      isDesktop: true,
    }, "*");
  }
});

contextBridge.exposeInMainWorld("__YIQIKAN_DESKTOP__", {
  isDesktop: true,
  appVersion: desktopRuntimeContext.client.appVersion,
  protocolVersion: desktopRuntimeContext.client.protocolVersion,
  platform: process.platform,
  arch: process.arch,
});
