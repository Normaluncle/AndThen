import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { users, zhihuAccounts, zhihuOAuthAttempts } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { activeOAuthSession } from './oauth-attempts.js';
import { openToken, sealToken } from './oauth-client.js';

/** Only the server's verified OAuth /user response may supply provider identity. */
export async function bindOAuthAccount(db: Database, attemptId: string,
  identity: { uid: string; fullname?: string | undefined }, token: { access_token: string; expires_in: number },
  encryptionKey: string, now = new Date(), signInExisting = false) {
  if (!/^[1-9]\d*$/.test(identity.uid) || !token.access_token || token.access_token.length > 8192
    || !Number.isSafeInteger(token.expires_in) || token.expires_in <= 0 || token.expires_in > 31536000) throw AppError.validation('Invalid verified OAuth response');
  return db.transaction(async tx => {
    const [attempt] = await tx.select().from(zhihuOAuthAttempts).where(eq(zhihuOAuthAttempts.id, attemptId));
    if (!attempt) throw AppError.forbidden('OAuth attempt is no longer available');
    const initiating = await activeOAuthSession(tx, attempt.sessionId, now);
    let userId=initiating.userId;
    // Same UID across different local sessions must serialize before checking ownership.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`zhihu-uid:${identity.uid}`}, 0))`);
    const [other] = await tx.select().from(zhihuAccounts).where(eq(zhihuAccounts.uid, identity.uid));
    if (other && other.userId !== userId) {
      if(!signInExisting)throw AppError.conflict('This Zhihu identity is already bound to another account');
      const [owner]=await tx.select().from(users).where(eq(users.id,other.userId)).for('update');
      if(!owner||owner.disabledAt)throw AppError.forbidden('Bound account is disabled');
      userId=owner.id;
    }
    const [current] = await tx.select().from(zhihuAccounts).where(eq(zhihuAccounts.userId, userId));
    if (current && current.uid !== identity.uid) throw AppError.conflict('The authorized Zhihu identity differs from the existing binding');
    const [claimed] = await tx.update(zhihuOAuthAttempts).set({completedUserId:userId,completedAt:now}).where(and(eq(zhihuOAuthAttempts.id, attemptId),
      isNotNull(zhihuOAuthAttempts.consumedAt),isNull(zhihuOAuthAttempts.completedAt), gt(zhihuOAuthAttempts.expiresAt, now))).returning({id:zhihuOAuthAttempts.id});
    if (!claimed) throw AppError.forbidden('OAuth attempt is unconsumed, expired or already completed');
    const expiresAt = new Date(now.getTime() + token.expires_in * 1000);
    const values = { uid: identity.uid, displayName: identity.fullname ?? null,
      tokenCiphertext: sealToken(token.access_token, encryptionKey, userId), expiresAt, revokedAt: null, updatedAt: now };
    await tx.insert(zhihuAccounts).values({userId,...values}).onConflictDoUpdate({target:zhihuAccounts.userId,set:values});
    return { uid: identity.uid, display_name: values.displayName, expires_at: expiresAt };
  });
}

/** Backend-only credential accessor. Never serialize this return value into an HTTP response. */
export async function readOAuthToken(db: Database, userId: string, encryptionKey: string, now = new Date()) {
  const [row] = await db.select({ciphertext:zhihuAccounts.tokenCiphertext}).from(zhihuAccounts)
    .innerJoin(users,eq(users.id,zhihuAccounts.userId))
    .where(and(eq(zhihuAccounts.userId,userId),isNull(users.disabledAt),isNull(zhihuAccounts.revokedAt),gt(zhihuAccounts.expiresAt,now)));
  if (!row?.ciphertext) throw AppError.unauthorized('Zhihu authorization is absent or expired');
  return openToken(row.ciphertext,encryptionKey,userId);
}

/** Disconnect retains the identity reservation, but removes credentials and pending callbacks. */
export async function disconnectOAuthAccount(db: Database, sessionId: string, now = new Date()) {
  return db.transaction(async tx => {
    const {userId} = await activeOAuthSession(tx,sessionId,now);
    // All attempts for this account are invalidated, including another active browser.
    await tx.execute(sql`delete from zhihu_oauth_attempts where completed_user_id = ${userId} or session_id in (select id from sessions where user_id = ${userId})`);
    await tx.update(zhihuAccounts).set({tokenCiphertext:null,revokedAt:now,updatedAt:now}).where(eq(zhihuAccounts.userId,userId));
  });
}
