import { NativeModules, Platform } from "react-native";
import type { AccountProof } from "@yiqikan/shared";
import { resolveWebUrl } from "./environment";

const native = NativeModules.YiqikanDeviceAuth as
  | {
      publicKey(origin: string): Promise<string>;
      sign(origin: string, message: string): Promise<string>;
    }
  | undefined;
export const hasDeviceAuthentication = () => Boolean(native);
let session: { userId: string; accessToken: string; expiresAt: number } | null =
  null;
let pendingLogin: Promise<void> | null = null;
async function request(action: string, body: unknown) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${resolveWebUrl()}/api/client-auth/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok)
      throw Object.assign(new Error(data.error || "设备验证失败"), {
        code: data.code,
      });
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
export async function createAccountProof(
  legacyToken: string | null,
  retryExpired = true,
): Promise<{ proof: AccountProof; userId: string; expiresAt: number }> {
  if (!native) throw new Error("请安装支持设备验证的新版客户端");
  const origin = resolveWebUrl();
  const publicKey = await native.publicKey(origin);
  if (!session || session.expiresAt - Date.now() < 60000) {
    if (!pendingLogin)
      pendingLogin = (async () => {
        const challenge = await request("challenge", {
          publicKey,
          purpose: "login",
          ...(legacyToken ? { legacyToken } : {}),
        });
        const signature = await native.sign(origin, challenge.message);
        const value = await request("login", {
          challengeId: challenge.challengeId,
          signature,
          platform: Platform.OS,
        });
        if (
          !Number.isInteger(value.expiresInSeconds) ||
          value.expiresInSeconds < 1 ||
          value.expiresInSeconds > 3600
        )
          throw new Error("验证服务响应无效");
        // Schedule from a relative TTL; a phone with the wrong wall clock must
        // not enter a rapid reauthentication loop.
        session = {
          ...value,
          expiresAt: Date.now() + value.expiresInSeconds * 1000,
        };
      })().finally(() => {
        pendingLogin = null;
      });
    await pendingLogin;
  }
  const active = session!;
  let challenge;
  try {
    challenge = await request("challenge", {
      publicKey,
      purpose: "socket",
      accessToken: active.accessToken,
    });
  } catch (error) {
    if (
      retryExpired &&
      (error as { code?: string }).code === "SESSION_EXPIRED"
    ) {
      session = null;
      return createAccountProof(legacyToken, false);
    }
    throw error;
  }
  return {
    proof: {
      accessToken: active.accessToken,
      challengeId: challenge.challengeId,
      signature: await native.sign(origin, challenge.message),
    },
    userId: active.userId,
    expiresAt: active.expiresAt,
  };
}
export function expireAccountSession() {
  session = null;
}
