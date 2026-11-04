import { create } from 'zustand';
import { type RegistrationTarget, type RegistrationImage, isRegistrationImage } from '@yiqikan/shared';
import { resolveWebUrl } from './environment';

type Pending = { target: RegistrationTarget; origin: string; resolve(token: string): void; reject(error: Error): void };
export const useRegistrationVerification = create<{ pending: Pending | null }>(() => ({ pending: null }));
let queue: Promise<unknown> = Promise.resolve();
export function requestRegistrationVerification(target: RegistrationTarget): Promise<string> {
  const origin = resolveWebUrl();
  const result = queue.then(() => new Promise<string>((resolve, reject) => {
    useRegistrationVerification.setState({ pending: { target, origin, resolve, reject } });
  }));
  queue = result.then(() => undefined, () => undefined);
  return result;
}
export function finishRegistrationVerification(token?: string) {
  const pending = useRegistrationVerification.getState().pending;
  useRegistrationVerification.setState({ pending: null });
  if (token) pending?.resolve(token);
  else pending?.reject(Object.assign(new Error('已取消注册验证，可稍后重试'), { code: 'VERIFICATION_CANCELLED' }));
}
async function request(action: string, body: unknown, pending: Pending) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${pending.origin}/api/registration-verification/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
    });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || '验证服务暂不可用'); return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('验证请求超时，请重试');
    if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试');
    throw error;
  } finally { clearTimeout(timeout); }
}
export async function loadRegistrationImage(pending: Pending): Promise<RegistrationImage> {
  const image = await request('image', { target: pending.target }, pending);
  if (!isRegistrationImage(image)) throw new Error('验证图片响应无效，请重试'); return image;
}
export async function solveRegistrationImage(pending: Pending, challengeId: string, answer: string): Promise<string> {
  const result = await request('solve', { target: pending.target, challengeId, answer }, pending);
  if (typeof result.verificationToken !== 'string' || !/^[a-f0-9]{64}$/.test(result.verificationToken)) throw new Error('验证结果无效，请重试');
  return result.verificationToken;
}
