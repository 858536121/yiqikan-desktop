import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { isClientAccountSummary, normalizePublicUserId, normalizeSupportCode,
  PROFILE_AVATARS, withRegistrationVerification, type ProfileAvatar, type AccountProof, type ClientAccountSummary, type SupportCodeResult } from "@yiqikan/shared";
import { resolveWebUrl } from "./environment";
import { requestRegistrationVerification } from './registration-verification';

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
export const useAccountProfile = create<{
  summary: ClientAccountSummary | null;
  cached: boolean;
  loading: boolean;
  error: string | null;
}>(() => ({ summary: null, cached: false, loading: false, error: null }));
let profileBinding = "";
let profileLoad: Promise<void> | null = null;
let profileRefresh: Promise<ClientAccountSummary> | null = null;
let supportCodeRequest: Promise<SupportCodeResult> | null = null;
let cacheWrites = Promise.resolve();
const profileCacheKey = () => `@yiqikan_account_profile:${profileBinding}`;
async function bindProfile(origin: string, publicKey: string) {
  const binding = JSON.stringify([origin, publicKey]);
  if (profileBinding === binding) { await profileLoad; return; }
  profileBinding = binding;
  useAccountProfile.setState({ summary: null, cached: false, error: null });
  const cacheKey = profileCacheKey();
  profileLoad = (async () => {
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      const value: unknown = raw ? JSON.parse(raw) : null;
      if (profileBinding === binding && isClientAccountSummary(value))
        useAccountProfile.setState({ summary: value, cached: true });
    } catch { /* Cache never authorizes access or blocks device login. */ }
  })();
  await profileLoad;
}
function saveProfile(value: unknown) {
  if (!isClientAccountSummary(value)) throw new Error("用户编号响应无效，请重试");
  // Copy only public fields, never persist an access token from a login response.
  const summary: ClientAccountSummary = { userId: value.userId, publicId: value.publicId,
    disabled: value.disabled, deviceRevoked: value.deviceRevoked,
    restriction: value.restriction ? { action: value.restriction.action, until: value.restriction.until } : null };
  if (typeof value.nickname === 'string' && value.nickname.length > 0 && value.nickname.length <= 30) summary.nickname = value.nickname;
  if (value.avatarId !== undefined) summary.avatarId = value.avatarId;
  if (value.avatarPath !== undefined) summary.avatarPath = value.avatarPath;
  if (PROFILE_AVATARS.includes(value.avatar!)) summary.avatar = value.avatar;
  if (value.profileUpdatedAt === null || (Number.isSafeInteger(value.profileUpdatedAt) && value.profileUpdatedAt! > 0)) summary.profileUpdatedAt = value.profileUpdatedAt;
  useAccountProfile.setState({ summary, cached: false, error: null });
  const cacheKey = profileCacheKey();
  cacheWrites = cacheWrites.catch(() => {}).then(() => AsyncStorage.setItem(cacheKey, JSON.stringify(summary)));
  void cacheWrites.catch(() => {
    if (profileCacheKey() === cacheKey) useAccountProfile.setState({ error: "编号已获取，本地保存失败；下次打开请联网刷新" });
  });
  return summary;
}
async function request(action: string, body: unknown, avatarEndpoint = false) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${resolveWebUrl()}/api/${avatarEndpoint ? 'client-avatar' : 'client-auth'}/${action}`, {
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
export async function prepareAccountSession(legacyToken: string | null) {
  if (!native) throw new Error("请安装支持设备验证的新版客户端");
  const origin = resolveWebUrl();
  const publicKey = await native.publicKey(origin);
  await bindProfile(origin, publicKey);
  if (!session || session.expiresAt - Date.now() < 60000) {
    if (!pendingLogin)
      pendingLogin = (async () => {
        const value = await withRegistrationVerification(async verificationToken => {
          const challenge = await request("challenge", {
            publicKey,
            purpose: "login",
            ...(legacyToken ? { legacyToken } : {}),
          });
          const signature = await native.sign(origin, challenge.message);
          return request("login", {
            challengeId: challenge.challengeId,
            signature,
            platform: Platform.OS,
            ...(verificationToken ? { verificationToken } : {}),
          });
        }, { kind: 'device', publicKey }, requestRegistrationVerification);
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
        if (typeof value.publicId === "string") {
          try { saveProfile({ userId: value.userId, publicId: value.publicId, disabled: false,
            deviceRevoked: false, restriction: value.restriction ?? null, nickname: value.nickname, avatar: value.avatar, avatarId: value.avatarId, avatarPath: value.avatarPath, profileUpdatedAt: value.profileUpdatedAt }); }
          catch { useAccountProfile.setState({ error: "用户编号暂不可用，请刷新重试" }); }
        }
      })().finally(() => {
        pendingLogin = null;
      });
    await pendingLogin;
  }
  return { origin, publicKey };
}
export async function createAccountProof(
  legacyToken: string | null,
  retryExpired = true,
): Promise<{ proof: AccountProof; userId: string; expiresAt: number }> {
  const { origin, publicKey } = await prepareAccountSession(legacyToken);
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
      signature: await native!.sign(origin, challenge.message),
    },
    userId: active.userId,
    expiresAt: active.expiresAt,
  };
}
export function expireAccountSession() {
  session = null;
}

async function existingDeviceChallenge(purpose: 'support' | 'support-code' | 'account', legacyToken: string | null, context?: string) {
  if (!native) throw new Error('请更新安装包后使用账号核验');
  const origin = resolveWebUrl();
  const publicKey = await native.publicKey(origin);
  await bindProfile(origin, publicKey);
  let challenge;
  try { challenge = await request('challenge', { publicKey, purpose, ...(context ? { context } : {}) }); }
  catch (error) {
    if ((error as { code?: string }).code !== 'NOT_ENROLLED') throw error;
    try { await createAccountProof(legacyToken); }
    catch (loginError) {
      // Legacy restrictions may be migrated after device enrollment commits.
      if ((loginError as { code?: string }).code !== 'CONTENT_RESTRICTED') throw loginError;
    }
    challenge = await request('challenge', { publicKey, purpose, ...(context ? { context } : {}) });
  }
  return { origin, challenge };
}

/** The signed challenge binds the exact request contents, not a caller-selected account. */
export async function accountDeviceRequest(payload: Record<string, unknown>) {
  const context = JSON.stringify(payload);
  const legacyToken = await AsyncStorage.getItem('@yiqikan_safety_token');
  const { origin, challenge } = await existingDeviceChallenge('account', legacyToken, context);
  return request('account', { challengeId: challenge.challengeId, signature: await native!.sign(origin, challenge.message), context });
}
export async function saveAccountProfile(nickname: string, avatar: ProfileAvatar, avatarId?: string | null) {
  return saveProfile(await accountDeviceRequest({ operation: 'profile', nickname, avatar, ...(avatarId !== undefined ? {avatarId} : {}) }));
}

/** Secret stays only in the caller's short-lived UI state, never in profile cache. */
export async function generateSupportCode(legacyToken: string | null = null): Promise<SupportCodeResult> {
  if (supportCodeRequest) return supportCodeRequest;
  supportCodeRequest = (async () => {
    const { origin, challenge } = await existingDeviceChallenge('support-code', legacyToken);
    const value = await request('support-code', { challengeId: challenge.challengeId,
      signature: await native!.sign(origin, challenge.message) });
    if (!value || typeof value.userId !== 'string' || !value.userId || value.userId.length > 128 ||
      typeof value.publicId !== 'string' || normalizePublicUserId(value.publicId) !== value.publicId ||
      typeof value.code !== 'string' || !normalizeSupportCode(value.code) ||
      !Number.isInteger(value.expiresInSeconds) || value.expiresInSeconds < 1 || value.expiresInSeconds > 300)
      throw new Error('核验码响应无效，请重试');
    return { userId: value.userId, publicId: value.publicId, code: value.code,
      expiresInSeconds: value.expiresInSeconds, expiresAt: Date.now() + value.expiresInSeconds * 1000 };
  })().finally(() => { supportCodeRequest = null; });
  return supportCodeRequest;
}

/** Works without a room connection or active session, even after a ban. */
export async function refreshAccountProfile(legacyToken: string | null = null): Promise<ClientAccountSummary> {
  if (profileRefresh) return profileRefresh;
  profileRefresh = (async () => {
    useAccountProfile.setState({ loading: true, error: null });
    try {
      const { origin, challenge } = await existingDeviceChallenge('support', legacyToken);
      const value = await request("support", {
        challengeId: challenge.challengeId,
        signature: await native!.sign(origin, challenge.message),
      });
      return saveProfile(value);
    } catch (error) {
      useAccountProfile.setState({ cached: Boolean(useAccountProfile.getState().summary),
        error: error instanceof Error ? error.message : "用户编号暂不可用，请联网重试" });
      throw error;
    } finally { useAccountProfile.setState({ loading: false }); }
  })().finally(() => { profileRefresh = null; });
  return profileRefresh;
}

export async function uploadProfileAvatar(image: string, requestId: string) {
  if (!native || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 262144) throw new Error('请选择有效头像');
  const origin=resolveWebUrl(),publicKey=await native.publicKey(origin);
  await bindProfile(origin,publicKey);
  // Profile is opened through the existing identity lookup, which enrolls new devices.
  const context=JSON.stringify({operation:'avatar-upload',requestId,image});
  const challenge=await request('challenge',{publicKey,context},true);
  const result=await request('save',{context,challengeId:challenge.challengeId,signature:await native.sign(origin,challenge.message)},true);
  if(!result || typeof result.avatarId!=='string' || !/^[a-f0-9-]{36}$/.test(result.avatarId) || result.avatarPath!==`/api/client-avatar/image/${result.avatarId}`)throw new Error('头像响应无效，请重试');
  return result as {avatarId:string;avatarPath:string};
}
