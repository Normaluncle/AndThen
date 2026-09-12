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
  it('exports the requested half-open window and cohort without identities or free-form properties', async () => {
    const author = await seedUser(h, 'author', 'external');
    const researcher = await seedUser(h, 'researcher', 'team');
    const stranger = await seedUser(h, 'researcher', 'team');
    const reader = await seedUser(h, 'reader', 'external');
    const story = await seedPublishedStory(h, { author: author.user, researcher: researcher.user });
    await h.ctx.db.update(sources).set({ provenance: 'real_authorized' }).where(eq(sources.id, story.source.id));
    for (const [at, cohort] of [['2026-01-01T00:00:00Z', 'external'], ['2026-01-02T00:00:00Z', 'external'], ['2026-01-02T12:00:00Z', 'team'], ['2026-01-03T00:00:00Z', 'external']] as const) {
      await h.ctx.db.insert(researchEvents).values({ sourceId: story.source.id, readerKey: reader.user.id, eventType: 'source_view', cohort, occurredAt: new Date(at), properties: { excluded: false, private_notes: 'DO_NOT_EXPORT_THIS', email: 'private@example.test' } });
    }
    const url = `/api/admin/research-export?source_id=${story.source.id}&from=2026-01-02T00:00:00Z&to=2026-01-03T00:00:00Z&cohort=external`;
    expect((await h.app.inject({ url, headers: auth(stranger.token) })).statusCode).toBe(403);
    const result = await h.app.inject({ url, headers: auth(researcher.token) });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().data.events).toEqual([{ event_type: 'source_view', cohort: 'external', occurred_on: '2026-01-02', excluded: false, feedback: null }]);
    expect(result.json().data.cohorts).toHaveLength(1);
    expect(result.json().data.cohorts[0].unique_source_viewers).toBe(1);
    expect(result.json().data.window).toMatchObject({ bounds: '[from,to)', follower_state: 'current_at_export' });
    for (const secret of [reader.user.id, author.user.id, 'DO_NOT_EXPORT_THIS', 'private@example.test', story.snapshot.excerpt!]) expect(result.body).not.toContain(secret);
    const reversed = url.replace('from=2026-01-02', 'from=2026-01-04');
    expect((await h.app.inject({ url: reversed, headers: auth(researcher.token) })).statusCode).toBe(400);
    const empty = url.replace('cohort=external', 'cohort=absent');
    expect((await h.app.inject({ url: empty, headers: auth(researcher.token) })).json().data.events).toEqual([]);
  });
  it('separates fixed-duration windows, late acceptance, legacy unknown times and missing responses', async () => {
    const author = await seedUser(h, 'author', 'external');
    const researcher = await seedUser(h, 'researcher', 'team');
    const story = await seedPublishedStory(h, { author: author.user, researcher: researcher.user });
    await h.ctx.db.update(sources).set({ provenance: 'real_authorized' }).where(eq(sources.id, story.source.id));
    const base = { caseId: story.followupCase.id, sentAt: new Date('2026-01-01T00:00:00Z'), observationDeadline: new Date('2026-01-02T00:00:00Z') };
    await h.ctx.db.insert(invitations).values([
      { ...base, result: 'accepted', respondedAt: new Date('2026-01-02T00:00:00Z') },
      { ...base, result: 'accepted', respondedAt: new Date('2026-01-02T00:00:01Z') },
      { ...base, result: 'accepted' },
      { ...base, result: 'pending' },
      { ...base, result: 'no_response_in_window' },
      { ...base, result: 'declined', observationDeadline: new Date('2026-01-03T00:00:00Z'), respondedAt: new Date('2026-01-02T01:00:00Z') },
      { ...base, observationDeadline: new Date('2025-12-31T00:00:00Z') },
    ]);
    const res = await h.app.inject({ url: `/api/admin/research-export?source_id=${story.source.id}`, headers: auth(researcher.token) });
    expect(res.statusCode, res.body).toBe(200);
    const windows = res.json().data.fixed_invitation_windows;
    expect(windows.invalid_windows).toBe(1);
    expect(windows.groups).toHaveLength(2);
    expect(windows.groups[0]).toMatchObject({ duration_ms: 86400000, eligible_denominator: 4, accepted_in_window: 1, late_responses: 1, no_response: 2, unknown_response_time: 1, acceptance_ratio: 0.25 });
    expect(windows.groups[1]).toMatchObject({ duration_ms: 172800000, eligible_denominator: 1, declined_in_window: 1, acceptance_ratio: 0 });
  });
});
