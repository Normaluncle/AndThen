import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createHarness, seedPublishedStory, seedUser, type Harness } from './helpers.js';
import { consents, followupCases, interviewMessages, interviewSessions } from '../../src/db/schema.js';
import { runJob } from '../helpers/run-job.js';
import { JobQueue } from '../../src/jobs/queue.js';

describe('AI-B with a simulated HTTP provider (not a real model evaluation)', () => {
  let h: Harness;
  let server: Server;
  let calls = 0;
  let delayReply: (() => void) | undefined;
  let hold = false;
  beforeAll(async () => {
    h = await createHarness();
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      calls++;
      const input = JSON.parse(JSON.parse(raw).messages[1].content);
      const last = input.history.filter((m: { role: string }) => m.role === 'author').at(-1);
      const answer = last?.answer ?? '';
      const question = answer.includes('已完成') ? '完成后有什么变化？' : answer.includes('已停止') ? '停止后有什么变化？' : answer.includes('仍在进行') ? '现在进展如何？' : '后来发生了什么？';
      const send = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: 'test_fixture', choices: [{ message: { content: JSON.stringify({ question, purpose: '测试动态分支', basis_refs: [input.evidence.at(-1).id] }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })); };
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
});
