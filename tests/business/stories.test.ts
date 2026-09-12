import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { interests, jobs, researchEvents, sources } from '../../src/db/schema.js';
import { JobQueue } from '../../src/jobs/queue.js';
import { truncateAll } from '../helpers/testdb.js';
import {
  auth,
  createHarness,
  importSource,
  seedPublishedStory,
  seedUser,
  type Harness,
} from './helpers.js';

describe('sources: public stories, interest, following and consent revocation', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await truncateAll(h.ctx.db);
  });

  it('projects only public fields of a licensed, published story', async () => {
    const author = await seedUser(h, 'author');
    const researcher = await seedUser(h, 'researcher');
    const story = await seedPublishedStory(h, { author: author.user, researcher: researcher.user });

    const anonymous = await h.app.inject({ method: 'GET', url: `/api/stories/${story.source.id}` });
    expect(anonymous.statusCode).toBe(200);
    const data = anonymous.json().data.story;
    expect(data.source_id).toBe(story.source.id);
    expect(data.published_followup).not.toBeNull();
    expect(data.published_followup.statements).toHaveLength(1);
    expect(data.published_followup.statements[0].text).toBe('项目后来完成了。');
    expect(data.published_followup.attribution).toBe('author_reported');
    // No private field leaks into the public projection.
    const raw = anonymous.body;
    expect(raw).not.toContain('这里有一句不公开的话');
    expect(raw).not.toContain(story.source.createdByUserId);
    expect(raw).not.toContain('permission_status');

    const list = await h.app.inject({ method: 'GET', url: '/api/stories' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.total).toBe(1);
    expect(list.json().data.items[0].source_id).toBe(story.source.id);
  });

  it('denies a story that is not licensed for public display', async () => {
    const author = await seedUser(h, 'author');
    const privateStory = await seedPublishedStory(h, {
      author: author.user,
      permissionStatus: 'private_only',
    });
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/stories/${privateStory.source.id}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error_code).toBe('not_found');
  });

  it('keeps interest idempotent, restorable and deduped under concurrency', async () => {
    const author = await seedUser(h, 'author');
    const reader = await seedUser(h, 'reader');
    const story = await seedPublishedStory(h, { author: author.user });

    const follow = await h.app.inject({
      method: 'PUT',
      url: `/api/stories/${story.source.id}/interest`,
      headers: auth(reader.token),
      payload: { active: true },
    });
    expect(follow.statusCode).toBe(200);
    expect(follow.json().data.active).toBe(true);

    // Concurrent repeats must not create a second row.
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () =>
        h.app.inject({
          method: 'PUT',
          url: `/api/stories/${story.source.id}/interest`,
          headers: auth(reader.token),
          payload: { active: true },
        }),
      ),
    );
    for (const res of concurrent) expect(res.statusCode).toBe(200);

    const rows = await h.ctx.db
      .select()
      .from(interests)
      .where(and(eq(interests.readerKey, reader.user.id), eq(interests.sourceId, story.source.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.active).toBe(true);

    // Cancel, then restore: the same row is reused.
    const cancel = await h.app.inject({
      method: 'PUT',
      url: `/api/stories/${story.source.id}/interest`,
      headers: auth(reader.token),
      payload: { active: false },
    });
    expect(cancel.json().data.active).toBe(false);

    const restore = await h.app.inject({
      method: 'PUT',
      url: `/api/stories/${story.source.id}/interest`,
      headers: auth(reader.token),
      payload: { active: true },
    });
    expect(restore.json().data.active).toBe(true);

    const rowsAfter = await h.ctx.db
      .select()
      .from(interests)
      .where(and(eq(interests.readerKey, reader.user.id), eq(interests.sourceId, story.source.id)));
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0]!.active).toBe(true);
    expect(rowsAfter[0]!.cancelledAt).toBeNull();
  });

  it('records real interest events but excludes team, demo and author behaviour', async () => {
    const author = await seedUser(h, 'author', 'external');
    const externalReader = await seedUser(h, 'reader', 'external');
    const teamReader = await seedUser(h, 'reader', 'team');
    const story = await seedPublishedStory(h, { author: author.user, provenance: 'real_authorized' });

    for (const token of [externalReader.token, teamReader.token, author.token]) {
      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/stories/${story.source.id}/interest`,
        headers: auth(token),
        payload: { active: true },
      });
      expect(res.statusCode).toBe(200);
    }

    const externalRow = await h.ctx.db
      .select()
      .from(interests)
      .where(eq(interests.readerKey, externalReader.user.id));
    expect(externalRow[0]!.excluded).toBe(false);

    const teamRow = await h.ctx.db
      .select()
      .from(interests)
      .where(eq(interests.readerKey, teamReader.user.id));
    expect(teamRow[0]!.excluded).toBe(true);

    const authorRow = await h.ctx.db
      .select()
      .from(interests)
      .where(eq(interests.readerKey, author.user.id));
    expect(authorRow[0]!.excluded).toBe(true);

    const events = await h.ctx.db
      .select()
      .from(researchEvents)
      .where(eq(researchEvents.eventType, 'interest_changed'));
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.map((e) => e.cohort)).toContain('team');
  });

  it('marks interest on a test_fixture source as excluded', async () => {
    const author = await seedUser(h, 'author', 'external');
    const reader = await seedUser(h, 'reader', 'external');
    const story = await seedPublishedStory(h, { author: author.user });

    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/stories/${story.source.id}/interest`,
      headers: auth(reader.token),
      payload: { active: true },
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.ctx.db
      .select()
      .from(interests)
      .where(eq(interests.readerKey, reader.user.id));
    expect(rows[0]!.excluded).toBe(true);
  });

  it('refuses interest on a story that is not public', async () => {
    const author = await seedUser(h, 'author');
    const reader = await seedUser(h, 'reader');
    const privateStory = await seedPublishedStory(h, { author: author.user, permissionStatus: 'private_only' });
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/stories/${privateStory.source.id}/interest`,
      headers: auth(reader.token),
      payload: { active: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns only the caller\u2019s following and hides content once it stops being public', async () => {
    const author = await seedUser(h, 'author');
    const reader = await seedUser(h, 'reader');
    const other = await seedUser(h, 'reader');
    const story = await seedPublishedStory(h, { author: author.user });

    await h.app.inject({
      method: 'PUT',
      url: `/api/stories/${story.source.id}/interest`,
      headers: auth(reader.token),
      payload: { active: true },
    });

    const following = await h.app.inject({
      method: 'GET',
      url: '/api/me/following',
      headers: auth(reader.token),
    });
    expect(following.statusCode).toBe(200);
    expect(following.json().data.total).toBe(1);
    const item = following.json().data.items[0];
    expect(item.source_id).toBe(story.source.id);
    expect(item.available).toBe(true);
    expect(item.update.status).toBe('published');
    // No private or author-only information.
    expect(following.body).not.toContain('这里有一句不公开的话');

    const otherFollowing = await h.app.inject({
      method: 'GET',
      url: '/api/me/following',
      headers: auth(other.token),
    });
    expect(otherFollowing.json().data.total).toBe(0);

    // Revoke public display: the item stays, but its content is gone.
    const revoke = await h.app.inject({
      method: 'DELETE',
      url: `/api/sources/${story.source.id}/consents/demo_public_display`,
      headers: auth(author.token),
    });
    expect(revoke.statusCode).toBe(200);

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/me/following',
      headers: auth(reader.token),
    });
    expect(after.json().data.total).toBe(1);
    expect(after.json().data.items[0].available).toBe(false);
    expect(after.json().data.items[0].title).toBeNull();
  });

  it('makes a consent revocation invalidate public access immediately', async () => {
    const author = await seedUser(h, 'author');
    const story = await seedPublishedStory(h, { author: author.user, verifyAuthor: true });

    const before = await h.app.inject({ method: 'GET', url: `/api/stories/${story.source.id}` });
    expect(before.statusCode).toBe(200);

    const revoke = await h.app.inject({
      method: 'DELETE',
      url: `/api/sources/${story.source.id}/consents/demo_public_display`,
      headers: auth(author.token),
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().data.source_permission_status).toBe('revoked');

    const after = await h.app.inject({ method: 'GET', url: `/api/stories/${story.source.id}` });
    expect(after.statusCode).toBe(404);

    const list = await h.app.inject({ method: 'GET', url: '/api/stories' });
    expect(list.json().data.total).toBe(0);

    const stored = await h.ctx.db.select().from(sources).where(eq(sources.id, story.source.id));
    expect(stored[0]!.permissionStatus).toBe('revoked');
  });

  it('cancels in-flight AI jobs when model-processing consent is revoked', async () => {
    const author = await seedUser(h, 'author');
    const story = await seedPublishedStory(h, { author: author.user, verifyAuthor: true });
    const queue = new JobQueue(h.ctx.db);

    const enqueued = await queue.enqueue({
      kind: 'ai.extract',
      payload: { source_id: story.source.id },
      dedupeKey: `ai:${story.source.id}`,
    });
    const claimed = await queue.claim({ workerId: 'test-worker', leaseSeconds: 60 });
    expect(claimed?.id).toBe(enqueued.job.id);
    expect(claimed?.fencingToken).toBe(1);

    // Author first grants, then revokes model processing.
    await h.app.inject({
      method: 'POST',
      url: `/api/sources/${story.source.id}/consents`,
      headers: auth(author.token),
      payload: { purpose: 'external_model_processing' },
    });
    const revoke = await h.app.inject({
      method: 'DELETE',
      url: `/api/sources/${story.source.id}/consents/external_model_processing`,
      headers: auth(author.token),
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().data.cancelled_jobs).toBe(1);

    const jobRows = await h.ctx.db.select().from(jobs).where(eq(jobs.id, enqueued.job.id));
    expect(jobRows[0]!.status).toBe('cancelled');

    // A cancelled job's result can never be committed.
    const committed = await queue.complete(enqueued.job.id, claimed!.fencingToken, { ok: true });
    expect(committed).toBe(false);
  });

  it('only the author may grant a consent; an admin cannot sign for them', async () => {
    const author = await seedUser(h, 'author');
    const researcher = await seedUser(h, 'researcher');
    const admin = await seedUser(h, 'admin');
    const imported = await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/consent',
      material_level: 'api_summary',
      body: '作者材料。',
    });

    const researcherGrant = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/consents`,
      headers: auth(researcher.token),
      payload: { purpose: 'demo_public_display' },
    });
    expect(researcherGrant.statusCode).toBe(403);

    const adminGrant = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/consents`,
      headers: auth(admin.token),
      payload: { purpose: 'demo_public_display' },
    });
    expect(adminGrant.statusCode).toBe(403);

    // Unverified author: consent is recorded but the source stays private.
    const authorGrant = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/consents`,
      headers: auth(author.token),
      payload: { purpose: 'demo_public_display' },
    });
    expect(authorGrant.statusCode).toBe(200);
    expect(authorGrant.json().data.source_permission_status).toBe('private_only');
  });
});
