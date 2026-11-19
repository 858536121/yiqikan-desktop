import { authorizeQq, hasQqAuth } from './qq-auth';

const baseUrl = process.env.EXPO_PUBLIC_QQ_LOGIN_PROBE_URL;

function resolveProbeUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')) return null;
    return new URL('/api/client-auth/qq-probe', url.origin).toString();
  } catch {
    return null;
  }
}

const probeUrl = resolveProbeUrl(baseUrl);
export const canRunQqLoginProbe = Boolean(hasQqAuth && probeUrl);

export async function runQqLoginProbe(): Promise<string | null> {
  if (!hasQqAuth || !probeUrl) throw new Error('此版本未配置 QQ 登录联调');
  const credential = await authorizeQq();
  if (!credential) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(probeUrl, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${credential.accessToken}` },
    });
    if (response.status === 404) throw new Error('联调服务器未开启 QQ 校验');
    if (response.status === 401) throw new Error('腾讯未认可此授权');
    if (!response.ok) throw new Error('QQ 身份校验暂不可用');
    const result = await response.json();
    if (typeof result.fingerprint !== 'string' || !/^[a-f0-9]{16}$/.test(result.fingerprint)) {
      throw new Error('联调服务器响应无效');
    }
    return result.fingerprint;
  } finally {
    clearTimeout(timeout);
  }
}
