import { Linking, Platform } from 'react-native';
import { normalizeAppStoreUrl } from '@yiqikan/shared';

export async function openAppUpdate(downloadUrl?: string) {
  const url = Platform.OS === 'ios' ? normalizeAppStoreUrl(downloadUrl) : downloadUrl;
  if (!url) throw new Error(Platform.OS === 'ios'
    ? '暂时无法打开 App Store，请稍后重试。' : '暂时无法获取更新地址，请稍后重试。');
  try {
    await Linking.openURL(url);
  } catch {
    throw new Error(Platform.OS === 'ios'
      ? '无法打开 App Store，请稍后重试。' : '无法打开更新页面，请稍后重试。');
  }
}
