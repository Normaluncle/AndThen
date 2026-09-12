import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createHarness, seedPublishedStory, seedUser, type Harness } from './helpers.js';
import { users, sessions, loginTokens, sources, sourceSnapshots, interests, researchEvents, jobs, aiRuns } from '../../src/db/schema.js';
import { setInterest } from '../../src/modules/sources/service.js';

describe('end-user account erasure', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });
  const request = () => ({ receipt_id: randomUUID(), receipt_secret: randomBytes(32).toString('hex'), confirms_account_and_content_deletion: true });
  it('erases reader credentials/activity, preserves other authors and rejects a previously resolved identity', async () => {
    const reader = await seedUser(h, 'reader');
    const author = await seedUser(h, 'author');
    const story = await seedPublishedStory(h, { author: author.user });
    await h.ctx.db.insert(interests).values({ readerKey: reader.user.id, sourceId: story.source.id });
    await h.ctx.db.insert(researchEvents).values({ readerKey: reader.user.id, sourceId: story.source.id, eventType: 'source_view' });
    const payload = request();
    const result = await h.app.inject({ method: 'POST', url: '/api/me/account-deletion', headers: auth(reader.token), payload });
    expect(result.statusCode, result.body).toBe(200);
    for (const table of [sessions, loginTokens]) expect(await h.ctx.db.select().from(table).where(eq(table.userId, reader.user.id))).toHaveLength(0);
    expect(await h.ctx.db.select().from(users).where(eq(users.id, reader.user.id))).toHaveLength(0);
    expect(await h.ctx.db.select().from(interests).where(eq(interests.readerKey, reader.user.id))).toHaveLength(0);
    expect(await h.ctx.db.select().from(researchEvents).where(eq(researchEvents.readerKey, reader.user.id))).toHaveLength(0);
    expect((await h.app.inject({ url: '/api/me', headers: auth(reader.token) })).statusCode).toBe(401);
    const receiptUrl = `/api/deletion-receipts/${payload.receipt_id}`;
    expect((await h.app.inject({ url: receiptUrl, headers: auth(author.token) })).statusCode).toBe(404);
    const receipt = await h.app.inject({ url: receiptUrl, headers: auth(payload.receipt_secret) });
    expect(receipt.statusCode, receipt.body).toBe(200);
    expect(receipt.body).not.toContain(payload.receipt_secret);
    expect(receipt.body).not.toContain(reader.user.id);
    expect((await h.app.inject({ url: `/api/stories/${story.source.id}` })).statusCode).toBe(200);
    await expect(setInterest(h.moduleCtx, { userId: reader.user.id, role: 'reader', cohort: reader.user.cohort, sessionId: randomUUID(), expiresAt: new Date(Date.now() + 10000) }, story.source.id, true)).rejects.toThrow('Account unavailable');
  });
  it('removes author-owned source content and in-flight jobs while keeping another source intact', async () => {
    const author = await seedUser(h, 'author');
    const other = await seedUser(h, 'author');
    const story = await seedPublishedStory(h, { author: author.user, verifyAuthor: true });
    const untouched = await seedPublishedStory(h, { author: other.user });
    const { job } = await h.moduleCtx.jobs.enqueue({ kind: 'ai.extract', payload: { source_id: story.source.id, owner_user_id: author.user.id } });
    await h.ctx.db.insert(aiRuns).values({ task: 'ai_a_extract', sourceId: story.source.id, jobId: job.id, output: { private_text: 'ERASE_ME' } });
    const payload = request();
    const result = await h.app.inject({ method: 'POST', url: '/api/me/account-deletion', headers: auth(author.token), payload });
    expect(result.statusCode, result.body).toBe(200);
    expect(await h.ctx.db.select().from(sources).where(eq(sources.id, story.source.id))).toHaveLength(0);
    expect(await h.ctx.db.select().from(sourceSnapshots).where(eq(sourceSnapshots.sourceId, story.source.id))).toHaveLength(0);
    expect(await h.ctx.db.select().from(aiRuns).where(eq(aiRuns.sourceId, story.source.id))).toHaveLength(0);
    expect((await h.ctx.db.select().from(jobs).where(eq(jobs.id, job.id)))[0]).toMatchObject({ status: 'cancelled', payload: {}, result: null });
    expect((await h.app.inject({ url: `/api/stories/${story.source.id}` })).statusCode).toBe(404);
    expect((await h.app.inject({ url: `/api/stories/${untouched.source.id}` })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: '/api/me/account-deletion', headers: auth(other.token), payload })).statusCode).toBe(409);
    expect((await h.app.inject({ url: '/api/me', headers: auth(other.token) })).statusCode).toBe(200);
  });
  it('does not leave activity behind when account erasure races with authenticated follows', async () => {
    const reader = await seedUser(h, 'reader');
    const author = await seedUser(h, 'author');
    const story = await seedPublishedStory(h, { author: author.user });
    const payload = request();
    const [erasure, ...writes] = await Promise.all([
      h.app.inject({ method: 'POST', url: '/api/me/account-deletion', headers: auth(reader.token), payload }),
      ...Array.from({ length: 5 }, () => h.app.inject({ method: 'PUT', url: `/api/stories/${story.source.id}/interest`, headers: auth(reader.token), payload: { active: true } })),
    ]);
    expect(erasure!.statusCode, erasure!.body).toBe(200);
    for (const write of writes) expect([200, 401], write.body).toContain(write.statusCode);
    expect(await h.ctx.db.select().from(interests).where(eq(interests.readerKey, reader.user.id))).toHaveLength(0);
    expect(await h.ctx.db.select().from(researchEvents).where(eq(researchEvents.readerKey, reader.user.id))).toHaveLength(0);
  });
});
