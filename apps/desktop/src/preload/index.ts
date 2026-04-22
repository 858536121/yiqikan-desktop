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
});
