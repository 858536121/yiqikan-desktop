// Server-only PostgreSQL accounting shared by Web and realtime registration.
import { createHash } from 'node:crypto';

export type QueryExecutor = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
};
type ExecuteExecutor = {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
};
export type RegistrationQuota = { key: string; count: number; expiresAt: Date; retryAfterSeconds: number; blocked: boolean };

/** Inside a transaction, quota commits with enrollment. Without a surrounding
 * transaction, this counts attempts (used for email verification/registration).
 * `email-code` is an independent quota so sending a code doesn't spend a signup.
 */
export async function consumeRegistrationQuota(db: QueryExecutor, network: string | undefined,
  config: { limit: number; windowSeconds: number }, scope: 'registration' | 'email-code' | 'registration-hour' | 'registration-burst' | 'email-code-hour' | 'email-code-burst' | 'verification-hour' | 'verification-burst' | 'verification-target' = 'registration'): Promise<RegistrationQuota> {
  const key = createHash('sha256').update(`${scope}:${network || 'unverified'}`).digest('hex');
  const { limit, windowSeconds } = config;
  // ON CONFLICT locks the source row across workers and both auth protocols.
  // Use UTC explicitly: Prisma DateTime maps to timestamp WITHOUT time zone.
  // Keep active windows when policy changes; apply duration on the next window.
  const [row] = await db.$queryRaw<{ count: number; expiresAt: Date; now: Date }[]>`
    INSERT INTO client_registration_throttles (key, count, expires_at, blocked_count)
    VALUES (${key}, 1, (statement_timestamp() AT TIME ZONE 'UTC') + ${windowSeconds} * INTERVAL '1 second', 0)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN client_registration_throttles.expires_at <= (statement_timestamp() AT TIME ZONE 'UTC')
        THEN 1 ELSE LEAST(client_registration_throttles.count + 1, 1000001) END,
      blocked_count = CASE WHEN client_registration_throttles.expires_at <= (statement_timestamp() AT TIME ZONE 'UTC')
        THEN 0 ELSE client_registration_throttles.blocked_count END,
      last_seen_at = CASE WHEN client_registration_throttles.expires_at <= (statement_timestamp() AT TIME ZONE 'UTC')
        THEN NULL ELSE client_registration_throttles.last_seen_at END,
      expires_at = CASE WHEN client_registration_throttles.expires_at <= (statement_timestamp() AT TIME ZONE 'UTC')
        THEN (statement_timestamp() AT TIME ZONE 'UTC') + ${windowSeconds} * INTERVAL '1 second'
        ELSE client_registration_throttles.expires_at END
    RETURNING count, expires_at AS "expiresAt", (statement_timestamp() AT TIME ZONE 'UTC') AS now
  `;
  return { key, count: row.count, expiresAt: row.expiresAt, blocked: row.count > limit,
    retryAfterSeconds: Math.max(1, Math.ceil((row.expiresAt.getTime() - row.now.getTime()) / 1000)) };
}

/** Must run after any rejected enrollment transaction has rolled back. */
export async function recordRegistrationBlock(db: ExecuteExecutor, key: string, expiresAt: Date) {
  await db.$executeRaw`
    UPDATE client_registration_throttles
    SET blocked_count = LEAST(blocked_count + 1, 1000000), last_seen_at = (statement_timestamp() AT TIME ZONE 'UTC')
    WHERE key = ${key} AND expires_at = (${expiresAt}::timestamptz AT TIME ZONE 'UTC')
      AND expires_at > (statement_timestamp() AT TIME ZONE 'UTC')
  `;
}
