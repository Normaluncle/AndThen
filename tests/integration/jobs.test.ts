import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobQueue } from '../../src/jobs/queue.js';
import { JobRegistry } from '../../src/jobs/types.js';
import { JobWorker } from '../../src/jobs/worker.js';
import { createLogger } from '../../src/shared/logger.js';
import { createTestContext, truncateAll, type TestContext } from '../helpers/testdb.js';

describe('job queue: lease, fencing and stale-result rejection', () => {
  let ctx: TestContext;
  let queue: JobQueue;

  beforeAll(async () => {
    ctx = await createTestContext();
    queue = new JobQueue(ctx.db);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.db);
  });

  async function expireLease(jobId: string): Promise<void> {
    await ctx.db.execute(
      sql`update jobs set lease_expires_at = now() - interval '5 seconds' where id = ${jobId}`,
    );
  }

  it('claims at most one job per worker and reports independent job status', async () => {
    const { job } = await queue.enqueue({ kind: 'test.noop', payload: { n: 1 }, maxAttempts: 3 });
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(job.fencingToken).toBe(0);

    const claimed = await queue.claim({ workerId: 'worker-a', leaseSeconds: 60 });
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.leaseOwner).toBe('worker-a');
    expect(claimed?.fencingToken).toBe(1);
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.startedAt).toBeInstanceOf(Date);

    // A live lease is not claimable by anyone else.
    expect(await queue.claim({ workerId: 'worker-b', leaseSeconds: 60 })).toBeNull();
    expect(await queue.claim({ workerId: 'worker-c', leaseSeconds: 60 })).toBeNull();

    expect(await queue.countByStatus()).toEqual({ running: 1 });
  });

  it('reclaims an expired lease and rejects the previous owner\u2019s late result', async () => {
    const { job } = await queue.enqueue({ kind: 'test.noop', maxAttempts: 5 });

    const workerA = await queue.claim({ workerId: 'worker-a', leaseSeconds: 60 });
    expect(workerA?.fencingToken).toBe(1);

    // Worker A stalls; its lease expires and the job is reclaimed.
    await expireLease(job.id);
    expect(await queue.reclaimExpired()).toBe(1);
    expect((await queue.getById(job.id))?.status).toBe('queued');
    expect((await queue.getById(job.id))?.leaseOwner).toBeNull();

    const workerB = await queue.claim({ workerId: 'worker-b', leaseSeconds: 60 });
    expect(workerB?.id).toBe(job.id);
    expect(workerB?.fencingToken).toBe(2);
    expect(workerB?.attempts).toBe(2);

    // Worker A wakes up and tries to commit with its stale fencing token.
    expect(await queue.complete(job.id, workerA!.fencingToken, { by: 'a' })).toBe(false);
    expect(await queue.fail(job.id, workerA!.fencingToken, 'stale failure')).toBe(false);
    const stillRunning = await queue.getById(job.id);
    expect(stillRunning?.status).toBe('running');
    expect(stillRunning?.leaseOwner).toBe('worker-b');

    // Worker B holds the current token and commits successfully.
    expect(await queue.complete(job.id, workerB!.fencingToken, { by: 'b' })).toBe(true);
    const done = await queue.getById(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({ by: 'b' });
    expect(done?.finishedAt).toBeInstanceOf(Date);
    expect(done?.leaseOwner).toBeNull();
  });

  it('rejects a heartbeat from a worker whose lease was reclaimed', async () => {
    const { job } = await queue.enqueue({ kind: 'test.noop' });
    const a = await queue.claim({ workerId: 'worker-a', leaseSeconds: 60 });
    await expireLease(job.id);
    await queue.reclaimExpired();
    const b = await queue.claim({ workerId: 'worker-b', leaseSeconds: 60 });

    expect(await queue.heartbeat(job.id, a!.fencingToken, 60)).toBe(false);
    expect(await queue.heartbeat(job.id, b!.fencingToken, 60)).toBe(true);
  });

  it('serializes identical work with a dedupe key', async () => {
    const key = 'interview:session-1:generate';
    const first = await queue.enqueue({ kind: 'ai.interview.next', dedupeKey: key });
    const second = await queue.enqueue({ kind: 'ai.interview.next', dedupeKey: key });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(await queue.countByStatus()).toEqual({ queued: 1 });

    // Once the first finishes, a new generation may be enqueued.
    const claimed = await queue.claim({ workerId: 'w', leaseSeconds: 60 });
    await queue.complete(claimed!.id, claimed!.fencingToken, null);
    const third = await queue.enqueue({ kind: 'ai.interview.next', dedupeKey: key });
    expect(third.deduped).toBe(false);
    expect(third.job.id).not.toBe(first.job.id);
  });

  it('retries a retryable failure with backoff and dead-letters when attempts run out', async () => {
    const { job: retryable } = await queue.enqueue({ kind: 'test.boom', maxAttempts: 3 });
    const claim = await queue.claim({ workerId: 'w', leaseSeconds: 60 });
    expect(await queue.fail(claim!.id, claim!.fencingToken, 'transient', { retryable: true, maxAttempts: 3 })).toBe(true);
    const requeued = await queue.getById(retryable.id);
    expect(requeued?.status).toBe('queued');
    expect(requeued?.attempts).toBe(1);
    expect(requeued?.lastError).toBe('transient');

    const { job: fatal } = await queue.enqueue({ kind: 'test.boom', maxAttempts: 1 });
    const claim2 = await queue.claim({ workerId: 'w', leaseSeconds: 60 });
    expect(await queue.fail(claim2!.id, claim2!.fencingToken, 'fatal', { retryable: true, maxAttempts: 1 })).toBe(true);
    const dead = await queue.getById(fatal.id);
    expect(dead?.status).toBe('failed');
    expect(dead?.lastError).toBe('fatal');
  });

  it('runs registered handlers through the worker and records success', async () => {
    const registry = new JobRegistry();
    let executions = 0;
    registry.register('test.ok', async ({ payload }) => {
      executions += 1;
      return { data: { echoed: payload.n } };
    });

    const worker = new JobWorker({
      queue,
      registry,
      logger: createLogger(ctx.env),
      workerId: 'worker-1',
      concurrency: 1,
      leaseSeconds: 30,
      pollIntervalMs: 10,
    });

    const { job } = await queue.enqueue({ kind: 'test.ok', payload: { n: 42 } });
    expect(await worker.runOnce()).toBe(true);
    expect(executions).toBe(1);

    const done = await queue.getById(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({ echoed: 42 });

    // Nothing left to run.
    expect(await worker.runOnce()).toBe(false);
  });

  it('marks an unhandled job kind as failed instead of looping forever', async () => {
    const registry = new JobRegistry();
    const worker = new JobWorker({
      queue,
      registry,
      logger: createLogger(ctx.env),
      workerId: 'worker-2',
      concurrency: 1,
      leaseSeconds: 30,
      pollIntervalMs: 10,
    });

    const { job } = await queue.enqueue({ kind: 'test.unregistered' });
    expect(await worker.runOnce()).toBe(true);
    const done = await queue.getById(job.id);
    expect(done?.status).toBe('failed');
    expect(done?.lastError).toContain('No handler registered');
  });

  it('deduplicates outbox side effects by (topic, dedupe_key)', async () => {
    await ctx.db.execute(sql`
      insert into outbox (topic, dedupe_key, recipients)
      values ('followup.published', 'version-1', '[]'::jsonb)
    `);
    await expect(
      ctx.db.execute(sql`
        insert into outbox (topic, dedupe_key, recipients)
        values ('followup.published', 'version-1', '[]'::jsonb)
      `),
    ).rejects.toThrow();
  });
});
