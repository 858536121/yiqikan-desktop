import { Platform } from 'react-native';
import Constants from 'expo-constants';

export const PROD_WEB_URL = 'https://yiqikan.club';
export const PROD_SERVER_URL = 'https://yiqikan.club';

/**
 * 提取当前 Metro 调试主机的局域网 IP（例如 192.168.x.x 或 10.x.x.x）
 */
function getDevHostIp(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoClient?.hostUri ||
    (Constants as any).manifest?.debuggerHost;

  if (hostUri && typeof hostUri === 'string') {
    const ip = hostUri.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return ip;
    }
  }
  return null;
}

/**
 * 解析实时 WebSocket 协同服务地址
 * - 生产包: https://yiqikan.club
 * - 显式环境变量: EXPO_PUBLIC_SERVER_URL
 * - 本地开发/模拟器: 自动读取 Metro 宿主机 IP -> http://${ip}:8787
 */
export function resolveServerUrl(): string {
  if (process.env.EXPO_PUBLIC_SERVER_URL) {
    return process.env.EXPO_PUBLIC_SERVER_URL.replace(/\/+$/, '');
  }

  if (__DEV__) {
    const devIp = getDevHostIp();
    if (devIp) {
      return `http://${devIp}:8787`;
    }
    // 降级：Android 模拟器 10.0.2.2 对应电脑宿主机，iOS 模拟器可用 localhost
    return Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://localhost:8787';
  }

  return PROD_SERVER_URL;
}

/**
 * 解析 Web / API 服务基准地址
 * - 生产包: https://yiqikan.club
 * - 显式环境变量: EXPO_PUBLIC_WEB_URL
 * - 本地开发/模拟器: 自动读取 Metro 宿主机 IP -> http://${ip}:3103
 */
export function resolveWebUrl(): string {
  if (process.env.EXPO_PUBLIC_WEB_URL) {
    return process.env.EXPO_PUBLIC_WEB_URL.replace(/\/+$/, '');
  }

  if (__DEV__) {
    const devIp = getDevHostIp();
    if (devIp) {
      return `http://${devIp}:3103`;
    }
    return Platform.OS === 'android' ? 'http://10.0.2.2:3103' : 'http://localhost:3103';
  }

  return PROD_WEB_URL;
}

/**
 * 是否启用埋点与心跳
 * - 本地开发/模拟器模式下强制静音，严禁向生产库打入心跳或脏数据
 * - 仅在生产正式包或显式设置了 EXPO_PUBLIC_ENABLE_DEV_TELEMETRY 时开启
 */
export function isTelemetryEnabled(): boolean {
  if (__DEV__) {
    return Boolean(process.env.EXPO_PUBLIC_ENABLE_DEV_TELEMETRY);
  }
  return true;
}
