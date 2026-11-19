import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { isClientAccountSummary, normalizePublicUserId, normalizeSupportCode,
  PROFILE_AVATARS, withRegistrationVerification, type ProfileAvatar, type AccountProof, type ClientAccountSummary, type SupportCodeResult } from "@yiqikan/shared";
import { resolveWebUrl } from "./environment";
import { requestRegistrationVerification } from './registration-verification';
import type { QqAccountIntent, QqProfilePreview } from '@yiqikan/shared/qq-login';
import type { QqCredential } from './qq-auth';

const native = NativeModules.YiqikanDeviceAuth as
  | {
      publicKey(origin: string): Promise<string>;
      sign(origin: string, message: string): Promise<string>;
    }
  | undefined;
export const hasDeviceAuthentication = () => Boolean(native);
let session: { scope: string; userId: string; accessToken: string; expiresAt: number } | null =
  null;
const pendingLogins = new Map<string, Promise<void>>();
const deviceSlots = new Map<string, Promise<string | null>>();
export const useAccountProfile = create<{
  summary: ClientAccountSummary | null;
  cached: boolean;
  loading: boolean;
  error: string | null;
  canReturnFromAccount: boolean;
}>(() => ({ summary: null, cached: false, loading: false, error: null, canReturnFromAccount: false }));
let profileBinding = "";
let profileLoad: Promise<void> | null = null;
let profileRefresh: Promise<ClientAccountSummary> | null = null;
let guestTransition: Promise<void> | null = null;
let supportCodeRequest: Promise<SupportCodeResult> | null = null;
let cacheWrites = Promise.resolve();
export const USERNAME_CACHE_KEY = '@yiqikan_username';
const RANDOM_ADJECTIVES = ['快乐的', '调皮的', '机智的', '爱看剧的', '熬夜的', '闪光的', '摸鱼的', '元气的', '神秘的', '奔跑的', '可爱的', '酷酷的'];
const RANDOM_NOUNS = ['小恐龙', '小海獭', '爆米花', '小柯基', '大熊猫', '独角兽', '小浣熊', '旅行者', '向日葵', '星际猫', '小企鹅', '小考拉'];
let defaultNickname: string | null = null;

/** A saved profile wins over legacy room input; first use never requires a name form. */
export async function getRoomEntryName(): Promise<string> {
  await profileLoad;
  const profileName = () => {
    const { summary, canReturnFromAccount } = useAccountProfile.getState();
    return canReturnFromAccount ? summary?.nickname?.trim() || '影迷'
      : summary?.profileUpdatedAt ? summary.nickname?.trim() : undefined;
  };
  if (profileName()) return profileName()!;
  let cached: string | null = null;
  try { cached = await AsyncStorage.getItem(USERNAME_CACHE_KEY); } catch {}
  // The account may finish loading while storage is being read.
  if (profileName()) return profileName()!;
  if (cached?.trim()) return cached.trim();
  defaultNickname ??= `${RANDOM_ADJECTIVES[Math.floor(Math.random() * RANDOM_ADJECTIVES.length)]}${RANDOM_NOUNS[Math.floor(Math.random() * RANDOM_NOUNS.length)]}`;
  try { await AsyncStorage.setItem(USERNAME_CACHE_KEY, defaultNickname); } catch {}
  return profileName() || defaultNickname;
}

const profileCacheKey = () => `@yiqikan_account_profile:${profileBinding}`;
const slotStorageKey = (origin: string) => `@yiqikan_account_slot:${origin}`;
const guestSlotStorageKey = (origin: string) => `@yiqikan_guest_slot:${origin}`;
const isGuestSlot = (slot: string | null) => slot?.startsWith('guest:') === true;
const isSignedInSlot = (slot: string | null) => Boolean(slot) && !isGuestSlot(slot);
const keyScope = (origin: string, slot: string | null) => !slot ? origin
  : slot.includes(':') ? `${origin}#${slot}` : `${origin}#qq:${slot}`;
function activeDeviceSlot(origin: string) {
  let slot = deviceSlots.get(origin);
  if (!slot) {
    slot = AsyncStorage.getItem(slotStorageKey(origin)).then(value => value && /^(?:(?:email:)?[a-f0-9]{64}|guest:[a-z0-9]{8,40})$/.test(value) ? value : null);
    deviceSlots.set(origin, slot);
    void slot.catch(() => { if (deviceSlots.get(origin) === slot) deviceSlots.delete(origin); });
  }
  return slot;
}

async function currentDevice() {
  if (!native) throw new Error('请安装支持设备验证的新版客户端');
  const origin = resolveWebUrl();
  const slot = await activeDeviceSlot(origin);
  const scope = keyScope(origin, slot);
  const publicKey = await native.publicKey(scope);
  if (slot !== await activeDeviceSlot(origin)) throw new Error('当前账号已切换，请重试');
  await bindProfile(origin, publicKey);
  if (slot === await activeDeviceSlot(origin)) useAccountProfile.setState({ canReturnFromAccount: isSignedInSlot(slot) });
  return { origin, scope, publicKey, binding: JSON.stringify([origin, publicKey]), slot };
}

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
  if (value.profileEditable !== undefined) summary.profileEditable = value.profileEditable;
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
async function request(action: string, body: unknown, service: 'client-auth' | 'client-avatar' | 'auth' = 'client-auth', bearer?: string) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), action === 'qq' || action === 'send-code' ? 20000 : 10000);
  try {
    const res = await fetch(`${resolveWebUrl()}/api/${service}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok)
      throw Object.assign(new Error(data.error || "设备验证失败"), {
        code: data.code,
        retryAfterSeconds: data.retryAfterSeconds,
      });
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
export async function prepareAccountSession(legacyToken: string | null) {
  const identity = await currentDevice();
  const { origin, scope, publicKey, binding, slot } = identity;
  if (!session || session.scope !== scope || session.expiresAt - Date.now() < 60000) {
    let pending = pendingLogins.get(scope);
    if (!pending) {
      pending = (async () => {
        const value = await withRegistrationVerification(async verificationToken => {
          const challenge = await request("challenge", {
            publicKey,
            purpose: "login",
            ...(isSignedInSlot(slot) ? { context: 'existing-device' } : !slot && legacyToken ? { legacyToken } : {}),
          });
          const signature = await native!.sign(scope, challenge.message);
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
        if (slot !== await activeDeviceSlot(origin) || binding !== profileBinding) return;
        session = {
          ...value,
          scope,
          expiresAt: Date.now() + value.expiresInSeconds * 1000,
        };
        if (typeof value.publicId === "string") {
          try { saveProfile({ userId: value.userId, publicId: value.publicId, disabled: false,
            deviceRevoked: false, restriction: value.restriction ?? null, nickname: value.nickname, avatar: value.avatar, avatarId: value.avatarId, avatarPath: value.avatarPath, profileUpdatedAt: value.profileUpdatedAt, profileEditable: value.profileEditable }); }
          catch { useAccountProfile.setState({ error: "用户编号暂不可用，请刷新重试" }); }
        }
      })().finally(() => {
        pendingLogins.delete(scope);
      });
      pendingLogins.set(scope, pending);
    }
    try { await pending; }
    catch (error) {
      if (codeOf(error) === 'REAUTH_REQUIRED') await recoverGuestDevice(identity);
      throw error;
    }
  }
  return identity;
}
export async function createAccountProof(
  legacyToken: string | null,
  retryExpired = true,
): Promise<{ proof: AccountProof; userId: string; expiresAt: number }> {
  const { origin, scope, publicKey, slot } = await prepareAccountSession(legacyToken);
  const active = session;
  if (!active || active.scope !== scope || slot !== await activeDeviceSlot(origin)) throw new Error('当前账号已切换，请重试');
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
      if (session === active) session = null;
      return createAccountProof(legacyToken, false);
    }
    throw error;
  }
  return {
    proof: {
      accessToken: active.accessToken,
      challengeId: challenge.challengeId,
      signature: await native!.sign(scope, challenge.message),
    },
    userId: active.userId,
    expiresAt: active.expiresAt,
  };
}
export function expireAccountSession() {
  session = null;
}

async function existingDeviceChallenge(purpose: 'support' | 'support-code' | 'account', legacyToken: string | null, context?: string) {
  const identity = await currentDevice();
  const { publicKey } = identity;
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
  return { ...identity, challenge };
}

/** The signed challenge binds the exact request contents, not a caller-selected account. */
export async function accountDeviceRequest(payload: Record<string, unknown>) {
  const context = JSON.stringify(payload);
  const legacyToken = await AsyncStorage.getItem('@yiqikan_safety_token');
  const { scope, binding, slot, origin, challenge } = await existingDeviceChallenge('account', legacyToken, context);
  const result = await request('account', { challengeId: challenge.challengeId, signature: await native!.sign(scope, challenge.message), context });
  if (binding !== profileBinding || slot !== await activeDeviceSlot(origin)) throw new Error('当前账号已切换，请重试');
  return result;
}

async function activateDeviceSlot(origin: string, slot: string | null, publicKey: string) {
  if (slot) await AsyncStorage.setItem(slotStorageKey(origin), slot);
  else await AsyncStorage.removeItem(slotStorageKey(origin));
  deviceSlots.set(origin, Promise.resolve(slot));
  useAccountProfile.setState({ canReturnFromAccount: isSignedInSlot(slot) });
  expireAccountSession();
  await bindProfile(origin, publicKey);
}

async function switchDeviceSlot(origin: string, slot: string | null, publicKey: string, value: unknown) {
  if (!isClientAccountSummary(value)) throw new Error('账号响应无效，请重试');
  await activateDeviceSlot(origin, slot, publicKey);
  return saveProfile(value);
}

function codeOf(error: unknown) {
  return (error as { code?: string } | null)?.code;
}

function assertSecureSignIn(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' && (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'))
    throw new Error('账号登录需要 HTTPS 连接');
}

async function guestProfileProof(current: Awaited<ReturnType<typeof currentDevice>>, targetPublicKey: string) {
  if (isSignedInSlot(current.slot) || current.publicKey === targetPublicKey || useAccountProfile.getState().summary?.profileEditable === true) return;
  const context = JSON.stringify({ operation: 'import-guest-profile', targetPublicKey });
  try {
    const challenge = await request('challenge', { publicKey: current.publicKey, purpose: 'account', context });
    return { challengeId: challenge.challengeId, signature: await native!.sign(current.scope, challenge.message) };
  } catch (error) {
    if (codeOf(error) !== 'NOT_ENROLLED') throw error;
  }
}

export async function signInWithQq(credential: QqCredential) {
  if (!native) throw new Error('请安装支持设备验证的新版客户端');
  const current = await currentDevice();
  assertSecureSignIn(current.origin);
  const submit = async (intent: QqAccountIntent) => {
    const scope = intent === 'bind' ? current.scope : keyScope(current.origin, credential.deviceSlot);
    const publicKey = scope === current.scope ? current.publicKey : await native.publicKey(scope);
    const exchange = async (verificationToken?: string) => {
      const guestProof = intent === 'login' ? await guestProfileProof(current, publicKey) : undefined;
      const challenge = await request('challenge', { publicKey, purpose: `qq-${intent}`, context: credential.tokenHash });
      const signature = await native!.sign(scope, challenge.message);
      return request('qq', { intent, challengeId: challenge.challengeId, signature, platform: Platform.OS, guestProof,
        ...(verificationToken ? { verificationToken } : {}) }, 'client-auth', credential.accessToken);
    };
    const result = intent === 'login' ? await withRegistrationVerification(exchange, { kind: 'device', publicKey }, requestRegistrationVerification)
      : await exchange();
    if (current.slot !== await activeDeviceSlot(current.origin)) throw new Error('本机账号已切换，请重试');
    const sameAccount = result.userId === useAccountProfile.getState().summary?.userId;
    const switched = intent === 'login' && scope !== current.scope && !sameAccount;
    const account = switched ? await switchDeviceSlot(current.origin, credential.deviceSlot, publicKey, result) : saveProfile(result);
    const { nickname, avatarUrl, grant } = result.qqProfile ?? {};
    const preview: QqProfilePreview | null = typeof grant === 'string' && grant.length <= 5000 ? { grant } : null;
    if (preview && typeof nickname === 'string' && nickname.trim() && nickname.length <= 30) preview.nickname = nickname;
    if (preview && typeof avatarUrl === 'string' && avatarUrl.startsWith('https://') && avatarUrl.length <= 2048) preview.avatarUrl = avatarUrl;
    return { switched, account, qqProfile: preview && (preview.nickname || preview.avatarUrl) ? preview : null };
  };
  try { return await submit('login'); }
  catch (error) { if (codeOf(error) !== 'QQ_NOT_LINKED') throw error; }
  const legacyToken = await AsyncStorage.getItem('@yiqikan_safety_token');
  await prepareAccountSession(legacyToken);
  if (current.slot !== await activeDeviceSlot(current.origin)) throw new Error('本机账号已切换，请重试');
  try { return await submit('bind'); }
  catch (error) {
    if (codeOf(error) === 'QQ_ALREADY_LINKED') return submit('login');
    throw error;
  }
}

export async function loadEmailLoginCaptcha(): Promise<{ token: string; image: string }> {
  const origin = resolveWebUrl();
  assertSecureSignIn(origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${origin}/api/auth/captcha`, { cache: 'no-store', signal: controller.signal });
    const { token, image } = await response.json();
    if (!response.ok || typeof token !== 'string' || typeof image !== 'string' || !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(image))
      throw new Error('验证码暂不可用，请重试');
    return { token, image };
  } finally { clearTimeout(timeout); }
}

export type EmailCodePurpose = 'register' | 'reset';

export async function sendEmailAccountCode(input: { email: string; purpose: EmailCodePurpose; captchaToken: string; captchaAnswer: string }) {
  assertSecureSignIn(resolveWebUrl());
  const email = input.email.trim().toLowerCase();
  return withRegistrationVerification(verificationToken => request('send-code', { ...input, email, verificationToken }, 'auth'),
    { kind: 'email-code', email, purpose: input.purpose }, requestRegistrationVerification);
}

export async function completeEmailAccountAction(purpose: EmailCodePurpose, input: { email: string; password: string; code: string }) {
  assertSecureSignIn(resolveWebUrl());
  const email = input.email.trim().toLowerCase();
  if (purpose === 'reset') return request('reset-password', { ...input, email }, 'auth');
  return withRegistrationVerification(verificationToken => request('register', {
    ...input, email, nickname: '影迷', createSession: false, verificationToken,
  }, 'auth'), { kind: 'email-register', email }, requestRegistrationVerification);
}

export async function signInWithEmail(input: { email: string; password: string; captchaToken: string; captchaAnswer: string }) {
  if (!native) throw new Error('请安装支持设备验证的新版客户端');
  const current = await currentDevice();
  assertSecureSignIn(current.origin);
  const email = input.email.trim().toLowerCase();
  const slot = `email:${bytesToHex(sha256(utf8ToBytes(email)))}`;
  const scope = keyScope(current.origin, slot);
  const publicKey = await native.publicKey(scope);
  const guestProof = await guestProfileProof(current, publicKey);
  const challenge = await request('email', { ...input, email, phase: 'challenge', publicKey });
  const signature = await native.sign(scope, challenge.message);
  const result = await request('email', { phase: 'complete', challengeId: challenge.challengeId, signature, platform: Platform.OS, guestProof });
  if (current.slot !== await activeDeviceSlot(current.origin)) throw new Error('本机账号已切换，请重试');
  return switchDeviceSlot(current.origin, slot, publicKey, result);
}

type ActiveDevice = Awaited<ReturnType<typeof currentDevice>>;

async function findGuestDevice(current: ActiveDevice) {
  const saved = await AsyncStorage.getItem(guestSlotStorageKey(current.origin));
  const guestSlot = saved && /^guest:[a-z0-9]{8,40}$/.test(saved) ? saved : null;
  if (guestSlot !== current.slot) {
    const scope = keyScope(current.origin, guestSlot);
    const publicKey = await native!.publicKey(scope);
    try {
      const challenge = await request('challenge', { publicKey, purpose: 'support' });
      const value = await request('support', { challengeId: challenge.challengeId, signature: await native!.sign(scope, challenge.message) });
      if (isClientAccountSummary(value) && value.profileEditable !== true)
        return { slot: guestSlot, publicKey, summary: value, fresh: false };
    } catch (error) {
      if (codeOf(error) === 'NOT_ENROLLED') return { slot: guestSlot, publicKey, summary: null, fresh: false };
      if (codeOf(error) !== 'REAUTH_REQUIRED') throw error;
    }
  }
  const slot = `guest:${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return { slot, publicKey: await native!.publicKey(keyScope(current.origin, slot)), summary: null, fresh: true };
}

function transitionToGuest(current: ActiveDevice, revokeCurrent: boolean) {
  if (guestTransition) return guestTransition;
  guestTransition = (async () => {
    if (current.slot !== await activeDeviceSlot(current.origin)) return;
    const guest = await findGuestDevice(current);
    if (revokeCurrent) {
      const context = JSON.stringify({ operation: 'sign-out' });
      const challenge = await request('challenge', { publicKey: current.publicKey, purpose: 'account', context });
      const signature = await native!.sign(current.scope, challenge.message);
      const result = await request('account', { challengeId: challenge.challengeId, signature, context });
      if (result.signedOut !== true) throw new Error('退出未完成，请重试');
    }
    if (current.slot !== await activeDeviceSlot(current.origin)) return;
    if (guest.fresh) {
      await AsyncStorage.setItem(guestSlotStorageKey(current.origin), guest.slot!);
      defaultNickname = null;
    }
    if (guest.fresh || !guest.summary) await AsyncStorage.removeItem(USERNAME_CACHE_KEY);
    await activateDeviceSlot(current.origin, guest.slot, guest.publicKey);
    if (guest.summary) saveProfile(guest.summary);
  })().finally(() => { guestTransition = null; });
  return guestTransition;
}

async function recoverGuestDevice(current: ActiveDevice) {
  if (current.slot !== await activeDeviceSlot(current.origin)) return;
  expireAccountSession();
  useAccountProfile.setState({ summary: null, cached: false });
  return transitionToGuest(current, false);
}

export async function signOutAccount() {
  await transitionToGuest(await currentDevice(), true);
  void refreshAccountProfile().catch(() => {});
}

export async function saveAccountProfile(nickname: string, avatar: ProfileAvatar, avatarId?: string | null) {
  return saveProfile(await accountDeviceRequest({ operation: 'profile', nickname, avatar, ...(avatarId !== undefined ? {avatarId} : {}) }));
}

export async function importQqProfile(grant: string, displayName: string) {
  return saveProfile(await accountDeviceRequest({ operation: 'qq-profile', grant, displayName }));
}

/** Secret stays only in the caller's short-lived UI state, never in profile cache. */
export async function generateSupportCode(legacyToken: string | null = null): Promise<SupportCodeResult> {
  if (supportCodeRequest) return supportCodeRequest;
  supportCodeRequest = (async () => {
    const { scope, challenge } = await existingDeviceChallenge('support-code', legacyToken);
    const value = await request('support-code', { challengeId: challenge.challengeId,
      signature: await native!.sign(scope, challenge.message) });
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
      let current: ActiveDevice | null = null;
      const read = async (token: string | null) => {
        const identity = await existingDeviceChallenge('support', token);
        current = identity;
        const value = await request('support', { challengeId: identity.challenge.challengeId, signature: await native!.sign(identity.scope, identity.challenge.message) });
        if (identity.binding !== profileBinding) throw new Error('当前账号已切换，请重试');
        return saveProfile(value);
      };
      try { return await read(legacyToken); }
      catch (error) {
        if (codeOf(error) !== 'REAUTH_REQUIRED') throw error;
        await recoverGuestDevice(current ?? await currentDevice());
        return await read(null);
      }
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
  const { scope, publicKey } = await currentDevice();
  // Profile is opened through the existing identity lookup, which enrolls new devices.
  const context=JSON.stringify({operation:'avatar-upload',requestId,image});
  const challenge=await request('challenge',{publicKey,context},'client-avatar');
  const result=await request('save',{context,challengeId:challenge.challengeId,signature:await native.sign(scope,challenge.message)},'client-avatar');
  if(!result || typeof result.avatarId!=='string' || !/^[a-f0-9-]{36}$/.test(result.avatarId) || result.avatarPath!==`/api/client-avatar/image/${result.avatarId}`)throw new Error('头像响应无效，请重试');
  return result as {avatarId:string;avatarPath:string};
}
