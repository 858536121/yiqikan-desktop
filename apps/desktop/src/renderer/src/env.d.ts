/// <reference types="vite/client" />

import "react";
import type { DesktopRuntimeContext } from "@yiqikan/shared";
import type { AppUpdateState } from "../../shared/app-update";

declare global {
  interface ImportMetaEnv {
    readonly VITE_YIQIKAN_SERVER_URL?: string;
  }

  interface Window {
    yiqikan?: {
      appName: string;
      serverUrl: string;
      runtimeContext: DesktopRuntimeContext;
      getWebviewPreloadPath: () => Promise<string>;
      getWebviewMediaSourceId: () => Promise<string | null>;
      getHtmlFullScreenState: () => Promise<boolean>;
      exitHtmlFullScreen: () => Promise<boolean>;
      getAppUpdateState: () => Promise<AppUpdateState>;
      checkForAppUpdates: () => Promise<AppUpdateState>;
      quitAndInstallAppUpdate: () => Promise<boolean>;
      onAppUpdateState: (listener: (payload: AppUpdateState) => void) => () => void;
      onWebviewWindowOpen: (listener: (payload: { url: string; frameName?: string; disposition?: string; referrer?: string }) => void) => () => void;
      onHtmlFullScreenChange: (listener: (payload: { active: boolean }) => void) => () => void;
    };
  }

  interface SyncWebviewElement extends HTMLElement {
    src: string;
    loadURL: (url: string) => Promise<void> | void;
    reload: () => void;
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    goBack: () => void;
    goForward: () => void;
    getURL: () => string;
    getTitle: () => string;
    stop: () => void;
    executeJavaScript: (code: string) => Promise<any>;
    send: (channel: string, ...args: any[]) => void;
    addEventListener: (
      type: string,
      listener: (event: any) => void,
      options?: boolean | AddEventListenerOptions,
    ) => void;
    removeEventListener: (
      type: string,
      listener: (event: any) => void,
      options?: boolean | EventListenerOptions,
    ) => void;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.WebViewHTMLAttributes<HTMLWebViewElement>, HTMLWebViewElement> & {
        allowpopups?: string;
        partition?: string;
        preload?: string;
        nodeintegrationinsubframes?: string;
      };
    }
  }
}

export {};
