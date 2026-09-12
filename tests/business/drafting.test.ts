import { createServer, type Server } from 'node:http';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createHarness, seedPublishedStory, seedUser, type Harness } from './helpers.js';
import { aiRuns, consents, followupVersions, interviewSessions, interviewMessages } from '../../src/db/schema.js';
import { runJob } from '../helpers/run-job.js';

describe('AI-C evidence-bound draft creation with simulated HTTP provider', () => {
  let h: Harness;
  let server: Server;
  let mode: 'valid' | 'leak' | 'invented' | 'hold' = 'valid';
  let release: (() => void) | undefined;
  let calls = 0;
  beforeAll(async () => {
    h = await createHarness();
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      calls++;
      const input = JSON.parse(JSON.parse(raw).messages[1].content);
      const evidence = input.evidence.find((e: { id: string; visibility: string }) => e.id.startsWith('message:') && e.visibility === (mode === 'leak' ? 'private' : 'public'));
      const response = { statements: [{ id: 's1', text: mode === 'invented' ? '2025年收入100万元' : evidence.text, kind: 'author_report', evidence_refs: [evidence.id], visibility: 'public' }], unresolved_items: ['未提供具体完成日期'] };
      const send = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: 'test_fixture', choices: [{ message: { content: JSON.stringify(response) } }] })); };
      if (mode === 'hold') release = send; else send();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    h.moduleCtx.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    h.moduleCtx.env.LLM_MODEL = 'test_fixture';
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await h.close(); });
  it('creates an unconfirmed version, rejects invented facts/private leaks, and discards output after an author edit', async () => {
    const author = await seedUser(h, 'author', 'test_fixture');
    const story = await seedPublishedStory(h, { author: author.user, verifyAuthor: true });
    const [session] = await h.ctx.db.insert(interviewSessions).values({ caseId: story.followupCase.id, ownerUserId: author.user.id, snapshotId: story.snapshot.id, status: 'finished', mode: 'manual' }).returning();
    await h.ctx.db.insert(interviewMessages).values([
      { sessionId: session!.id, role: 'author', sequence: 1, authorMessage: '项目后来完成了。', visibility: 'public' },
      { sessionId: session!.id, role: 'author', sequence: 2, authorMessage: '这段私有内容不能公开。', visibility: 'private' },
    ]);
    await h.ctx.db.insert(consents).values({ userId: author.user.id, sourceId: story.source.id, purpose: 'private_interview' });
    const url = `/api/interviews/${session!.id}/draft-ai`;
    const enqueue = (expected_version: number) => h.app.inject({ method: 'POST', url, headers: auth(author.token), payload: { expected_version } });
    expect((await enqueue(1)).statusCode).toBe(422);
    expect(calls).toBe(0);
    await h.ctx.db.insert(consents).values({ userId: author.user.id, sourceId: story.source.id, purpose: 'external_model_processing' });
    expect((await enqueue(0)).statusCode).toBe(409);
    expect((await enqueue(1)).statusCode).toBe(202);
    const valid = await runJob(h.moduleCtx, 'ai.draft');
    const draftId = valid?.data?.draft_id as string;
    const [draft] = await h.ctx.db.select().from(followupVersions).where(eq(followupVersions.id, draftId));
    expect(draft?.version).toBe(2);
    expect(draft?.status).toBe('draft');
    expect(draft?.authorConfirmations).toEqual([]);
    expect(draft?.aiAssisted).toBe(true);
    expect((await h.app.inject({ method: 'POST', url: `/api/drafts/${draftId}/publish`, headers: auth(author.token), payload: { content_hash: draft!.contentHash, confirms_publication: true } })).statusCode).toBe(409);
    expect((await h.ctx.db.select().from(followupVersions).where(eq(followupVersions.id, story.versionId)))[0]?.status).toBe('published');
    for (const badMode of ['leak', 'invented'] as const) {
      mode = badMode;
      expect((await enqueue(2)).statusCode).toBe(202);
      const invalid = await runJob(h.moduleCtx, 'ai.draft');
      expect(invalid?.data?.draft_id).toBeNull();
      expect(invalid?.data?.error_code).toBe('source_incomplete');
    }
    expect(await h.ctx.db.select().from(followupVersions).where(eq(followupVersions.caseId, story.followupCase.id))).toHaveLength(2);
    mode = 'hold';
    expect((await enqueue(2)).statusCode).toBe(202);
    const running = runJob(h.moduleCtx, 'ai.draft').then(() => null, err => err);
    const deadline = Date.now() + 5000;
    while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    expect(release).toBeTypeOf('function');
    const edited = await h.app.inject({ method: 'PATCH', url: `/api/drafts/${draftId}`, headers: auth(author.token), payload: { expected_version: 2, statements: [{ id: 'e1', text: '作者手动修改的内容', kind: 'author_report', visibility: 'public', evidence_refs: [] }] } });
    expect(edited.statusCode, edited.body).toBe(200);
    release!(); release = undefined; mode = 'valid';
    expect(await running).toBeInstanceOf(Error);
    const runs = await h.ctx.db.select().from(aiRuns).where(eq(aiRuns.sourceId, story.source.id));
    expect(runs.some(r => r.status === 'running')).toBe(false);
    expect(runs.some(r => r.status === 'cancelled' && r.errorCode === 'context_invalidated' && r.output === null)).toBe(true);
    const versions = await h.ctx.db.select().from(followupVersions).where(eq(followupVersions.caseId, story.followupCase.id));
    expect(versions).toHaveLength(3);
    expect(versions.find(v => v.version === 3)?.aiAssisted).toBe(true);
    expect(JSON.stringify(versions.find(v => v.version === 3)?.statements)).toContain('作者手动修改的内容');
  });
});
