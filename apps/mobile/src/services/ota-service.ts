import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { compareVersions, type AppReleaseConfig, type MobileReleaseConfig } from '@yiqikan/shared';

const STORAGE_KEY_OTA_VERSION = '@yiqikan_ota_bundle_version';
const DEFAULT_WEB_BASE_URL = 'https://yiqikan.cpolar.cn';

const NativeOta = NativeModules.YiQiKanOTA;

export interface OtaCheckResult {
  status: 'UP_TO_DATE' | 'OTA_UPDATE_AVAILABLE' | 'APP_UPDATE_REQUIRED' | 'ERROR';
  currentVersion: string;
  latestBundleVersion?: string;
  bundleUrl?: string;
  updateMode?: 'silent' | 'prompt';
  releaseNotes?: string;
  appDownloadUrl?: string;
  forceAppUpdate?: boolean;
  error?: string;
}

class OtaService {
  private baseAppVersion: string;

  constructor() {
    this.baseAppVersion = Constants.expoConfig?.version || '1.13.0';
  }

  /**
   * 获取当前生效的 UI Bundle 版本号（优先读取原生沙盒标记）
   */
  async getCurrentBundleVersion(): Promise<string> {
    try {
      if (Platform.OS === 'android' && NativeOta?.getAppliedVersion) {
        const nativeVer = await NativeOta.getAppliedVersion();
        if (nativeVer && typeof nativeVer === 'string' && nativeVer.trim()) {
          return nativeVer.trim();
        }
      }
      const stored = await AsyncStorage.getItem(STORAGE_KEY_OTA_VERSION);
      if (stored && stored.trim()) {
        return stored.trim();
      }
    } catch {
      // ignore
    }
    return this.baseAppVersion;
  }

  /**
   * 获取原生底包版本号
   */
  getBaseAppVersion(): string {
    return this.baseAppVersion;
  }

  /**
   * 检查全平台发布配置与移动端热更新
   */
  async checkUpdate(customWebUrl?: string): Promise<OtaCheckResult> {
    const currentBundleVersion = await this.getCurrentBundleVersion();
    const baseUrl = customWebUrl || process.env.EXPO_PUBLIC_WEB_URL || DEFAULT_WEB_BASE_URL;

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/release-config`, {
        headers: { 'Cache-Control': 'no-cache' },
      });

      if (!response.ok) {
        return {
          status: 'ERROR',
          currentVersion: currentBundleVersion,
          error: `HTTP error: ${response.status}`,
        };
      }

      const releaseConfig = (await response.json()) as AppReleaseConfig;
      const mobileConfig: MobileReleaseConfig | undefined = releaseConfig.mobile || undefined;

      if (!mobileConfig) {
        return {
          status: 'UP_TO_DATE',
          currentVersion: currentBundleVersion,
        };
      }

      // 1. 检查是否需要全量原生 APK 升级
      if (
        mobileConfig.appMinVersion &&
        compareVersions(this.baseAppVersion, mobileConfig.appMinVersion) < 0
      ) {
        return {
          status: 'APP_UPDATE_REQUIRED',
          currentVersion: currentBundleVersion,
          appDownloadUrl: mobileConfig.appDownloadUrl || `${baseUrl}/download`,
          forceAppUpdate: Boolean(mobileConfig.forceAppUpdate),
          releaseNotes: mobileConfig.releaseNotes || '请更新至最新版 App',
        };
      }

      // 2. 检查是否有新的 UI Bundle 热更新
      if (
        mobileConfig.bundleVersion &&
        mobileConfig.bundleUrl &&
        compareVersions(mobileConfig.bundleVersion, currentBundleVersion) > 0
      ) {
        const fullBundleUrl = mobileConfig.bundleUrl.startsWith('http')
          ? mobileConfig.bundleUrl
          : `${baseUrl.replace(/\/$/, '')}${mobileConfig.bundleUrl.startsWith('/') ? '' : '/'}${mobileConfig.bundleUrl}`;

        return {
          status: 'OTA_UPDATE_AVAILABLE',
          currentVersion: currentBundleVersion,
          latestBundleVersion: mobileConfig.bundleVersion,
          bundleUrl: fullBundleUrl,
          updateMode: mobileConfig.updateMode || 'silent',
          releaseNotes: mobileConfig.releaseNotes || '优化了 UI 体验与已知问题',
        };
      }

      return {
        status: 'UP_TO_DATE',
        currentVersion: currentBundleVersion,
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        currentVersion: currentBundleVersion,
        error: err?.message || '网络连接超时',
      };
    }
  }

  /**
   * 真正下载并解压安装 Zip 热更包
   */
  async downloadAndApply(zipUrl: string, targetVersion: string): Promise<boolean> {
    try {
      if (Platform.OS === 'android' && NativeOta?.downloadAndApplyBundle) {
        await NativeOta.downloadAndApplyBundle(zipUrl, targetVersion);
        await AsyncStorage.setItem(STORAGE_KEY_OTA_VERSION, targetVersion);
        return true;
      }
      // 非 Android 平台或降级存储
      await AsyncStorage.setItem(STORAGE_KEY_OTA_VERSION, targetVersion);
      return true;
    } catch (e: any) {
      console.warn('[OTA] 下载/解压热更包失败:', e);
      throw e;
    }
  }

  /**
   * 重启应用加载新 Bundle
   */
  async reloadApp(): Promise<void> {
    if (Platform.OS === 'android' && NativeOta?.reloadApp) {
      await NativeOta.reloadApp();
    }
  }

  /**
   * 清除热更缓存并回退到底包
   */
  async clearOtaCache(): Promise<void> {
    if (Platform.OS === 'android' && NativeOta?.clearOtaCache) {
      await NativeOta.clearOtaCache();
    }
    await AsyncStorage.removeItem(STORAGE_KEY_OTA_VERSION);
  }

  /**
   * 记录已应用的热更版本
   */
  async recordAppliedVersion(version: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY_OTA_VERSION, version);
  }
}

export const otaService = new OtaService();
