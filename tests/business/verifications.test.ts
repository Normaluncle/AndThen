import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from '../helpers/testdb.js';
import { auth, createHarness, importSource, seedUser, type Harness } from './helpers.js';

describe('sources: author verification (weak evidence never auto-passes)', () => {
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

  it('records a manual verification as pending by default', async () => {
    const researcher = await seedUser(h, 'researcher');
    const author = await seedUser(h, 'author');
    const imported = await importSource(h, researcher.token, {
      source_type: 'researcher_import',
      original_url: 'https://example.test/r/verify',
      material_level: 'api_summary',
      body: '受控材料。',
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/author-verifications`,
      headers: auth(researcher.token),
      payload: { subject_user_id: author.user.id, method: 'manual', evidence_ref: 'evidence://x/1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.verification.status).toBe('pending');
    expect(res.json().data.verification.verified_at).toBeNull();

    // A pending link does not make the author verified.
    const grant = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/consents`,
      headers: auth(author.token),
      payload: { purpose: 'demo_public_display' },
    });
    // The author is not the importer, so they cannot even grant here.
    expect(grant.statusCode).toBe(403);
  });

  it('forbids a researcher from approving weak (manual) evidence', async () => {
    const researcher = await seedUser(h, 'researcher');
    const author = await seedUser(h, 'author');
    const imported = await importSource(h, researcher.token, {
      source_type: 'researcher_import',
      original_url: 'https://example.test/r/weak',
      material_level: 'api_summary',
      body: '受控材料。',
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/author-verifications`,
      headers: auth(researcher.token),
      payload: {
        subject_user_id: author.user.id,
        method: 'manual',
        evidence_ref: 'evidence://x/2',
        approve: true,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error_code).toBe('forbidden');
  });

  it('requires a controlled evidence reference before marking verified', async () => {
    const admin = await seedUser(h, 'admin');
    const author = await seedUser(h, 'author');
    const imported = await importSource(h, admin.token, {
      source_type: 'researcher_import',
      original_url: 'https://example.test/r/no-evidence',
      material_level: 'api_summary',
      body: '受控材料。',
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/author-verifications`,
      headers: auth(admin.token),
      payload: { subject_user_id: author.user.id, method: 'manual', approve: true },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error_code).toBe('source_incomplete');
  });

  it('refuses to verify the acting user from their own session', async () => {
    const researcher = await seedUser(h, 'researcher');
    const imported = await importSource(h, researcher.token, {
      source_type: 'researcher_import',
      original_url: 'https://example.test/r/self',
      material_level: 'api_summary',
      body: '受控材料。',
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/author-verifications`,
      headers: auth(researcher.token),
      payload: {
        subject_user_id: researcher.user.id,
        method: 'oauth',
        evidence_ref: 'evidence://x/self',
        approve: true,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets an admin approve with evidence, then the author can publish-consent', async () => {
    const admin = await seedUser(h, 'admin');
    const author = await seedUser(h, 'author');
    const imported = await importSource(h, admin.token, {
      source_type: 'researcher_import',
      original_url: 'https://example.test/r/approve',
      material_level: 'api_summary',
      body: '受控材料。',
    });

    const approve = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/author-verifications`,
      headers: auth(admin.token),
      payload: {
        subject_user_id: author.user.id,
        method: 'manual',
        evidence_ref: 'evidence://controlled/42',
        scope: 'this source only',
        approve: true,
      },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().data.verification.status).toBe('verified');
    expect(approve.json().data.verification.verified_at).not.toBeNull();
    expect(approve.json().data.verification.evidence_ref).toBe('evidence://controlled/42');

    // Now the verified author may grant public display, flipping the source.
    const grant = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/consents`,
      headers: auth(author.token),
      payload: { purpose: 'demo_public_display' },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().data.source_permission_status).toBe('public_approved');
  });

  it('binds an open case to the verified author', async () => {
    const researcher = await seedUser(h, 'researcher');
    const admin = await seedUser(h, 'admin');
    const author = await seedUser(h, 'author');
    const imported = await importSource(h, researcher.token, {
      source_type: 'researcher_import',
      original_url: 'https://example.test/r/bind',
      material_level: 'api_summary',
      body: '受控材料。',
    });

    const caseRes = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(researcher.token),
      payload: { source_id: imported.sourceId, launch_type: 'reader_initiated' },
    });
    expect(caseRes.statusCode).toBe(200);
    expect(caseRes.json().data.case.author_user_id).toBeNull();
    const caseId = caseRes.json().data.case.id as string;

    await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/author-verifications`,
      headers: auth(admin.token),
      payload: {
        subject_user_id: author.user.id,
        method: 'manual',
        evidence_ref: 'evidence://controlled/43',
        approve: true,
      },
    });

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/cases/${caseId}`,
      headers: auth(researcher.token),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.case.author_user_id).toBe(author.user.id);
    expect(detail.json().data.author_bound).toBe(true);
    expect(detail.json().data.author_verified).toBe(true);
  });

  it('refuses to verify a second user against an already-verified source', async () => {
    const admin = await seedUser(h, 'admin');
    const authorA = await seedUser(h, 'author');
    const authorB = await seedUser(h, 'author');
    const imported = await importSource(h, admin.token, {
      source_type: 'researcher_import',
      original_url: 'https://example.test/r/conflict',
      material_level: 'api_summary',
      body: '受控材料。',
    });

    await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/author-verifications`,
      headers: auth(admin.token),
      payload: {
        subject_user_id: authorA.user.id,
        method: 'manual',
        evidence_ref: 'evidence://a',
        approve: true,
      },
    });

    const second = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/author-verifications`,
      headers: auth(admin.token),
      payload: {
        subject_user_id: authorB.user.id,
        method: 'manual',
        evidence_ref: 'evidence://b',
        approve: true,
      },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error_code).toBe('conflict');
  });
});
