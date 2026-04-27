export type RendererUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "downloading"
  | "ready"        // downloaded, will apply on next launch
  | "up-to-date"
  | "error";

export type ShellUpdateStatus =
  | "none"          // no update needed
  | "suggested"     // version behind, user can dismiss
  | "forced";       // forceShellUpdate = true, cannot dismiss

export interface RendererUpdateState {
  status: RendererUpdateStatus;
  currentVersion: string | null;
  availableVersion: string | null;
  progressPercent: number | null;
  message: string | null;
  error: string | null;
}

export interface ShellUpdateState {
  status: ShellUpdateStatus;
  message: string | null;
}

export function createInitialRendererUpdateState(): RendererUpdateState {
  return {
    status: "disabled",
    currentVersion: null,
    availableVersion: null,
    progressPercent: null,
    message: null,
    error: null,
  };
}

export function createInitialShellUpdateState(): ShellUpdateState {
  return {
    status: "none",
    message: null,
  };
}
