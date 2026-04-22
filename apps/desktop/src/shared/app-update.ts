export type AppUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export interface AppUpdateState {
  enabled: boolean;
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  feedUrl: string | null;
  message: string | null;
  error: string | null;
  progressPercent: number | null;
  checkedAt: number | null;
}

export function createInitialAppUpdateState(currentVersion: string): AppUpdateState {
  return {
    enabled: false,
    status: "disabled",
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    feedUrl: null,
    message: null,
    error: null,
    progressPercent: null,
    checkedAt: null,
  };
}
