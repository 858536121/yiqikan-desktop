export type SyncWebviewElement = HTMLWebViewElement & {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  getTitle(): string;
  loadURL(url: string): Promise<void> | void;
  executeJavaScript(code: string): Promise<any>;
  send(channel: string, ...args: any[]): void;
};

export interface VideoStatus {
  found: boolean;
  currentTime?: number;
  duration?: number;
  paused?: boolean;
  playbackRate?: number;
  readyState?: number;
  localTimestamp?: number;
}
