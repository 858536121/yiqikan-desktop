import { requireOptionalNativeModule } from 'expo';

export type QqCredential = { accessToken: string; tokenHash: string; deviceSlot: string };

const native = requireOptionalNativeModule<{
  available: boolean;
  authorize: () => Promise<QqCredential | null>;
}>('YiqikanQqAuth');

export const hasQqAuth = Boolean(native?.available);
export const canUseQqLogin = hasQqAuth && process.env.EXPO_PUBLIC_QQ_LOGIN_ENABLED === '1';

export async function authorizeQq(): Promise<QqCredential | null> {
  if (!native?.available) throw new Error('此安装包未集成 QQ 登录');
  const credential = await native.authorize();
  if (!credential) return null;
  if (typeof credential.accessToken !== 'string' || !/^[!-~]{1,1024}$/.test(credential.accessToken) || !/^[a-f0-9]{64}$/.test(credential.tokenHash) ||
      !/^[a-f0-9]{64}$/.test(credential.deviceSlot)) throw new Error('QQ 授权响应无效，请安装新版后重试');
  return credential;
}
