import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authorVerifications, sourceSnapshots, sources } from '../../src/db/schema.js';
import { truncateAll } from '../helpers/testdb.js';
import { auth, createHarness, importSource, seedUser, type Harness } from './helpers.js';

describe('sources: import, dedupe, material rules and private read', () => {
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

  it('is idempotent: resubmitting the same material creates no second snapshot', async () => {
    const author = await seedUser(h, 'author');
    const payload = {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/1',
      title: '一段旧经历',
      material_level: 'exact_excerpt',
      excerpt: '当时我决定先完成这个项目。',
      excerpt_location: '第 2 段',
      published_at: '2021-03-01T00:00:00Z',
    };

    const first = await importSource(h, author.token, payload);
    expect(first.body.deduped).toBe(false);

    const second = await importSource(h, author.token, payload);
    expect(second.body.deduped).toBe(true);
    expect(second.sourceId).toBe(first.sourceId);

    const snapshots = await h.ctx.db
      .select()
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.sourceId, first.sourceId));
    expect(snapshots).toHaveLength(1);

    const rows = await h.ctx.db.select().from(sources).where(eq(sources.id, first.sourceId));
    expect(rows).toHaveLength(1);
  });

  it('creates a new immutable version when the material actually changes', async () => {
    const author = await seedUser(h, 'author');
    const first = await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/2',
      material_level: 'exact_excerpt',
      excerpt: '第一版原文片段。',
    });
    const second = await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/2',
      material_level: 'exact_excerpt',
      excerpt: '第二版原文片段，内容已更新。',
    });

    expect(second.sourceId).toBe(first.sourceId);
    expect(second.body.deduped).toBe(false);
    expect(second.body.version).toBe(2);

    const snapshots = await h.ctx.db
      .select()
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.sourceId, first.sourceId));
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.version).sort()).toEqual([1, 2]);
  });

  it('rejects unrelated replacement and removes importer replacement rights after verified ownership', async () => {
    const reader = await seedUser(h, 'reader');
    const stranger = await seedUser(h, 'author');
    const owner = await seedUser(h, 'author');
    const payload = { source_type: 'third_party_link', original_url: 'https://example.test/ownership', material_level: 'api_summary', body: 'Original fixture summary' };
    const initial = await importSource(h, reader.token, payload);
    const replace = (token: string, body: string) => h.app.inject({ method: 'POST', url: '/api/sources', headers: auth(token), payload: { ...payload, body } });
    expect((await replace(stranger.token, 'Unrelated replacement')).statusCode).toBe(403);
    expect((await replace(reader.token, 'Importer revision')).statusCode).toBe(200);
    await h.ctx.db.insert(authorVerifications).values({ sourceId: initial.sourceId, userId: owner.user.id, method: 'manual', status: 'verified', evidenceRef: 'fixture-ownership' });
    expect((await replace(reader.token, 'Old importer overwrite')).statusCode).toBe(403);
    expect((await replace(owner.token, 'Verified author revision')).statusCode).toBe(200);
    const snapshots = await h.ctx.db.select().from(sourceSnapshots).where(eq(sourceSnapshots.sourceId, initial.sourceId));
    expect(snapshots).toHaveLength(3);
    expect(snapshots.map(s => s.body)).not.toContain('Unrelated replacement');
    expect(snapshots.map(s => s.body)).not.toContain('Old importer overwrite');
  });

  it('rejects an exact_excerpt without the excerpt text', async () => {
    const author = await seedUser(h, 'author');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: auth(author.token),
      payload: {
        source_type: 'author_paste',
        material_level: 'exact_excerpt',
        body: '这只是一段摘要，不是原话。',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error_code).toBe('source_incomplete');
  });

  it('never lets a summary masquerade as a verbatim quote', async () => {
    const author = await seedUser(h, 'author');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: auth(author.token),
      payload: {
        source_type: 'author_paste',
        material_level: 'api_summary',
        body: '接口返回的摘要。',
        excerpt: '这会被误当作原话。',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe('validation_error');
  });

  it('keeps unknown times null and preserves known times', async () => {
    const author = await seedUser(h, 'author');
    const researcher = await seedUser(h, 'researcher');
    const unknown = await importSource(h, researcher.token, {
      source_type: 'official_search',
      original_url: 'https://example.test/a/unknown-time',
      material_level: 'api_summary',
      body: '只有摘要，没有时间信息。',
    });
    const resUnknown = await h.app.inject({
      method: 'GET',
      url: `/api/sources/${unknown.sourceId}`,
      headers: auth(researcher.token),
    });
    expect(resUnknown.statusCode).toBe(200);
    const snapUnknown = resUnknown.json().data.snapshots[0];
    expect(snapUnknown.published_at).toBeNull();
    expect(snapUnknown.upstream_updated_at).toBeNull();
    expect(snapUnknown.acquired_at).not.toBeNull();

    const known = await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/known-time',
      material_level: 'exact_excerpt',
      excerpt: '带时间的原话。',
      published_at: '2020-05-05T00:00:00Z',
    });
    const resKnown = await h.app.inject({
      method: 'GET',
      url: `/api/sources/${known.sourceId}`,
      headers: auth(author.token),
    });
    const snapKnown = resKnown.json().data.snapshots[0];
    expect(snapKnown.published_at).toBe('2020-05-05T00:00:00.000Z');
  });

  it('applies role and source-type rules', async () => {
    const author = await seedUser(h, 'author');
    const reader = await seedUser(h, 'reader');
    const researcher = await seedUser(h, 'researcher');

    // A reader may only submit a third-party link, which stays private-pending.
    const thirdParty = await importSource(h, reader.token, {
      source_type: 'third_party_link',
      original_url: 'https://example.test/third/1',
      material_level: 'api_summary',
      body: '读者提交的第三方链接摘要。',
    });
    expect(thirdParty.body.permission_status).toBe('pending');

    const readerAuthorPaste = await h.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: auth(reader.token),
      payload: { source_type: 'author_paste', material_level: 'api_summary', body: 'x' },
    });
    expect(readerAuthorPaste.statusCode).toBe(403);

    // A self-imported author_paste is private until verified + consented.
    const own = await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/own',
      material_level: 'api_summary',
      body: '作者自己的材料。',
    });
    expect(own.body.permission_status).toBe('private_only');

    // Only research/ops may claim real_authorized provenance.
    const claimReal = await h.app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: auth(author.token),
      payload: {
        source_type: 'author_paste',
        material_level: 'api_summary',
        body: 'x',
        provenance: 'real_authorized',
      },
    });
    expect(claimReal.statusCode).toBe(403);

    // A researcher may register controlled material, but that does not make
    // them the author.
    const controlled = await importSource(h, researcher.token, {
      source_type: 'researcher_import',
      original_url: 'https://example.test/r/1',
      material_level: 'api_summary',
      body: '研究员登记的材料。',
      provenance: 'real_authorized',
    });
    expect(controlled.body.permission_status).toBe('private_only');
    expect(controlled.body.provenance).toBe('real_authorized');
  });

  it('hides another user\u2019s private source behind not_found', async () => {
    const owner = await seedUser(h, 'author');
    const stranger = await seedUser(h, 'author');
    const admin = await seedUser(h, 'admin');

    const imported = await importSource(h, owner.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/private',
      material_level: 'api_summary',
      body: '私有材料。',
    });

    const ownerRead = await h.app.inject({
      method: 'GET',
      url: `/api/sources/${imported.sourceId}`,
      headers: auth(owner.token),
    });
    expect(ownerRead.statusCode).toBe(200);

    const strangerRead = await h.app.inject({
      method: 'GET',
      url: `/api/sources/${imported.sourceId}`,
      headers: auth(stranger.token),
    });
    expect(strangerRead.statusCode).toBe(404);

    const adminRead = await h.app.inject({
      method: 'GET',
      url: `/api/sources/${imported.sourceId}`,
      headers: auth(admin.token),
    });
    expect(adminRead.statusCode).toBe(200);

    const anonymous = await h.app.inject({ method: 'GET', url: `/api/sources/${imported.sourceId}` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('lets only the responsible researcher read a controlled source', async () => {
    const owner = await seedUser(h, 'researcher');
    const other = await seedUser(h, 'researcher');
    const imported = await importSource(h, owner.token, {
      source_type: 'researcher_import',
      original_url: 'https://example.test/r/assigned',
      material_level: 'api_summary',
      body: '受控材料。',
    });

    const otherRead = await h.app.inject({
      method: 'GET',
      url: `/api/sources/${imported.sourceId}`,
      headers: auth(other.token),
    });
    expect(otherRead.statusCode).toBe(404);

    // Once the other researcher opens a case on it, they become responsible.
    const caseRes = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(other.token),
      payload: { source_id: imported.sourceId, launch_type: 'reader_initiated' },
    });
    expect(caseRes.statusCode).toBe(200);

    const otherReadAfter = await h.app.inject({
      method: 'GET',
      url: `/api/sources/${imported.sourceId}`,
      headers: auth(other.token),
    });
    expect(otherReadAfter.statusCode).toBe(200);
  });

  it('lists snapshots on the dedicated endpoint', async () => {
    const author = await seedUser(h, 'author');
    const imported = await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/snaps',
      material_level: 'exact_excerpt',
      excerpt: 'v1',
    });
    await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/a/snaps',
      material_level: 'exact_excerpt',
      excerpt: 'v2',
    });

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/sources/${imported.sourceId}/snapshots`,
      headers: auth(author.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items).toHaveLength(2);
    expect(res.json().data.items[0].version).toBe(2);
  });
});
