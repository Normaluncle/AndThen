import { beforeAll, afterAll, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createHarness, seedPublishedStory, seedUser, type Harness } from './helpers.js';
import { followupVersions, interviewSessions, interviewMessages, sessions } from '../../src/db/schema.js';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

it('sweeps private reads against anonymous, unrelated and expired sessions and checks both public projections', async () => {
  const author = await seedUser(h, 'author', 'test_fixture');
  const stranger = await seedUser(h, 'author', 'test_fixture');
  const expired = await seedUser(h, 'author', 'test_fixture');
  const story = await seedPublishedStory(h, { author: author.user, verifyAuthor: true });
  const secret = 'test_fixture_PRIVATE_ROUTE_SENTINEL';
  const statements = [
    ...(['then', 'later', 'reflection'] as const).map(section => ({ id: section, text: `public ${section}`, kind: 'author_report', section, visibility: 'public', evidence_refs: ['test_fixture'] })),
    { id: 'private', text: secret, kind: 'author_reflection', section: 'reflection', visibility: 'private', evidence_refs: ['test_fixture'] },
  ];
  await h.ctx.db.update(followupVersions).set({ statements }).where(eq(followupVersions.id, story.versionId));
  const [interview] = await h.ctx.db.insert(interviewSessions).values({ caseId: story.followupCase.id, ownerUserId: author.user.id, status: 'paused', mode: 'manual' }).returning();
  await h.ctx.db.insert(interviewMessages).values({ sessionId: interview!.id, role: 'author', sequence: 1, authorMessage: secret, visibility: 'private' });
  const queued = await h.moduleCtx.jobs.enqueue({ kind: 'test_fixture.private', payload: { owner_user_id: author.user.id, private_material: secret } });
  await h.ctx.db.update(sessions).set({ expiresAt: new Date('2020-01-01') }).where(eq(sessions.userId, expired.user.id));
  const paths = [
    `/sources/${story.source.id}`, `/sources/${story.source.id}/snapshots`, `/sources/${story.source.id}/consents`,
    `/sources/${story.source.id}/author-verifications`, `/sources/${story.source.id}/analysis`,
    `/cases/${story.followupCase.id}`, `/interviews/${interview!.id}`, `/drafts/${story.versionId}`, `/drafts/${story.versionId}/evidence`, `/jobs/${queued.job.id}`,
  ];
  for (const path of paths) {
    for (const headers of [undefined, auth(stranger.token), auth(expired.token)]) {
      const res = await h.app.inject({ url: `/api${path}`, headers });
      expect([401, 403, 404], `${path}: ${res.body}`).toContain(res.statusCode);
      expect(res.body).not.toContain(secret);
    }
  }
  const job = await h.app.inject({ url: `/api/jobs/${queued.job.id}`, headers: auth(author.token) });
  expect(job.statusCode).toBe(200);
  expect(job.body).not.toContain(secret);
  for (const path of [`/stories/${story.source.id}`, `/followups/${story.versionId}`]) {
    const res = await h.app.inject({ url: `/api${path}` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(secret);
    expect(res.body).not.toContain('evidence_refs');
    const projected = path.startsWith('/stories') ? res.json().data.story.published_followup.statements : res.json().data.statements;
    expect(projected.map((s: { section: string }) => s.section)).toEqual(['then', 'later', 'reflection']);
  }
});
