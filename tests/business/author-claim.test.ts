import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { truncateAll } from '../helpers/testdb.js';
import { authorVerifications, sourceSnapshots } from '../../src/db/schema.js';
import { auth, createHarness, importSource, seedUser, type Harness } from './helpers.js';

/**
 * A self-claim is a declaration, not a verification. It exists so that the
 * author of an imported answer can write their own follow-up, while a third
 * party who merely registered someone else's link gains nothing.
 */
describe('sources: author self-claim (private rights only)', () => {
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

  /** The link import the whole flow starts from. */
  async function importedLink(token: string, url = 'https://example.test/claim/1') {
    return importSource(h, token, {
      source_type: 'third_party_link',
      original_url: url,
      material_level: 'api_summary',
      body: '官方摘要：我在大厂工作五年后辞职。',
    });
  }

  function claim(token: string, sourceId: string, payload: Record<string, unknown> = {}) {
    return h.app.inject({
      method: 'POST',
      url: `/api/sources/${sourceId}/author-claim`,
      headers: auth(token),
      payload: {
        excerpt: '我在大厂工作了五年，上周提交了辞职申请。',
        confirms_own_content: true,
        ...payload,
      },
    });
  }

  it('records a pending self-claim, the author text, and a private-only source', async () => {
    const author = await seedUser(h, 'author');
    const imported = await importedLink(author.token);

    const res = await claim(author.token, imported.sourceId);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.verification.method).toBe('self_claim');
    expect(data.verification.status).toBe('pending');
    expect(data.verification.verified_at).toBeNull();
    expect(data.verification.evidence_ref).toBeNull();
    expect(data.snapshot.material_level).toBe('exact_excerpt');
    expect(data.snapshot.excerpt).toBe('我在大厂工作了五年，上周提交了辞职申请。');
    expect(data.source.permission_status).toBe('private_only');
  });

  it('keeps the declared publication date as the author gave it, and never invents one', async () => {
    const author = await seedUser(h, 'author');
    const imported = await importedLink(author.token, 'https://example.test/claim/date');

    const undated = await claim(author.token, imported.sourceId);
    expect(undated.json().data.snapshot.published_at).toBeNull();

    const dated = await claim(author.token, imported.sourceId, {
      excerpt: '另一段原回答。',
      published_at: '2021-06-12T00:00:00.000Z',
    });
    expect(dated.json().data.snapshot.published_at).toBe('2021-06-12T00:00:00.000Z');
  });

  it('refuses a claim from anyone but the user who registered the link', async () => {
    const owner = await seedUser(h, 'author');
    const stranger = await seedUser(h, 'author');
    const imported = await importedLink(owner.token, 'https://example.test/claim/stranger');

    const res = await claim(stranger.token, imported.sourceId);
    expect(res.statusCode).toBe(403);
    expect(res.json().error_code).toBe('forbidden');
  });

  it('requires the original text: a claim without material is not a claim', async () => {
    const author = await seedUser(h, 'author');
    const imported = await importedLink(author.token, 'https://example.test/claim/empty');

    const blank = await claim(author.token, imported.sourceId, { excerpt: '   ' });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error_code).toBe('validation_error');

    const missingConsent = await claim(author.token, imported.sourceId, { confirms_own_content: false });
    expect(missingConsent.statusCode).toBe(400);
  });

  it('does not accept a claim on a source that was never a link import', async () => {
    const author = await seedUser(h, 'author');
    const own = await importSource(h, author.token, {
      source_type: 'author_paste',
      original_url: 'https://example.test/claim/paste',
      material_level: 'exact_excerpt',
      excerpt: '作者自己粘贴的内容。',
    });

    const res = await claim(author.token, own.sourceId);
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe('validation_error');
  });

  it('is idempotent: the same text never creates a second snapshot or claim', async () => {
    const author = await seedUser(h, 'author');
    const imported = await importedLink(author.token, 'https://example.test/claim/idempotent');

    const first = await claim(author.token, imported.sourceId);
    const second = await claim(author.token, imported.sourceId);
    expect(first.json().data.deduped).toBe(false);
    expect(second.json().data.deduped).toBe(true);

    const snapshots = await h.ctx.db
      .select()
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.sourceId, imported.sourceId));
    expect(snapshots).toHaveLength(2);
    const claims = await h.ctx.db
      .select()
      .from(authorVerifications)
      .where(
        and(
          eq(authorVerifications.sourceId, imported.sourceId),
          eq(authorVerifications.method, 'self_claim'),
        ),
      );
    expect(claims).toHaveLength(1);
  });

  it('lets the claiming author open their own follow-up case', async () => {
    const author = await seedUser(h, 'author');
    const imported = await importedLink(author.token, 'https://example.test/claim/case');

    const before = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(author.token),
      payload: { source_id: imported.sourceId, launch_type: 'author_initiated' },
    });
    expect(before.statusCode).toBe(403);

    await claim(author.token, imported.sourceId);

    const after = await h.app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: auth(author.token),
      payload: { source_id: imported.sourceId, launch_type: 'author_initiated' },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().data.case.author_user_id).toBe(author.user.id);
  });

  it('never lets a self-claim turn a source public', async () => {
    const author = await seedUser(h, 'author');
    const imported = await importedLink(author.token, 'https://example.test/claim/public');
    await claim(author.token, imported.sourceId);

    const grant = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/consents`,
      headers: auth(author.token),
      payload: { purpose: 'demo_public_display' },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().data.source_permission_status).toBe('private_only');

    const stories = await h.app.inject({ url: '/api/stories' });
    expect(stories.json().data.items.map((item: { source_id: string }) => item.source_id))
      .not.toContain(imported.sourceId);
  });
});
