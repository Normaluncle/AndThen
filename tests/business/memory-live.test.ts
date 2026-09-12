import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createHarness, seedUser, seedPublishedStory, auth, type Harness } from './helpers.js';
import { authorMemories, consents, followupCases, jobs } from '../../src/db/schema.js';
import { runJob } from '../helpers/run-job.js';
import { recallMemory } from '../../src/modules/memory/service.js';

describe.skipIf(process.env.MEMORY_LIVE_TEST !== '1')('real Qwen -> memU -> interview integration', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    const cfg = parse(readFileSync('.env.local'));
    for (const k of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'MEMORY_SERVICE_URL', 'MEMORY_SERVICE_TOKEN'] as const) h.ctx.env[k] = cfg[k];
    h.ctx.env.LLM_TIMEOUT_MS = 60000;
  });
  afterAll(async () => {
    if(h){const pending=await h.ctx.db.select().from(jobs).where(and(eq(jobs.kind,'memory.delete'),eq(jobs.status,'queued')));for(const _ of pending)await runJob(h.moduleCtx,'memory.delete');}
    await h?.close();
  });
  it('builds authorized memories, retrieves them, generates a grounded question and invalidates on revocation', async () => {
    const a = await seedUser(h, 'author');
    const b = await seedUser(h, 'author');
    const story = await seedPublishedStory(h, { author: a.user, verifyAuthor: true,
      excerpt: '测试资料：2021年我决定从会计转行做程序员，原计划半年，实际上学习八个月后找到了第一份软件工作。请不要在采访中问我的工资。' });
    await h.ctx.db.insert(consents).values(['private_interview', 'external_model_processing'].map(purpose => ({ userId: a.user.id, sourceId: story.source.id, purpose: purpose as 'private_interview' | 'external_model_processing', status: 'granted' as const })));
    const enable = await h.app.inject({ method: 'PUT', url: '/api/me/memory/consent', headers: auth(a.token), payload: { enabled: true } });
    expect(enable.statusCode).toBe(200);
    const refresh=await runJob(h.moduleCtx, 'memory.refresh');
    expect(refresh?.data?.llm_calls).toBeGreaterThan(0);
    expect(refresh?.data?.index_writes).toBe(1);
    console.info('memory-live usage',JSON.stringify(refresh?.data));
    const [ready] = await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId, a.user.id));
    expect(ready?.status).toBe('ready');
    expect(ready!.records.length).toBeGreaterThan(0);
    const recalled = await recallMemory(h.moduleCtx, a.user.id, '转行经历');
    expect(recalled.status).toBe('ready');
    expect(recalled.records.some(x => x.evidenceText.includes('八个月'))).toBe(true);
    expect((await recallMemory(h.moduleCtx, b.user.id, '转行经历')).records).toHaveLength(0);
    await h.ctx.db.update(followupCases).set({ status: 'accepted' }).where(eq(followupCases.id, story.followupCase.id));
    const start = await h.app.inject({ method: 'POST', url: `/api/cases/${story.followupCase.id}/interviews`, headers: auth(a.token), payload: { mode: 'ai', confirms_own_content: true, confirms_old_state: true } });
    expect(start.statusCode).toBe(202);
    await runJob(h.moduleCtx, 'ai.interview.next');
    const state = (await h.app.inject({ url: `/api/interviews/${start.json().data.session.id}`, headers: auth(a.token) })).json().data;
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].question).not.toContain('工资');
    expect(state.messages[0].basisRefs.length).toBeGreaterThan(0);
    const revoke = await h.app.inject({ method: 'DELETE', url: `/api/sources/${story.source.id}/consents/external_model_processing`, headers: auth(a.token) });
    expect(revoke.statusCode).toBe(200);
    expect((await recallMemory(h.moduleCtx, a.user.id, '转行经历')).records).toHaveLength(0);
    // Real provider output intentionally stays out of logs/fixtures.
  }, 120000);
});
