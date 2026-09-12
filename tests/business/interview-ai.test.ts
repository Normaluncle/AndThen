import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createHarness, seedPublishedStory, seedUser, type Harness } from './helpers.js';
import { consents, followupCases, interviewMessages, interviewSessions } from '../../src/db/schema.js';
import { runJob } from '../helpers/run-job.js';
import { JobQueue } from '../../src/jobs/queue.js';
import { seedMaintenance } from '../../src/modules/followups/maintenance.js';

describe('AI-B with a simulated HTTP provider (not a real model evaluation)', () => {
  let h: Harness;
  let server: Server;
  let calls = 0;
  let delayReply: (() => void) | undefined;
  let hold = false;
  let providerMode: 'normal' | 'sequence' | 'repeat' | '429' | 'bad_json' = 'normal';
  beforeAll(async () => {
    h = await createHarness();
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      calls++;
      if (providerMode === '429') { res.statusCode = 429; res.end('provider-private-error'); return; }
      if (providerMode === 'bad_json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'not json' } }] })); return; }
      const input = JSON.parse(JSON.parse(raw).messages[1].content);
      const last = input.history.filter((m: { role: string }) => m.role === 'author').at(-1);
      const answer = last?.answer ?? '';
      const question = providerMode === 'sequence' ? `请补充第${input.history.filter((m: { role: string }) => m.role === 'ai').length + 1}项后续？` : providerMode === 'repeat' ? input.history.find((m: { role: string }) => m.role === 'ai')?.question ?? '后来发生了什么？' : answer.includes('已完成') ? '完成后有什么变化？' : answer.includes('已停止') ? '停止后有什么变化？' : answer.includes('仍在进行') ? '现在进展如何？' : '后来发生了什么？';
      const send = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: 'test_fixture', choices: [{ message: { content: JSON.stringify({ question: providerMode === 'repeat' ? ` ${question.replace('？', '?')} ` : question, purpose: '测试动态分支', basis_refs: [input.evidence.at(-1).id] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })); };
      if (hold) delayReply = send; else send();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No provider port');
    h.moduleCtx.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    h.moduleCtx.env.LLM_MODEL = 'test_fixture';
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await h.close(); });

  async function start(permitted = true) {
    const author = await seedUser(h, 'author', 'test_fixture');
    const story = await seedPublishedStory(h, { author: author.user, verifyAuthor: true });
    await h.ctx.db.update(followupCases).set({ status: 'accepted', publishedVersionId: null }).where(eq(followupCases.id, story.followupCase.id));
    await h.ctx.db.insert(consents).values([{ userId: author.user.id, sourceId: story.source.id, purpose: 'private_interview' as const }, ...(permitted ? [{ userId: author.user.id, sourceId: story.source.id, purpose: 'external_model_processing' as const }] : [])]);
    const response = await h.app.inject({ method: 'POST', url: `/api/cases/${story.followupCase.id}/interviews`, headers: auth(author.token), payload: { mode: 'ai', confirms_own_content: true, confirms_old_state: true } });
    expect(response.statusCode, response.body).toBe(permitted ? 202 : 200);
    return { author, story, session: response.json().data.session };
  }
  it('counts skipped questions toward five, resumes without duplicating a saved question and makes no sixth request', async () => {
    providerMode = 'sequence';
    try {
      const fixture = await start();
      const base = `/api/interviews/${fixture.session.id}`;
      const before = calls;
      for (let index = 0; index < 5; index++) {
        await runJob(h.moduleCtx, 'ai.interview.next');
        let state = (await h.app.inject({ url: base, headers: auth(fixture.author.token) })).json().data;
        if (index === 1) {
          const paused = await h.app.inject({ method: 'POST', url: `${base}/pause`, headers: auth(fixture.author.token), payload: { expected_version: state.session.revision } });
          const resumed = await h.app.inject({ method: 'POST', url: `${base}/resume`, headers: auth(fixture.author.token), payload: { expected_version: paused.json().data.session.revision } });
          expect(resumed.json().data.job_id).toBeNull();
          state = (await h.app.inject({ url: base, headers: auth(fixture.author.token) })).json().data;
        }
        const answer = await h.app.inject({ method: 'POST', url: `${base}/messages`, headers: auth(fixture.author.token), payload: { ...(index === 0 ? { skip: true } : { message: `已保存回答${index}` }), client_message_id: `budget-${index}`, expected_version: state.session.revision } });
        expect(answer.statusCode, answer.body).toBe(index === 4 ? 200 : 202);
        if (index === 4) expect(answer.json().data.job_id).toBeNull();
      }
      expect(calls - before).toBe(5);
      const state = (await h.app.inject({ url: base, headers: auth(fixture.author.token) })).json().data;
      expect(state.session.questionsAsked).toBe(5);
      expect(state.messages.filter((m: { role: string }) => m.role === 'ai')).toHaveLength(5);
      expect(state.messages.filter((m: { skipped: boolean }) => m.skipped)).toHaveLength(1);
    } finally { providerMode = 'normal'; }
  });
  it.each(['repeat', '429', 'bad_json'] as const)('preserves input and falls back safely for %s', async mode => {
    const fixture = await start();
    await runJob(h.moduleCtx, 'ai.interview.next');
    const base = `/api/interviews/${fixture.session.id}`;
    const state = (await h.app.inject({ url: base, headers: auth(fixture.author.token) })).json().data;
    const answer = await h.app.inject({ method: 'POST', url: `${base}/messages`, headers: auth(fixture.author.token), payload: { ...(mode === 'repeat' ? { skip: true } : { message: '异常前已保存的回答' }), client_message_id: 'before-failure', expected_version: state.session.revision } });
    expect(answer.statusCode, answer.body).toBe(202);
    providerMode = mode;
    try {
      await runJob(h.moduleCtx, 'ai.interview.next');
      const after = await h.app.inject({ url: base, headers: auth(fixture.author.token) });
      expect(after.json().data.session.mode).toBe('manual');
      expect(after.json().data.session.stopReason).toBe(mode === '429' ? 'quota_exhausted' : mode === 'repeat' ? 'conflict' : 'invalid_model_output');
      expect(after.json().data.messages).toHaveLength(2);
      if (mode !== 'repeat') expect(after.body).toContain('异常前已保存的回答');
      expect(after.body).not.toContain('provider-private-error');
      providerMode = 'normal';
      const retryBody = { expected_version: after.json().data.session.revision };
      const stranger = await seedUser(h, 'author');
      expect((await h.app.inject({ method: 'POST', url: `${base}/retry`, headers: auth(stranger.token), payload: retryBody })).statusCode).toBe(403);
      const retried = await h.app.inject({ method: 'POST', url: `${base}/retry`, headers: auth(fixture.author.token), payload: retryBody });
      expect(retried.statusCode, retried.body).toBe(202);
      expect((await h.app.inject({ method: 'POST', url: `${base}/retry`, headers: auth(fixture.author.token), payload: retryBody })).statusCode).toBe(409);
      providerMode = 'sequence';
      await runJob(h.moduleCtx, 'ai.interview.next');
      const recovered = (await h.app.inject({ url: base, headers: auth(fixture.author.token) })).json().data;
      expect(recovered.session.mode).toBe('ai');
      expect(recovered.session.stopReason).toBeNull();
      expect(recovered.messages).toHaveLength(3);
      expect(recovered.messages[1]).toEqual(after.json().data.messages[1]);
    } finally { providerMode = 'normal'; }
  });
  it('rechecks retry consent and rejects exhausted or paused interviews', async () => {
    const fixture = await start(false);
    const url = `/api/interviews/${fixture.session.id}/retry`;
    const request = () => h.app.inject({ method: 'POST', url, headers: auth(fixture.author.token), payload: { expected_version: fixture.session.revision } });
    await h.ctx.db.update(interviewSessions).set({ stopReason: 'model_timeout' }).where(eq(interviewSessions.id, fixture.session.id));
    expect((await request()).statusCode).toBe(422);
    await h.ctx.db.insert(consents).values({ userId: fixture.author.user.id, sourceId: fixture.story.source.id, purpose: 'external_model_processing' });
    await h.ctx.db.update(interviewSessions).set({ questionsAsked: 5 }).where(eq(interviewSessions.id, fixture.session.id));
    expect((await request()).statusCode).toBe(409);
    await h.ctx.db.update(interviewSessions).set({ questionsAsked: 1, status: 'paused' }).where(eq(interviewSessions.id, fixture.session.id));
    expect((await request()).statusCode).toBe(409);
  });
  it('discards the in-flight model reply after explicit interview deletion', async () => {
    const fixture = await start();
    hold = true;
    const running = runJob(h.moduleCtx, 'ai.interview.next').then(() => null, err => err);
    try {
      const deadline = Date.now() + 5000;
      while (!delayReply && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      expect(delayReply).toBeTypeOf('function');
      const removed = await h.app.inject({ method: 'DELETE', url: `/api/interviews/${fixture.session.id}`, headers: auth(fixture.author.token), payload: { confirms_deletion_and_withdrawal: true } });
      expect(removed.statusCode, removed.body).toBe(200);
      delayReply!(); delayReply = undefined;
      expect(await running).toBeInstanceOf(Error);
      expect(await h.ctx.db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, fixture.session.id))).toHaveLength(0);
    } finally { hold = false; delayReply?.(); delayReply = undefined; await running; }
  });
  it('makes zero provider requests without external processing permission', async () => {
    const before = calls;
    expect((await start(false)).session.mode).toBe('manual');
    expect(calls).toBe(before);
  });
  it.each([['已完成', '完成后有什么变化？'], ['已停止', '停止后有什么变化？'], ['仍在进行', '现在进展如何？']])('uses saved %s answer in the next model input', async (answer, expected) => {
    const fixture = await start();
    await runJob(h.moduleCtx, 'ai.interview.next');
    const base = `/api/interviews/${fixture.session.id}`;
    const state = (await h.app.inject({ method: 'GET', url: base, headers: auth(fixture.author.token) })).json().data;
    const saved = await h.app.inject({ method: 'POST', url: `${base}/messages`, headers: auth(fixture.author.token), payload: { message: answer, client_message_id: 'answer1', expected_version: state.session.revision } });
    expect(saved.statusCode, saved.body).toBe(202);
    await runJob(h.moduleCtx, 'ai.interview.next');
    const next = (await h.app.inject({ method: 'GET', url: base, headers: auth(fixture.author.token) })).json().data;
    expect(next.messages.at(-1).question).toBe(expected);
  });
  it('discards a provider reply arriving after permission revocation', async () => {
    const fixture = await start();
    hold = true;
    const running = runJob(h.moduleCtx, 'ai.interview.next').then(() => null, err => err);
    const deadline = Date.now() + 5000;
    while (!delayReply && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    expect(delayReply).toBeTypeOf('function');
    const revoke = await h.app.inject({ method: 'DELETE', url: `/api/sources/${fixture.story.source.id}/consents/external_model_processing`, headers: auth(fixture.author.token) });
    expect(revoke.statusCode, revoke.body).toBe(200);
    delayReply!(); hold = false; delayReply = undefined;
    expect(await running).toBeInstanceOf(Error);
    expect(await h.ctx.db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, fixture.session.id))).toHaveLength(0);
    const [session] = await h.ctx.db.select().from(interviewSessions).where(eq(interviewSessions.id, fixture.session.id));
    expect(session?.mode).toBe('manual');
  });
  it('preserves the submitted answer when daily admission is exhausted', async () => {
    const fixture = await start();
    await runJob(h.moduleCtx, 'ai.interview.next');
    const base = `/api/interviews/${fixture.session.id}`;
    const state = (await h.app.inject({ method: 'GET', url: base, headers: auth(fixture.author.token) })).json().data;
    const originalQueue = h.moduleCtx.jobs;
    h.moduleCtx.jobs = new JobQueue(h.ctx.db, 2, 0);
    try {
      const saved = await h.app.inject({ method: 'POST', url: `${base}/messages`, headers: auth(fixture.author.token), payload: { message: '额度耗尽也不能丢失这条回答', client_message_id: 'budget-answer', expected_version: state.session.revision } });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().data.session.mode).toBe('manual');
      expect(saved.json().data.session.stopReason).toBe('quota_exhausted');
      expect(saved.json().data.message.authorMessage).toBe('额度耗尽也不能丢失这条回答');
    } finally { h.moduleCtx.jobs = originalQueue; }
  });
  it('does not send expired interviews and discards an in-flight reply after retention cleanup', async () => {
    const expired = await start();
    const old = new Date(Date.now() - 31 * 86400000);
    await h.ctx.db.update(interviewSessions).set({ updatedAt: old }).where(eq(interviewSessions.id, expired.session.id));
    const before = calls;
    await expect(runJob(h.moduleCtx, 'ai.interview.next')).rejects.toThrow();
    expect(calls).toBe(before);
    const fixture = await start();
    hold = true;
    const running = runJob(h.moduleCtx, 'ai.interview.next').then(() => null, err => err);
    try {
      const deadline = Date.now() + 5000;
      while (!delayReply && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      expect(delayReply).toBeTypeOf('function');
      await h.ctx.db.update(interviewSessions).set({ updatedAt: old }).where(eq(interviewSessions.id, fixture.session.id));
      await seedMaintenance(h.moduleCtx);
      await runJob(h.moduleCtx, 'maintenance.consents');
      delayReply!(); delayReply = undefined;
      expect(await running).toBeInstanceOf(Error);
      expect(await h.ctx.db.select().from(interviewSessions).where(eq(interviewSessions.id, fixture.session.id))).toHaveLength(0);
      expect(await h.ctx.db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, fixture.session.id))).toHaveLength(0);
    } finally { hold = false; delayReply?.(); delayReply = undefined; await running; }
  });
});
