import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createHarness, seedPublishedStory, seedUser, type Harness } from './helpers.js';
import { interests, invitations, researchEvents, sources } from '../../src/db/schema.js';

describe('research observations and scoped aggregate exports', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });
  it('deduplicates concurrent events and rejects spoofed cohorts and business events', async () => {
    const author = await seedUser(h, 'author');
    const reader = await seedUser(h, 'reader', 'external');
    const story = await seedPublishedStory(h, { author: author.user });
    const payload = { source_id: story.source.id, event_type: 'source_view', client_event_id: 'view1' };
    const responses = await Promise.all(Array.from({ length: 4 }, () => h.app.inject({ method: 'POST', url: '/api/research/events', headers: auth(reader.token), payload })));
    for (const res of responses) expect(res.statusCode, res.body).toBe(200);
    expect(new Set(responses.map(r => r.json().data.event_id)).size).toBe(1);
    expect(responses[0]!.json().data.excluded).toBe(true); // test_fixture source, even with external cohort
    expect((await h.ctx.db.select().from(researchEvents).where(eq(researchEvents.sourceId, story.source.id)))[0]?.cohort).toBe('external');
    for (const invalid of [{ ...payload, cohort: 'real' }, { ...payload, event_type: 'published' }]) {
      expect((await h.app.inject({ method: 'POST', url: '/api/research/events', headers: auth(reader.token), payload: invalid })).statusCode).toBe(400);
    }
    expect((await h.app.inject({ method: 'POST', url: '/api/research/events', headers: auth(reader.token), payload: { ...payload, prompted: true } })).statusCode).toBe(409);
  });
  it('scopes exports, excludes prompted/self/test behavior and reports missing denominators as null', async () => {
    const author = await seedUser(h, 'author', 'external');
    const researcher = await seedUser(h, 'researcher', 'team');
    const stranger = await seedUser(h, 'researcher', 'team');
    const reader = await seedUser(h, 'reader', 'external');
    const testReader = await seedUser(h, 'reader', 'test_fixture');
    const prompted = await seedUser(h, 'reader', 'external');
    const story = await seedPublishedStory(h, { author: author.user, researcher: researcher.user });
    const exportUrl = `/api/research/export?source_id=${story.source.id}`;
    expect((await h.app.inject({ method: 'GET', url: exportUrl, headers: auth(stranger.token) })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'GET', url: exportUrl, headers: auth(reader.token) })).statusCode).toBe(403);
    // Synthetic fixture deliberately exercises real_authorized filtering only inside isolated test DB.
    await h.ctx.db.update(sources).set({ provenance: 'real_authorized' }).where(eq(sources.id, story.source.id));
    for (const [who, isPrompted] of [[reader, false], [author, false], [testReader, false], [prompted, true]] as const) {
      const res = await h.app.inject({ method: 'POST', url: '/api/research/events', headers: auth(who.token), payload: { source_id: story.source.id, event_type: 'source_view', client_event_id: 'view1', prompted: isPrompted } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.excluded).toBe(who !== reader);
    }
    await h.ctx.db.insert(interests).values({ sourceId: story.source.id, readerKey: reader.user.id, cohort: 'external', triggeredBy: 'natural' });
    await h.ctx.db.insert(invitations).values([
      { caseId: story.followupCase.id, observationDeadline: new Date(Date.now() + 86400000), result: 'pending' },
      { caseId: story.followupCase.id, observationDeadline: new Date(Date.now() - 86400000), result: 'accepted' },
    ]);
    const result = await h.app.inject({ method: 'GET', url: exportUrl, headers: auth(researcher.token) });
    expect(result.statusCode, result.body).toBe(200);
    const data = result.json().data;
    const external = data.cohorts.find((c: { cohort: string }) => c.cohort === 'external');
    expect(external.unique_source_viewers).toBe(1);
    expect(external.exposure_to_active_interest_ratio).toBe(1);
    expect(external.excluded_event_count).toBe(2);
    expect(data.cohorts.find((c: { cohort: string }) => c.cohort === 'test_fixture').exposure_to_active_interest_ratio).toBeNull();
    expect(data.invitation_observations.eligible_denominator).toBe(1);
    expect(data.invitation_observations.pending_or_unknown_window).toBe(1);
    for (const value of [reader.user.id, author.user.id, story.snapshot.excerpt!]) expect(result.body).not.toContain(value);
    expect((await h.app.inject({ method: 'POST', url: '/api/research/events', headers: auth(reader.token), payload: { source_id: story.source.id, event_type: 'followup_view', client_event_id: 'wrong-followup', followup_version_id: crypto.randomUUID() } })).statusCode).toBe(404);
  });
});
