import { AutomaticUpdateCoordinator } from './automatic-update-coordinator';
import { otaService, type OtaCheckResult } from './ota-service';
import { useDialogStore } from '../store/useDialogStore';
import { useRegistrationVerification } from './registration-verification';

let homeSafety: (() => boolean) | null = null;
let nativeUpgrade: ((result: OtaCheckResult) => void) | null = null;

export const automaticUpdates = new AutomaticUpdateCoordinator({
  async check(nativeCheck) {
    if (!otaService.beginUpdateFlow()) return null;
    try { return await otaService.checkUpdate(undefined, { automatic: true, nativeCheck }); }
    finally { otaService.endUpdateFlow(); }
  },
  download: result => otaService.downloadAndApply(result.bundleUrl, result.latestBundleVersion, result.bundleHash),
  reload: () => otaService.reloadApp(),
  allowed: () => otaService.canApplyOta(),
  safe: () => Boolean(homeSafety?.()) && !useDialogStore.getState().currentDialog &&
    !useRegistrationVerification.getState().pending,
  nativeUpgrade: result => nativeUpgrade?.(result),
  warn: error => console.warn('[OTA] 自动更新已延后:', error),
  now: Date.now,
});

export function registerUpdateHome(safe: () => boolean, upgrade: (result: OtaCheckResult) => void) {
  homeSafety = safe;
  nativeUpgrade = upgrade;
  automaticUpdates.safetyChanged();
  return () => {
    if (homeSafety === safe) { homeSafety = null; nativeUpgrade = null; }
  };
}
