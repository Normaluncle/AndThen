import { createServer, type Server } from 'node:http';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createHarness, seedPublishedStory, seedUser, type Harness } from './helpers.js';
import { consents, followupVersions } from '../../src/db/schema.js';
import { contentHash } from '../../src/ai/evidence.js';
import { runJob } from '../helpers/run-job.js';

describe('AI-D advisory findings cannot bypass deterministic confirmation gates', () => {
  let h: Harness;
  let server: Server;
  let calls = 0;
  beforeAll(async () => {
    h = await createHarness();
    server = createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume test body */ }
      calls++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'test_fixture', choices: [{ message: { content: JSON.stringify({ findings: [{ code: 'sensitive_field', severity: 'blocking', statement_id: 's1', message: 'Requires author revision' }], blocking: false }) } }] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    h.moduleCtx.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    h.moduleCtx.env.LLM_MODEL = 'test_fixture';
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await h.close(); });
  it('returns honest rule-only mode without consent, blocks pending and blocking model findings, and rejects old hashes', async () => {
    const author = await seedUser(h, 'author', 'test_fixture');
    const story = await seedPublishedStory(h, { author: author.user, verifyAuthor: true });
    const statements = [{ id: 's1', text: story.snapshot.excerpt!, kind: 'source_quote', visibility: 'public', evidence_refs: [`snapshot:${story.snapshot.id}`] }];
    const hash = contentHash(statements);
    await h.ctx.db.update(followupVersions).set({ status: 'draft', statements, contentHash: hash, snapshotId: story.snapshot.id, confirmedAt: null }).where(eq(followupVersions.id, story.versionId));
    const base = `/api/drafts/${story.versionId}`;
    const validate = () => h.app.inject({ method: 'POST', url: `${base}/validate`, headers: auth(author.token), payload: { content_hash: hash } });
    const initial = await validate();
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json().data.reason).toBe('model_consent_missing');
    expect(calls).toBe(0);
    await h.ctx.db.insert(consents).values({ userId: author.user.id, sourceId: story.source.id, purpose: 'external_model_processing' });
    expect((await validate()).statusCode).toBe(202);
    const confirm = () => h.app.inject({ method: 'POST', url: `${base}/confirm`, headers: auth(author.token), payload: { content_hash: hash, statement_ids: ['s1'] } });
    expect((await confirm()).statusCode).toBe(409);
    const job = await runJob(h.moduleCtx, 'ai.validate');
    expect((job?.data?.validation as { blocking: boolean }).blocking).toBe(true); // severity wins even when model says blocking:false
    expect((await confirm()).statusCode).toBe(422);
    expect((await h.app.inject({ method: 'POST', url: `${base}/validate`, headers: auth(author.token), payload: { content_hash: 'a'.repeat(64) } })).statusCode).toBe(409);
    const edited = await h.app.inject({ method: 'PATCH', url: base, headers: auth(author.token), payload: { expected_version: 1, statements: [{ ...statements[0], text: '作者修改后的明确陈述' }] } });
    expect(edited.statusCode, edited.body).toBe(200);
    const next = edited.json().data;
    expect((await h.app.inject({ method: 'POST', url: `/api/drafts/${next.id}/confirm`, headers: auth(author.token), payload: { content_hash: next.contentHash, statement_ids: ['s1'] } })).statusCode).toBe(200);
  });
});
