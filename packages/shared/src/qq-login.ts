const QQ_IDENTITY_URL = "https://graph.qq.com/oauth2.0/me";
export const QQ_APP_ID = "1112545470";
export type QqAccountIntent = 'bind' | 'login';
export type QqProfile = { nickname?: string; avatarUrl?: string };
export type QqProfilePreview = QqProfile & { grant: string };

const qqAvatarHosts = new Set(['q.qlogo.cn', 'qq.qlogo.cn', 'thirdqq.qlogo.cn']);
export function normalizeQqAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !qqAvatarHosts.has(url.hostname) || url.port || url.username || url.password) return null;
    url.protocol = 'https:';
    url.hash = '';
    return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}

export class QqVerificationUnavailable extends Error {}

// A null result means Tencent rejected the token or it belongs to another app.
export async function verifyQqAccessToken(accessToken: string): Promise<string | null> {
  if (!/^[!-~]{1,1024}$/.test(accessToken)) return null;

  const url = new URL(QQ_IDENTITY_URL);
  url.searchParams.set("access_token", accessToken);

  let responseBody: string;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new QqVerificationUnavailable();
    responseBody = await response.text();
  } catch {
    // The URL contains a credential. Do not attach the original fetch error.
    throw new QqVerificationUnavailable("QQ identity service unavailable");
  }

  const json = /^callback\s*\(\s*([\s\S]*?)\s*\)\s*;?$/.exec(responseBody.trim())?.[1] ?? responseBody;
  let identity: unknown;
  try {
    identity = JSON.parse(json);
  } catch {
    throw new QqVerificationUnavailable("Invalid response from QQ identity service");
  }

  if (!identity || typeof identity !== "object") {
    throw new QqVerificationUnavailable("Invalid response from QQ identity service");
  }
  if ("error" in identity) return null;
  if (!("client_id" in identity) || String(identity.client_id) !== QQ_APP_ID) return null;
  if (!("openid" in identity) || typeof identity.openid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.openid)) return null;
  return identity.openid;
}
