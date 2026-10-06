import Constants from 'expo-constants';
import { compareVersions, normalizeAppStoreUrl, normalizeIosAppVersion, type AppReleaseConfig } from '@yiqikan/shared';
import { resolveWebUrl } from './environment';
import type { OtaCheckResult, DownloadProgressCallback } from './ota-service';

export type { OtaCheckResult, DownloadProgressCallback } from './ota-service';

// Metro selects this adapter for iOS. Keep the OTA implementation in
// ota-service.ts for Android and any future, separately reviewed iOS release.
// This adapter has no runtime dependency on expo-updates or the OTA service.
class IosStoreUpdateService {
  private baseAppVersion = Constants.nativeAppVersion || Constants.expoConfig?.version || '1.16.0';

  isDownloading(): boolean { return false; }
  getBaseAppVersion(): string { return this.baseAppVersion; }
  async getCurrentBundleVersion(): Promise<string> { return this.baseAppVersion; }
  async markOtaSuccess(): Promise<void> {}
  async clearOtaCache(): Promise<void> {}
  async recordAppliedVersion(_version: string): Promise<void> {}

  async checkUpdate(customWebUrl?: string): Promise<OtaCheckResult> {
    const currentVersion = this.baseAppVersion;
    if (__DEV__) return { status: 'UP_TO_DATE', currentVersion };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const baseUrl = (customWebUrl || resolveWebUrl()).replace(/\/$/, '');
      const releaseConfig = await Promise.race([
        (async () => {
          const response = await fetch(`${baseUrl}/api/release-config`, {
            headers: { 'Cache-Control': 'no-cache' },
          });
          if (!response.ok) throw new Error('暂时无法检查更新，请稍后重试。');
          return await response.json() as AppReleaseConfig;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('检查更新超时，请稍后重试')), 30000);
        }),
      ]);
      const mobileConfig = releaseConfig?.mobile;
      const minVersion = normalizeIosAppVersion(mobileConfig?.iosAppMinVersion);
      if (mobileConfig && minVersion && compareVersions(currentVersion, minVersion) < 0) {
        const appDownloadUrl = normalizeAppStoreUrl(mobileConfig.iosAppStoreUrl);
        if (!appDownloadUrl) throw new Error('暂时无法获取 App Store 更新入口，请稍后重试。');
        return {
          status: 'APP_UPDATE_REQUIRED', currentVersion, appDownloadUrl,
          forceAppUpdate: Boolean(mobileConfig.iosForceAppUpdate),
          releaseNotes: mobileConfig.releaseNotes || '请前往 App Store 更新到最新版本。',
        };
      }
      // Android bundle versions, download URLs and update modes cannot enable iOS OTA.
      return { status: 'UP_TO_DATE', currentVersion };
    } catch (error: any) {
      return { status: 'ERROR', currentVersion, error: error?.message || '暂时无法检查更新，请稍后重试。' };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async downloadAndApply(
    _bundleUrl?: string, _targetVersion?: string, _expectedHash?: string,
    _onProgress?: DownloadProgressCallback,
  ): Promise<boolean> {
    throw new Error('请通过 App Store 更新 iOS 应用。');
  }
  async reloadApp(): Promise<void> { throw new Error('请通过 App Store 更新 iOS 应用。'); }
  async downloadAndInstallApk(_url: string, _onProgress?: DownloadProgressCallback): Promise<boolean> {
    throw new Error('请通过 App Store 更新 iOS 应用。');
  }
  async installExistingApk(): Promise<boolean> { return false; }
}

export const otaService = new IosStoreUpdateService();
