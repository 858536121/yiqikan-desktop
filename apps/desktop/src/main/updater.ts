import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import {
  type AppUpdateState,
  createInitialAppUpdateState,
} from "../shared/app-update.js";

const { autoUpdater } = electronUpdater;

const UPDATE_STATE_CHANNEL = "yiqikan:update-state";

type UpdateRuntimeConfig = {
  enabled: boolean;
  checkOnLaunch: boolean;
  allowPrerelease: boolean;
  feedUrl: string | null;
  forceDevUpdate: boolean;
  checkDelayMs: number;
};

let initialized = false;
let updateState = createInitialAppUpdateState(app.getVersion());

function readBooleanFlag(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function readOptionalUrl(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readUpdateRuntimeConfig(): UpdateRuntimeConfig {
  return {
    enabled: readBooleanFlag(process.env.YIQIKAN_UPDATES_ENABLED, false),
    checkOnLaunch: readBooleanFlag(process.env.YIQIKAN_UPDATES_CHECK_ON_LAUNCH, false),
    allowPrerelease: readBooleanFlag(process.env.YIQIKAN_UPDATES_ALLOW_PRERELEASE, false),
    feedUrl: readOptionalUrl(process.env.YIQIKAN_UPDATES_FEED_URL),
    forceDevUpdate: readBooleanFlag(process.env.YIQIKAN_UPDATES_FORCE_DEV, false),
    checkDelayMs: readPositiveInteger(process.env.YIQIKAN_UPDATES_CHECK_DELAY_MS, 5000),
  };
}

function broadcastUpdateState() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATE_STATE_CHANNEL, updateState);
    }
  }
}

function setUpdateState(nextPatch: Partial<AppUpdateState>) {
  updateState = {
    ...updateState,
    ...nextPatch,
  };
  broadcastUpdateState();
  return updateState;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? "未知更新错误");
}

async function runCheckForUpdates() {
  if (!updateState.enabled) {
    return updateState;
  }

  try {
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (error) {
    return setUpdateState({
      status: "error",
      error: toErrorMessage(error),
      message: "检查更新失败",
      checkedAt: Date.now(),
      progressPercent: null,
    });
  }
}

function bindAutoUpdaterEvents() {
  autoUpdater.on("checking-for-update", () => {
    setUpdateState({
      status: "checking",
      message: "正在检查更新",
      error: null,
      progressPercent: null,
    });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    setUpdateState({
      status: "available",
      availableVersion: info.version ?? null,
      downloadedVersion: null,
      checkedAt: Date.now(),
      message: info.version ? `发现新版本 ${info.version}，开始后台下载` : "发现新版本，开始后台下载",
      error: null,
      progressPercent: 0,
    });
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    setUpdateState({
      status: "downloading",
      progressPercent: progress.percent,
      message: `更新下载中 ${Math.round(progress.percent)}%`,
      error: null,
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    setUpdateState({
      status: "downloaded",
      availableVersion: info.version ?? updateState.availableVersion,
      downloadedVersion: info.version ?? updateState.availableVersion,
      checkedAt: Date.now(),
      progressPercent: 100,
      message: info.version
        ? `新版本 ${info.version} 已下载完成，重启应用即可安装`
        : "新版本已下载完成，重启应用即可安装",
      error: null,
    });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState({
      status: "not-available",
      availableVersion: null,
      downloadedVersion: null,
      checkedAt: Date.now(),
      progressPercent: null,
      message: "当前已经是最新版本",
      error: null,
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({
      status: "error",
      checkedAt: Date.now(),
      progressPercent: null,
      message: "自动更新发生错误",
      error: toErrorMessage(error),
    });
  });
}

export function registerUpdaterIpc() {
  ipcMain.handle("yiqikan:get-app-update-state", () => updateState);
  ipcMain.handle("yiqikan:check-for-app-updates", async () => runCheckForUpdates());
  ipcMain.handle("yiqikan:quit-and-install-app-update", () => {
    if (updateState.status !== "downloaded") return false;

    setTimeout(() => autoUpdater.quitAndInstall(), 0);
    return true;
  });
}

export function initializeAppUpdater() {
  if (initialized) {
    broadcastUpdateState();
    return;
  }

  initialized = true;

  const config = readUpdateRuntimeConfig();
  const canRunUpdater = config.enabled && config.feedUrl && (app.isPackaged || config.forceDevUpdate);

  setUpdateState({
    ...createInitialAppUpdateState(app.getVersion()),
    enabled: Boolean(canRunUpdater),
    feedUrl: config.feedUrl,
    status: canRunUpdater ? "idle" : "disabled",
    message: !config.enabled
      ? "自动更新未启用"
      : !config.feedUrl
        ? "未配置更新源地址"
        : !app.isPackaged && !config.forceDevUpdate
          ? "开发模式默认不检查自动更新"
          : "自动更新待命中",
  });

  if (!canRunUpdater) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = config.allowPrerelease;
  autoUpdater.setFeedURL({
    provider: "generic",
    url: config.feedUrl!,
  });

  bindAutoUpdaterEvents();

  if (config.checkOnLaunch) {
    setTimeout(() => {
      runCheckForUpdates().catch(() => {});
    }, config.checkDelayMs);
  }
}
