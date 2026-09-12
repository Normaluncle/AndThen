import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createHarness, seedUser, type Harness } from './helpers.js';
import { sessions, users, zhihuOAuthAttempts } from '../../src/db/schema.js';
import { createOAuthAttempt, consumeOAuthAttempt, clearExpiredOAuthAttempts } from '../../src/modules/zhihu/oauth-attempts.js';
let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
async function account() {
  const { user } = await seedUser(h, 'reader');
  const [session] = await h.ctx.db.select().from(sessions).where(eq(sessions.userId, user.id));
  return { user, session: session! };
}

it('persists only hashes and atomically permits one callback across concurrent requests', async () => {
  const { user, session } = await account();
  const issued = await createOAuthAttempt(h.ctx.db, session.id);
  const [stored] = await h.ctx.db.select().from(zhihuOAuthAttempts).where(eq(zhihuOAuthAttempts.sessionId, session.id));
  expect(JSON.stringify(stored)).not.toContain(issued.state);
  expect(JSON.stringify(stored)).not.toContain(issued.browserProof);
  const results = await Promise.allSettled(Array.from({length: 3}, () => consumeOAuthAttempt(h.ctx.db, issued.state, issued.browserProof)));
  const fulfilled = results.filter(x => x.status === 'fulfilled');
  expect(fulfilled).toHaveLength(1);
  expect(fulfilled[0]!.value).toMatchObject({userId: user.id, sessionId: session.id});
  expect(results.filter(x => x.status === 'rejected')).toHaveLength(2);
});

it('rejects another browser proof without consuming the legitimate attempt and invalidates superseded tabs', async () => {
  const a = await account(), b = await account();
  const first = await createOAuthAttempt(h.ctx.db, a.session.id);
  const other = await createOAuthAttempt(h.ctx.db, b.session.id);
  await expect(consumeOAuthAttempt(h.ctx.db, first.state, other.browserProof)).rejects.toThrow();
  const replacement = await createOAuthAttempt(h.ctx.db, a.session.id);
  await expect(consumeOAuthAttempt(h.ctx.db, first.state, first.browserProof)).rejects.toThrow();
  expect(await consumeOAuthAttempt(h.ctx.db, replacement.state, replacement.browserProof)).toMatchObject({userId: a.user.id});
  expect(await consumeOAuthAttempt(h.ctx.db, other.state, other.browserProof)).toMatchObject({userId: b.user.id});
});

it('rejects expired requests and clears them without deleting active requests', async () => {
  const a = await account(), b = await account();
  const now = new Date();
  const old = await createOAuthAttempt(h.ctx.db, a.session.id, new Date(now.getTime() - 600000));
  const current = await createOAuthAttempt(h.ctx.db, b.session.id, now);
  await expect(consumeOAuthAttempt(h.ctx.db, old.state, old.browserProof, now)).rejects.toThrow();
  await clearExpiredOAuthAttempts(h.ctx.db, now);
  expect(await h.ctx.db.select().from(zhihuOAuthAttempts).where(eq(zhihuOAuthAttempts.sessionId, a.session.id))).toHaveLength(0);
  await expect(consumeOAuthAttempt(h.ctx.db, current.state, current.browserProof, now)).resolves.toMatchObject({userId:b.user.id});
});

it('rejects revoked sessions and disabled accounts even with correct callback values', async () => {
  for (const mode of ['revoked', 'disabled', 'expired']) {
    const {user, session} = await account();
    const issued = await createOAuthAttempt(h.ctx.db, session.id);
    if (mode === 'disabled') await h.ctx.db.update(users).set({disabledAt:new Date()}).where(eq(users.id,user.id));
    else await h.ctx.db.update(sessions).set(mode === 'revoked' ? {revokedAt:new Date()} : {expiresAt:new Date(0)}).where(eq(sessions.id,session.id));
    await expect(consumeOAuthAttempt(h.ctx.db, issued.state, issued.browserProof)).rejects.toThrow('no longer active');
    await expect(createOAuthAttempt(h.ctx.db, session.id)).rejects.toThrow('no longer active');
  }
});
