import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createHarness, seedPublishedStory, seedUser, type Harness } from './helpers.js';
import { consents, interviewSessions, interviewMessages } from '../../src/db/schema.js';

let h: Harness;
let server: Server;
const children: ChildProcess[] = [];
let calls = 0;
let providerUrl = '';
const waitFor = async (predicate: () => Promise<boolean>, message: string) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(message);
};
const stop = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
};
beforeAll(async () => {
  h = await createHarness();
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls++;
    if (calls === 1) return; // Hold the first real model HTTP request until its worker is killed.
    const input = JSON.parse(JSON.parse(raw).messages[1].content);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'test_fixture', choices: [{ message: { content: JSON.stringify({ question: '这件事之后有什么变化？', purpose: '进程恢复测试', basis_refs: [input.evidence.at(-1).id] }) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  providerUrl = `http://127.0.0.1:${address.port}/v1`;
});
afterAll(async () => {
  for (const child of children) await stop(child);
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await h.close();
});
it('recovers the same durable interview job after an actual worker process dies during HTTP generation', async () => {
  const author = await seedUser(h, 'author', 'test_fixture');
  const story = await seedPublishedStory(h, { author: author.user, verifyAuthor: true });
  await h.ctx.db.insert(consents).values(['private_interview', 'external_model_processing'].map(purpose => ({ sourceId: story.source.id, userId: author.user.id, purpose: purpose as 'private_interview' | 'external_model_processing' })));
  const [session] = await h.ctx.db.insert(interviewSessions).values({ caseId: story.followupCase.id, ownerUserId: author.user.id, snapshotId: story.snapshot.id, mode: 'ai', revision: 2, questionsAsked: 1 }).returning();
  await h.ctx.db.insert(interviewMessages).values([
    { sessionId: session!.id, role: 'ai', sequence: 1, question: '后来发生了什么？', generatedBy: 'ai' },
    { sessionId: session!.id, role: 'author', sequence: 2, authorMessage: '进程退出前已保存的回答', clientMessageId: 'persisted-before-crash' },
  ]);
  const { job } = await h.moduleCtx.jobs.enqueue({ kind: 'ai.interview.next', maxAttempts: 1, payload: { source_id: story.source.id, case_id: story.followupCase.id, session_id: session!.id, owner_user_id: author.user.id, revision: 2 } });
  const startWorker = () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: h.ctx.env.DATABASE_URL, LLM_BASE_URL: providerUrl, LLM_MODEL: 'test_fixture', LLM_API_KEY: '', JOB_LEASE_SECONDS: '5', JOB_POLL_INTERVAL_MS: '50', WORKER_CONCURRENCY: '1', WORKER_ID: `crash-fixture-${children.length}` } });
    child.stderr?.resume();
    children.push(child);
    return child;
  };
  const first = startWorker();
  await waitFor(async () => calls === 1, 'First worker did not reach model request');
  const before = await h.moduleCtx.jobs.getById(job.id);
  expect(before!.status).toBe('running');
  await stop(first);
  expect(first.exitCode !== null || first.signalCode !== null).toBe(true);
  const second = startWorker();
  await waitFor(async () => (await h.moduleCtx.jobs.getById(job.id))?.status === 'succeeded', 'Replacement worker failed to reclaim and complete');
  const after = await h.moduleCtx.jobs.getById(job.id);
  expect(after!.fencingToken).toBeGreaterThan(before!.fencingToken);
  expect(after!.attempts).toBe(2);
  expect(calls).toBe(2);
  const messages = await h.ctx.db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, session!.id));
  expect(messages).toHaveLength(3);
  expect(messages.filter(m => m.authorMessage === '进程退出前已保存的回答')).toHaveLength(1);
  expect(messages.filter(m => m.question === '这件事之后有什么变化？')).toHaveLength(1);
  await stop(second);
});
