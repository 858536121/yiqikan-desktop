// Server-only. Answers and grant hashes never leave the server.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { consumeRegistrationQuota, type QueryExecutor, type RegistrationQuota } from './registration-quota';
import { REGISTRATION_GUARDRAILS as G, REGISTRATION_VERIFICATION_REQUIRED, type RegistrationTarget } from './registration';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function registrationSubject(target: unknown): string {
  const t = target as RegistrationTarget;
  if (t?.kind === 'device' && typeof t.publicKey === 'string' && /^[A-Za-z0-9+/]{87}=$/.test(t.publicKey))
    return hash(`device:${t.publicKey}`);
  if ((t?.kind === 'email-register' || t?.kind === 'email-code') && typeof t.email === 'string') {
    const email = t.email.trim().toLowerCase();
    if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
      (t.kind !== 'email-code' || ['register', 'reset'].includes(t.purpose)))
      return hash(`${t.kind}:${email}:${t.kind === 'email-code' ? t.purpose : ''}`);
  }
  throw new Error('注册验证目标无效');
}
export const legacyRegistrationSubject = (id: string) => hash(`legacy:${id}`);
export const registrationAnswerHash = (id: string, answer: string) => hash(`${id}:${answer.trim()}`);

export class RegistrationGuardError extends Error {
  readonly status: number;
  constructor(readonly code: string, message: string, readonly quota: RegistrationQuota) {
    super(message); this.status = code === REGISTRATION_VERIFICATION_REQUIRED ? 403 : 429;
  }
}
export class RegistrationLimitError extends RegistrationGuardError {
  get key() { return this.quota.key; }
  get blockedUntil() { return this.quota.expiresAt; }
  get retryAfterSeconds() { return this.quota.retryAfterSeconds; }
  constructor(quota: RegistrationQuota) { super('RATE_LIMITED', `操作过于频繁，请在 ${quota.retryAfterSeconds} 秒后重试`, quota); }
}

/** `db` must be a transaction so grant use and the quota decision commit
 * atomically. Device enrollment shares that transaction; Web email counts one
 * attempt once this guard passes. The configured quota is a verification trigger.
 */
export async function enforceRegistrationGuard(db: QueryExecutor, network: string | undefined,
  config: { limit: number; windowSeconds: number }, subjectHash: string, token?: unknown,
  scope: 'registration' | 'email-code' = 'registration', verifiedAccount = false) {
  const quota = await consumeRegistrationQuota(db, network, config, scope);
  if ((quota.blocked && !verifiedAccount) || token !== undefined) {
    const validToken = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
    const consumed = validToken ? await db.$queryRaw<{ id: string }[]>`
      UPDATE client_registration_verifications SET consumed_at = (statement_timestamp() AT TIME ZONE 'UTC')
      WHERE grant_hash = ${hash(token as string)} AND network_key = ${hash(network || 'unverified')}
        AND subject_hash = ${subjectHash} AND consumed_at IS NULL
        AND verified_at > (statement_timestamp() AT TIME ZONE 'UTC') - ${G.grantSeconds} * INTERVAL '1 second'
        AND expires_at > (statement_timestamp() AT TIME ZONE 'UTC') RETURNING id
    ` : [];
    if (!consumed.length) throw new RegistrationGuardError(REGISTRATION_VERIFICATION_REQUIRED,
      '当前网络注册较集中，请完成一次图片验证后继续；旧版客户端请升级后重试', quota);
  }
  // Wide, separate ceilings protect service capacity even after verification.
  // Different users sharing an exit IP can continue past the soft threshold.
  const hour = await consumeRegistrationQuota(db, network,
    { limit: Math.max(G.networkPerHour, config.limit * 10), windowSeconds: 3600 }, scope === 'registration' ? 'registration-hour' : 'email-code-hour');
  if (hour.blocked) throw new RegistrationLimitError(hour);
  const burst = await consumeRegistrationQuota(db, network,
    { limit: G.networkPerMinute, windowSeconds: 60 }, scope === 'registration' ? 'registration-burst' : 'email-code-burst');
  if (burst.blocked) throw new RegistrationLimitError(burst);
}

/** Call inside a short transaction. Only the image renderer receives answer. */
export async function issueRegistrationImage(db: QueryExecutor, network: string, subjectHash: string) {
  for (const [identity, config, scope] of [
    [network, { limit: G.challengePerHour, windowSeconds: 3600 }, 'verification-hour'],
    [network, { limit: G.challengePerMinute, windowSeconds: 60 }, 'verification-burst'],
    [`${network}:${subjectHash}`, { limit: G.targetChallengesPerMinute, windowSeconds: 60 }, 'verification-target'],
  ] as const) {
    const quota = await consumeRegistrationQuota(db, identity, config, scope);
    if (quota.blocked) throw new RegistrationLimitError(quota);
  }
  const id = randomUUID(), answer = randomInt(100000, 1000000).toString();
  await db.$queryRaw`
    INSERT INTO client_registration_verifications (id, network_key, subject_hash, answer_hash, expires_at)
    VALUES (${id}, ${hash(network)}, ${subjectHash}, ${registrationAnswerHash(id, answer)},
      (statement_timestamp() AT TIME ZONE 'UTC') + ${G.challengeSeconds} * INTERVAL '1 second')
  `;
  return { challengeId: id, answer, expiresInSeconds: G.challengeSeconds };
}

/** Return a failure instead of throwing so wrong-answer counts COMMIT. */
export async function solveRegistrationImage(db: QueryExecutor, network: string, subjectHash: string, id: unknown, answer: unknown) {
  const invalid = { ok: false as const, error: '图片验证未通过或已过期，请重试或换一张' };
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || typeof answer !== 'string' || answer.length > 16) return invalid;
  const [row] = await db.$queryRaw<{ answerHash: string; attempts: number }[]>`
    SELECT answer_hash AS "answerHash", attempts FROM client_registration_verifications
    WHERE id = ${id} AND network_key = ${hash(network)} AND subject_hash = ${subjectHash}
      AND verified_at IS NULL AND attempts < ${G.answerAttempts}
      AND expires_at > (statement_timestamp() AT TIME ZONE 'UTC') FOR UPDATE
  `;
  if (!row) return invalid;
  const expected = Buffer.from(row.answerHash), actual = Buffer.from(registrationAnswerHash(id, answer));
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!matches) {
    await db.$queryRaw`UPDATE client_registration_verifications SET attempts = attempts + 1 WHERE id = ${id}`;
    return invalid;
  }
  const token = randomBytes(32).toString('hex');
  await db.$queryRaw`UPDATE client_registration_verifications
    SET attempts = attempts + 1, grant_hash = ${hash(token)}, verified_at = (statement_timestamp() AT TIME ZONE 'UTC'),
      expires_at = (statement_timestamp() AT TIME ZONE 'UTC') + ${G.grantSeconds} * INTERVAL '1 second' WHERE id = ${id}`;
  return { ok: true as const, verificationToken: token, expiresInSeconds: G.grantSeconds };
}
