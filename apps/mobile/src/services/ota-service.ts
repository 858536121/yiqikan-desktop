import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { compareVersions, type AppReleaseConfig, type MobileReleaseConfig } from '@yiqikan/shared';

const STORAGE_KEY_OTA_VERSION = '@yiqikan_ota_bundle_version';
const DEFAULT_WEB_BASE_URL = 'https://yiqikan.cpolar.cn';

const NativeOta = NativeModules.YiQiKanOTA;
const otaEventEmitter = NativeOta ? new NativeEventEmitter(NativeOta) : null;

export interface OtaCheckResult {
  status: 'UP_TO_DATE' | 'OTA_UPDATE_AVAILABLE' | 'APP_UPDATE_REQUIRED' | 'ERROR';
  currentVersion: string;
  latestBundleVersion?: string;
  bundleUrl?: string;
  bundleHash?: string;
  updateMode?: 'silent' | 'prompt';
  releaseNotes?: string;
  appDownloadUrl?: string;
  forceAppUpdate?: boolean;
  error?: string;
}

export type DownloadProgressCallback = (percent: number, receivedBytes?: number, totalBytes?: number) => void;

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
          // 原生沙盒存在生效的热更包，同步更新 AsyncStorage 缓存
          await AsyncStorage.setItem(STORAGE_KEY_OTA_VERSION, nativeVer.trim());
          return nativeVer.trim();
        } else {
          // 原生沙盒无生效热更包（如熔断回滚或从未热更），必须清除残留脏缓存，避免虚假回显与阻塞后续热更
          await AsyncStorage.removeItem(STORAGE_KEY_OTA_VERSION);
          return this.baseAppVersion;
        }
      }

      // iOS 平台未接入原生 Bundle 动态替换引擎，严格以底包版本为准
      if (Platform.OS === 'ios') {
        return this.baseAppVersion;
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
   * 标记当前启动健康进入业务，重置崩溃熔断计数
   */
  async markOtaSuccess(): Promise<void> {
    try {
      if (Platform.OS === 'android' && NativeOta?.markOtaSuccess) {
        await NativeOta.markOtaSuccess();
      }
    } catch {
      // ignore
    }
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

      // 1. 检查是否需要全量原生 APK 升级（严格限定 Android 平台）
      if (
        Platform.OS === 'android' &&
        mobileConfig.appMinVersion &&
        compareVersions(this.baseAppVersion, mobileConfig.appMinVersion) < 0
      ) {
        const fullApkUrl = mobileConfig.appDownloadUrl?.startsWith('http')
          ? mobileConfig.appDownloadUrl
          : `${baseUrl.replace(/\/$/, '')}${mobileConfig.appDownloadUrl?.startsWith('/') ? '' : '/'}${mobileConfig.appDownloadUrl || 'download'}`;

        return {
          status: 'APP_UPDATE_REQUIRED',
          currentVersion: currentBundleVersion,
          appDownloadUrl: fullApkUrl,
          forceAppUpdate: Boolean(mobileConfig.forceAppUpdate),
          releaseNotes: mobileConfig.releaseNotes || '请更新至最新版 App 以获得完整功能支持',
        };
      }

      // 2. 检查是否有新的 UI Bundle 热更新（当前仅 Android Hermes 架构支持原生热更替换）
      if (
        Platform.OS === 'android' &&
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
          bundleHash: mobileConfig.bundleHash || undefined,
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
   * 下载并解压安装 Zip 热更包（支持进度监听与 MD5 完整性哈希校验）
   */
  async downloadAndApply(
    zipUrl: string,
    targetVersion: string,
    expectedHash?: string,
    onProgress?: DownloadProgressCallback
  ): Promise<boolean> {
    let subscription: any = null;

    if (onProgress && otaEventEmitter) {
      subscription = otaEventEmitter.addListener('onOtaDownloadProgress', (data: any) => {
        onProgress(data.percent || 0, data.receivedBytes, data.totalBytes);
      });
    }

    try {
      if (Platform.OS === 'android' && NativeOta?.downloadAndApplyBundle) {
        await NativeOta.downloadAndApplyBundle(zipUrl, targetVersion, expectedHash || null);
        await AsyncStorage.setItem(STORAGE_KEY_OTA_VERSION, targetVersion);
        return true;
      }
      if (Platform.OS !== 'android') {
        console.warn('[OTA] 非 Android 平台跳过原生热更包安装');
        return false;
      }
      await AsyncStorage.setItem(STORAGE_KEY_OTA_VERSION, targetVersion);
      return true;
    } catch (e: any) {
      console.warn('[OTA] 下载/解压热更包失败:', e);
      throw e;
    } finally {
      if (subscription) {
        subscription.remove();
      }
    }
  }

  /**
   * 应用内下载全量 APK 安装包并自动调起系统安装器
   */
  async downloadAndInstallApk(
    apkUrl: string,
    onProgress?: DownloadProgressCallback
  ): Promise<boolean> {
    if (Platform.OS !== 'android' || !NativeOta?.downloadAndInstallApk) {
      throw new Error('当前平台不支持应用内静默安装 APK');
    }

    let subscription: any = null;

    if (onProgress && otaEventEmitter) {
      subscription = otaEventEmitter.addListener('onApkDownloadProgress', (data: any) => {
        onProgress(data.percent || 0, data.receivedBytes, data.totalBytes);
      });
    }

    try {
      await NativeOta.downloadAndInstallApk(apkUrl);
      return true;
    } catch (e: any) {
      console.warn('[OTA] APK 下载/拉起安装失败:', e);
      throw e;
    } finally {
      if (subscription) {
        subscription.remove();
      }
    }
  }

  /**
   * 手动重新调起已下载 APK 的系统安装器
   */
  async installExistingApk(): Promise<boolean> {
    if (Platform.OS === 'android' && NativeOta?.installExistingApk) {
      await NativeOta.installExistingApk();
      return true;
    }
    return false;
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
