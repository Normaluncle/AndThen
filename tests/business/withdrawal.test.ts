import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createHarness, seedPublishedStory, seedUser, type Harness } from './helpers.js';
import { auditLogs, followupVersions, notifications, outbox } from '../../src/db/schema.js';

describe('accepted operator withdrawal', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });
  it('limits operators to admin or assigned researcher, audits once and hides withdrawn text', async () => {
    const author = await seedUser(h, 'author', 'test_fixture');
    const assigned = await seedUser(h, 'researcher', 'test_fixture');
    const stranger = await seedUser(h, 'researcher', 'test_fixture');
    const admin = await seedUser(h, 'admin', 'test_fixture');
    const reader = await seedUser(h, 'reader', 'test_fixture');
    for (const operator of [assigned, admin]) {
      const story = await seedPublishedStory(h, { author: author.user, researcher: assigned.user, verifyAuthor: true });
      // Withdrawal remains available after private interview retention has elapsed.
      await h.ctx.db.update(followupVersions).set({ updatedAt: new Date('2020-01-01'), privatePurgedAt: new Date() }).where(eq(followupVersions.id, story.versionId));
      await h.ctx.db.insert(notifications).values({ readerKey: reader.user.id, caseId: story.followupCase.id, followupVersionId: story.versionId });
      await h.ctx.db.insert(outbox).values({ topic: 'followup.published', dedupeKey: story.versionId, payload: {}, recipients: [{ readerKey: reader.user.id }] });
      const url = `/api/followups/${story.versionId}/withdraw`;
      for (const denied of [stranger, reader]) expect((await h.app.inject({ method: 'POST', url, headers: auth(denied.token) })).statusCode).toBe(403);
      for (let retry = 0; retry < 2; retry++) {
        const response = await h.app.inject({ method: 'POST', url, headers: auth(operator.token), payload: { reason: 'test_fixture accepted withdrawal request' } });
        expect(response.statusCode, response.body).toBe(200);
      }
      const publicRead = await h.app.inject({ method: 'GET', url: `/api/followups/${story.versionId}` });
      expect(publicRead.statusCode).toBe(410);
      expect(publicRead.body).not.toContain('项目后来完成了');
      const audits = await h.ctx.db.select().from(auditLogs).where(eq(auditLogs.subjectId, story.versionId));
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorUserId: operator.user.id, action: 'followup.withdrawn', properties: { operator: true } });
      expect((await h.ctx.db.select().from(notifications).where(eq(notifications.followupVersionId, story.versionId)))[0]?.status).toBe('withdrawn');
      expect((await h.ctx.db.select().from(outbox).where(eq(outbox.dedupeKey, story.versionId)))[0]).toMatchObject({ status: 'cancelled', recipients: [] });
    }
  });
});
