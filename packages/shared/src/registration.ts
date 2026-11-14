export type RegistrationTarget =
  | { kind: 'device'; publicKey: string }
  | { kind: 'email-register'; email: string }
  | { kind: 'email-code'; email: string; purpose: 'register' | 'reset' };

export type RegistrationImage = { challengeId: string; image: string; expiresInSeconds: number };
export const REGISTRATION_VERIFICATION_REQUIRED = 'REGISTRATION_VERIFICATION_REQUIRED';
export const REGISTRATION_GUARDRAILS = {
  networkPerHour: 1000, networkPerMinute: 120,
  challengePerHour: 1000, challengePerMinute: 120, targetChallengesPerMinute: 5,
  challengeSeconds: 300, grantSeconds: 120, answerAttempts: 5,
} as const;

export function isRegistrationImage(value: unknown): value is RegistrationImage {
  const v = value as RegistrationImage;
  return !!v && typeof v.challengeId === 'string' && /^[a-f0-9-]{36}$/.test(v.challengeId) &&
    typeof v.image === 'string' && v.image.length <= 150000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v.image) &&
    Number.isInteger(v.expiresInSeconds) && v.expiresInSeconds > 0 && v.expiresInSeconds <= 300;
}

/** A verification is scoped to one operation; never cache it as an IP bypass. */
export async function withRegistrationVerification<T>(operation: (verificationToken?: string) => Promise<T>,
  target: RegistrationTarget, verify: (target: RegistrationTarget) => Promise<string>): Promise<T> {
  let token: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await operation(token); }
    catch (error) {
      if ((error as { code?: string })?.code !== REGISTRATION_VERIFICATION_REQUIRED || attempt === 2) throw error;
      token = await verify(target);
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('验证结果无效，请重试');
    }
  }
  throw new Error('验证未完成，请重试');
}
