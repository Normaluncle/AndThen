import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invitations, followupCases, sourceSnapshots } from '../../src/db/schema.js';
import { truncateAll } from '../helpers/testdb.js';
import { auth, createHarness, importSource, seedUser, type Harness } from './helpers.js';

interface CaseSetup {
  researcher: Awaited<ReturnType<typeof seedUser>>;
  admin: Awaited<ReturnType<typeof seedUser>>;
  author: Awaited<ReturnType<typeof seedUser>>;
  other: Awaited<ReturnType<typeof seedUser>>;
  sourceId: string;
  caseId: string;
}

/** Researcher-owned case on a controlled source, later bound to `author`. */
async function setupBoundCase(h: Harness, reviewed = true): Promise<CaseSetup> {
  const researcher = await seedUser(h, 'researcher');
  const admin = await seedUser(h, 'admin');
  const author = await seedUser(h, 'author');
  const other = await seedUser(h, 'author');

  const imported = await importSource(h, researcher.token, {
    source_type: 'researcher_import',
    original_url: `https://example.test/r/case-${Math.random().toString(36).slice(2)}`,
    material_level: 'api_summary',
    body: '受控材料。',
  });

  const caseRes = await h.app.inject({
    method: 'POST',
    url: '/api/cases',
    headers: auth(researcher.token),
    payload: { source_id: imported.sourceId, launch_type: 'reader_initiated' },
  });
  const caseId = caseRes.json().data.case.id as string;

  await h.app.inject({
    method: 'POST',
    url: `/api/sources/${imported.sourceId}/author-verifications`,
    headers: auth(admin.token),
    payload: {
      subject_user_id: author.user.id,
      method: 'manual',
      evidence_ref: 'evidence://controlled/case',
      approve: true,
    },
  });

  if (reviewed) {
    const [current] = await h.ctx.db.select().from(followupCases).where(eq(followupCases.id, caseId));
    const [snapshot] = await h.ctx.db.select().from(sourceSnapshots).where(eq(sourceSnapshots.sourceId, imported.sourceId));
    const review = await h.app.inject({ method: 'POST', url: `/api/cases/${caseId}/review`, headers: auth(researcher.token), payload: {
      expected_version: current!.updatedAt.toISOString(), snapshot_hash: snapshot!.contentHash, decision: 'eligible', reason_code: 'source_checked', evidence_ref: 'evidence://test_fixture/review', confirms_source_and_safety_review: true,
    } });
    if (review.statusCode !== 200) throw new Error(review.body);
  }
  return { researcher, admin, author, other, sourceId: imported.sourceId, caseId };
}

describe('cases: create, invitation records and author decisions', () => {
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

  it('creates one case per source and returns it on repeats', async () => {
    const author = await seedUser(h, 'author');
    const imported = await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/case',
      material_level: 'api_summary',
      body: '作者材料。',
    });

    const first = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(author.token),
      payload: { source_id: imported.sourceId, launch_type: 'author_initiated' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.case.author_user_id).toBe(author.user.id);
    expect(first.json().data.case.status).toBe('candidate');
    expect(first.json().data.deduped).toBe(false);

    const second = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(author.token),
      payload: { source_id: imported.sourceId, launch_type: 'author_initiated' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.deduped).toBe(true);
    expect(second.json().data.case.id).toBe(first.json().data.case.id);
  });

  it('refuses a reader and an unrelated author opening a case', async () => {
    const author = await seedUser(h, 'author');
    const stranger = await seedUser(h, 'author');
    const reader = await seedUser(h, 'reader');
    const imported = await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/case-deny',
      material_level: 'api_summary',
      body: '作者材料。',
    });

    const asReader = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(reader.token),
      payload: { source_id: imported.sourceId, launch_type: 'reader_initiated' },
    });
    expect(asReader.statusCode).toBe(403);

    const asStranger = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(stranger.token),
      payload: { source_id: imported.sourceId, launch_type: 'author_initiated' },
    });
    expect(asStranger.statusCode).toBe(403);
  });

  it('records one invitation per case, idempotently, and never sends anything', async () => {
    const setup = await setupBoundCase(h);

    const first = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/invitations`,
      headers: auth(setup.researcher.token),
      payload: { channel: 'manual', consent_version: 'v1' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.deduped).toBe(false);
    expect(first.json().data.case_status).toBe('invite_recorded');
    expect(first.json().data.invitation.result).toBe('pending');

    const second = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/invitations`,
      headers: auth(setup.researcher.token),
      payload: { channel: 'manual' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.deduped).toBe(true);
    expect(second.json().data.invitation.id).toBe(first.json().data.invitation.id);

    const rows = await h.ctx.db
      .select()
      .from(invitations)
      .where(eq(invitations.caseId, setup.caseId));
    expect(rows).toHaveLength(1);
  });

  it('requires authorized current-snapshot human review and rejects stale concurrent reviews', async () => {
    const setup = await setupBoundCase(h, false);
    const invite = () => h.app.inject({ method: 'POST', url: `/api/cases/${setup.caseId}/invitations`, headers: auth(setup.researcher.token), payload: { channel: 'manual' } });
    expect((await invite()).statusCode).toBe(409);
    const [current] = await h.ctx.db.select().from(followupCases).where(eq(followupCases.id, setup.caseId));
    const [snapshot] = await h.ctx.db.select().from(sourceSnapshots).where(eq(sourceSnapshots.sourceId, setup.sourceId));
    const payload = { expected_version: current!.updatedAt.toISOString(), snapshot_hash: snapshot!.contentHash, decision: 'eligible', reason_code: 'source_checked', evidence_ref: 'evidence://test_fixture/review', confirms_source_and_safety_review: true };
    const reviewUrl = `/api/cases/${setup.caseId}/review`;
    expect((await h.app.inject({ method: 'POST', url: reviewUrl, headers: auth(setup.author.token), payload })).statusCode).toBe(403);
    const stranger = await seedUser(h, 'researcher');
    expect((await h.app.inject({ method: 'POST', url: reviewUrl, headers: auth(stranger.token), payload })).statusCode).toBe(403);
    const reviews = await Promise.all(Array.from({ length: 2 }, () => h.app.inject({ method: 'POST', url: reviewUrl, headers: auth(setup.researcher.token), payload })));
    expect(reviews.map(r => r.statusCode).sort()).toEqual([200, 409]);
    await h.ctx.db.insert(sourceSnapshots).values({ sourceId: setup.sourceId, version: 2, materialLevel: 'api_summary', body: '新的测试材料', contentHash: 'changed_fixture_hash' });
    expect((await invite()).statusCode).toBe(409);
    const [revised] = await h.ctx.db.select().from(followupCases).where(eq(followupCases.id, setup.caseId));
    const reviewed = await h.app.inject({ method: 'POST', url: reviewUrl, headers: auth(setup.researcher.token), payload: { ...payload, expected_version: revised!.updatedAt.toISOString(), snapshot_hash: 'changed_fixture_hash' } });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect((await invite()).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: `/api/cases/${setup.caseId}/decision`, headers: auth(setup.author.token), payload: { decision: 'decline' } })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: reviewUrl, headers: auth(setup.researcher.token), payload: { ...payload, expected_version: reviewed.json().data.version, snapshot_hash: 'changed_fixture_hash' } })).statusCode).toBe(409);
  });

  it('only lets the responsible researcher record an invitation', async () => {
    const setup = await setupBoundCase(h);
    const outsider = await seedUser(h, 'researcher');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/invitations`,
      headers: auth(outsider.token),
      payload: { channel: 'manual' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not let a forwarded invitation decide for the author', async () => {
    const setup = await setupBoundCase(h);

    // A different logged-in author cannot act on this case.
    const forwarded = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/decision`,
      headers: auth(setup.other.token),
      payload: { decision: 'accept' },
    });
    expect(forwarded.statusCode).toBe(404);

    // Even the assigned researcher cannot accept on the author's behalf.
    const researcherDecision = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/decision`,
      headers: auth(setup.researcher.token),
      payload: { decision: 'accept' },
    });
    expect(researcherDecision.statusCode).toBe(404);
  });

  it.each(['pending', 'no_response_in_window', 'replied'] as const)('records bound-author acceptance time after %s', async prior => {
    const setup = await setupBoundCase(h);
    const [invitation] = await h.ctx.db.insert(invitations).values({ caseId: setup.caseId, result: prior }).returning();
    const before = Date.now();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/decision`,
      headers: auth(setup.author.token),
      payload: { decision: 'accept' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.case.status).toBe('accepted');
    const [saved] = await h.ctx.db.select().from(invitations).where(eq(invitations.id, invitation!.id));
    expect(saved!.respondedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(saved!.respondedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('blocks any further invitation after a decline, and never auto-reopens the case', async () => {
    const setup = await setupBoundCase(h);

    await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/invitations`,
      headers: auth(setup.researcher.token),
      payload: { channel: 'manual' },
    });

    const decline = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/decision`,
      headers: auth(setup.author.token),
      payload: { decision: 'decline' },
    });
    expect(decline.statusCode).toBe(200);
    expect(decline.json().data.case.status).toBe('declined');
    expect(decline.json().data.case.decline_flag).toBe(true);

    const storedInvitation = await h.ctx.db
      .select()
      .from(invitations)
      .where(eq(invitations.caseId, setup.caseId));
    expect(storedInvitation[0]!.result).toBe('declined');

    const reInvite = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/invitations`,
      headers: auth(setup.researcher.token),
      payload: { channel: 'manual' },
    });
    expect(reInvite.statusCode).toBe(409);

    const reopen = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(setup.researcher.token),
      payload: { source_id: setup.sourceId, launch_type: 'reader_initiated' },
    });
    expect(reopen.statusCode).toBe(409);
  });

  it('records do-not-contact distinctly', async () => {
    const setup = await setupBoundCase(h);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${setup.caseId}/decision`,
      headers: auth(setup.author.token),
      payload: { decision: 'do_not_contact' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.case.do_not_contact).toBe(true);
    expect(res.json().data.case.decline_flag).toBe(true);
  });

  it('keeps an unauthorized source on hold and refuses to invite', async () => {
    const reader = await seedUser(h, 'reader');
    const researcher = await seedUser(h, 'researcher');

    // A reader-submitted third-party link stays pending private review.
    const thirdParty = await importSource(h, reader.token, {
      source_type: 'third_party_link',
      original_url: 'https://example.test/third/hold',
      material_level: 'api_summary',
      body: '第三方链接摘要。',
    });
    expect(thirdParty.body.permission_status).toBe('pending');

    const caseRes = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(researcher.token),
      payload: { source_id: thirdParty.sourceId, launch_type: 'reader_initiated' },
    });
    expect(caseRes.statusCode).toBe(200);
    expect(caseRes.json().data.case.status).toBe('hold');
    const caseId = caseRes.json().data.case.id as string;

    const invite = await h.app.inject({
      method: 'POST',
      url: `/api/cases/${caseId}/invitations`,
      headers: auth(researcher.token),
      payload: { channel: 'manual' },
    });
    expect(invite.statusCode).toBe(409);
  });

  it('scopes case reads to the bound author, the responsible researcher and admins', async () => {
    const setup = await setupBoundCase(h);
    const outsider = await seedUser(h, 'researcher');

    const asResearcher = await h.app.inject({
      method: 'GET',
      url: `/api/cases/${setup.caseId}`,
      headers: auth(setup.researcher.token),
    });
    expect(asResearcher.statusCode).toBe(200);

    const asAuthor = await h.app.inject({
      method: 'GET',
      url: `/api/cases/${setup.caseId}`,
      headers: auth(setup.author.token),
    });
    expect(asAuthor.statusCode).toBe(200);

    const asAdmin = await h.app.inject({
      method: 'GET',
      url: `/api/cases/${setup.caseId}`,
      headers: auth(setup.admin.token),
    });
    expect(asAdmin.statusCode).toBe(200);

    const asOutsider = await h.app.inject({
      method: 'GET',
      url: `/api/cases/${setup.caseId}`,
      headers: auth(outsider.token),
    });
    expect(asOutsider.statusCode).toBe(404);
  });
});
