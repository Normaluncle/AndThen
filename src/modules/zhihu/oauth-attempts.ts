import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import type { Database, Executor } from '../../db/client.js';
import { sessions, users, zhihuOAuthAttempts } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { generateOpaqueToken, hashToken } from '../identity/tokens.js';

export async function activeOAuthSession(db: Executor, sessionId: string, now: Date) {
  const [row] = await db.select({ userId: users.id }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), isNull(users.disabledAt)))
    .for('update');
  if (!row) throw AppError.unauthorized('The initiating session is no longer active');
  return row;
}

/** sessionId must come from request.auth; this function does not accept a user/role. */
export async function createOAuthAttempt(db: Database, sessionId: string, now = new Date()) {
  return db.transaction(async tx => {
    await activeOAuthSession(tx, sessionId, now);
    // A new attempt invalidates earlier tabs for this session, including their cookies.
    await tx.delete(zhihuOAuthAttempts).where(eq(zhihuOAuthAttempts.sessionId, sessionId));
    const state = generateOpaqueToken(), browser = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const [row]=await tx.insert(zhihuOAuthAttempts).values({ sessionId, stateHash: state.tokenHash, browserHash: browser.tokenHash, expiresAt }).returning({id:zhihuOAuthAttempts.id});
    return { attemptId:row!.id, state: state.token, browserProof: browser.token, expiresAt };
  });
}

/** Consume before exchanging a code. Any failure after consumption requires a new start. */
export async function consumeOAuthAttempt(db: Database, state: string, browserProof: string, now = new Date()) {
  if (![state, browserProof].every(value => /^[A-Za-z0-9_-]{43}$/.test(value))) throw AppError.forbidden('Invalid OAuth callback correlation');
  return db.transaction(async tx => {
    const criteria = and(eq(zhihuOAuthAttempts.stateHash, hashToken(state)), eq(zhihuOAuthAttempts.browserHash, hashToken(browserProof)),
      isNull(zhihuOAuthAttempts.consumedAt), gt(zhihuOAuthAttempts.expiresAt, now));
    // Read session first and lock it before the attempt, matching start/logout ordering.
    const [candidate] = await tx.select().from(zhihuOAuthAttempts).where(criteria);
    if (!candidate) throw AppError.forbidden('OAuth callback expired or already used');
    const session = await activeOAuthSession(tx, candidate.sessionId, now);
    const [claimed] = await tx.update(zhihuOAuthAttempts).set({ consumedAt: now }).where(criteria).returning({ id: zhihuOAuthAttempts.id });
    if (!claimed) throw AppError.forbidden('OAuth callback expired or already used');
    return { attemptId: claimed.id, sessionId: candidate.sessionId, userId: session.userId };
  });
}

export async function clearExpiredOAuthAttempts(db: Executor, now = new Date()) {
  await db.delete(zhihuOAuthAttempts).where(lte(zhihuOAuthAttempts.expiresAt, now));
}
