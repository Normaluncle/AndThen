import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobQueue } from '../../src/jobs/queue.js';
import { JobLeaseLostError, fenceOf } from '../../src/jobs/transaction.js';
import { JobRegistry } from '../../src/jobs/types.js';
import { JobWorker } from '../../src/jobs/worker.js';
import { createLogger } from '../../src/shared/logger.js';
import { createTestContext, truncateAll, type TestContext } from '../helpers/testdb.js';

describe('job queue: lease, fencing and stale-result rejection', () => {
  let ctx: TestContext;
  let queue: JobQueue;

  beforeAll(async () => {
    ctx = await createTestContext('jobs');
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

  /* ---- lease expiry is checked independently of the fencing token ---- */

  it('rejects heartbeat, complete and fail once the lease has expired, before any reclaim', async () => {
    const { job } = await queue.enqueue({ kind: 'test.noop' });
    const claim = await queue.claim({ workerId: 'worker-a', leaseSeconds: 60 });
    expect(claim?.fencingToken).toBe(1);

    await expireLease(job.id);

    // The token still matches and the status is still 'running', but the claim
    // has lapsed — none of these may succeed.
    expect(await queue.heartbeat(job.id, claim!.fencingToken, 60)).toBe(false);
    expect(await queue.complete(job.id, claim!.fencingToken, { late: true })).toBe(false);
    expect(await queue.fail(job.id, claim!.fencingToken, 'late failure')).toBe(false);

    const untouched = await queue.getById(job.id);
    expect(untouched?.status).toBe('running');
    expect(untouched?.result).toBeNull();
    expect(untouched?.lastError).toBeNull();

    // And the job is still recoverable by the reclaim path.
    expect(await queue.reclaimExpired()).toBe(1);
    const retried = await queue.claim({ workerId: 'worker-b', leaseSeconds: 60 });
    expect(retried?.fencingToken).toBe(2);
    expect(await queue.complete(retried!.id, retried!.fencingToken, { ok: true })).toBe(true);
  });

  it('keeps exactly one winner when reclaim and completion race', async () => {
    const { job } = await queue.enqueue({ kind: 'test.noop' });
    const stale = await queue.claim({ workerId: 'worker-a', leaseSeconds: 60 });

    // Race the reclaim against the stale worker's completion.
    const [reclaimed, staleComplete] = await Promise.all([
      queue.reclaimExpired(),
      queue.complete(job.id, stale!.fencingToken, { by: 'a' }),
    ]);

    // Whichever order they landed in, the stale worker must not both win the
    // job and have it reclaimed; and the job must end in exactly one state.
    if (staleComplete) {
      expect(reclaimed).toBe(0);
      expect((await queue.getById(job.id))?.status).toBe('succeeded');
      return;
    }

    expect(reclaimed).toBe(1);
    expect((await queue.getById(job.id))?.status).toBe('queued');

    const next = await queue.claim({ workerId: 'worker-b', leaseSeconds: 60 });
    expect(next?.fencingToken).toBe(2);
    expect(await queue.complete(next!.id, next!.fencingToken, { by: 'b' })).toBe(true);

    const final = await queue.getById(job.id);
    expect(final?.status).toBe('succeeded');
    expect(final?.result).toEqual({ by: 'b' });
  });

  /* ---- fenced business writes ---- */

  async function countEvents(): Promise<number> {
    const rows = await ctx.db.execute(sql`select count(*)::int as n from research_events`);
    return (rows.rows[0] as { n: number }).n;
  }

  it('commits a business write under a valid fence', async () => {
    const { job } = await queue.enqueue({ kind: 'test.write' });
    const claim = await queue.claim({ workerId: 'worker-a', leaseSeconds: 60 });

    await queue.withFence(fenceOf(claim!), async (tx) => {
      await tx.execute(sql`
        insert into research_events (event_type, cohort, properties)
        values ('job.side_effect', 'test', '{}'::jsonb)
      `);
    });

    expect(await countEvents()).toBe(1);
    expect(await queue.complete(job.id, claim!.fencingToken, null)).toBe(true);
  });

  it('rejects and rolls back a late business write once the lease is lost', async () => {
    const { job } = await queue.enqueue({ kind: 'test.write' });
    const stale = await queue.claim({ workerId: 'worker-a', leaseSeconds: 60 });

    await expireLease(job.id);
    await queue.reclaimExpired();
    const current = await queue.claim({ workerId: 'worker-b', leaseSeconds: 60 });
    expect(current?.fencingToken).toBe(2);

    // The stale worker's side effect must not be persisted.
    await expect(
      queue.withFence(fenceOf(stale!), async (tx) => {
        await tx.execute(sql`
          insert into research_events (event_type, cohort, properties)
          values ('stale.side_effect', 'test', '{}'::jsonb)
        `);
      }),
    ).rejects.toBeInstanceOf(JobLeaseLostError);
    expect(await countEvents()).toBe(0);

    // The current owner can still write.
    await queue.withFence(fenceOf(current!), async (tx) => {
      await tx.execute(sql`
        insert into research_events (event_type, cohort, properties)
        values ('current.side_effect', 'test', '{}'::jsonb)
      `);
    });
    expect(await countEvents()).toBe(1);
  });

  it('exposes the same fence to handlers through withFence', async () => {
    const registry = new JobRegistry();
    let observed: string | null = null;
    registry.register('test.fenced', async ({ withFence }) => {
      await withFence(async (tx) => {
        await tx.execute(sql`
          insert into research_events (event_type, cohort, properties)
          values ('handler.side_effect', 'test', '{}'::jsonb)
        `);
      });
      observed = 'written';
      return { data: { ok: true } };
    });

    const worker = new JobWorker({
      queue,
      registry,
      logger: createLogger(ctx.env),
      workerId: 'worker-fenced',
      concurrency: 1,
      leaseSeconds: 30,
      pollIntervalMs: 10,
    });

    await queue.enqueue({ kind: 'test.fenced' });
    expect(await worker.runOnce()).toBe(true);
    expect(observed).toBe('written');
    expect(await countEvents()).toBe(1);
  });

  /* ---- atomic save + enqueue ---- */

  it('only enqueues when the caller transaction commits', async () => {
    await expect(
      ctx.db.transaction(async (tx) => {
        await queue.enqueue({ kind: 'test.atomic', payload: { n: 1 } }, tx);
        throw new Error('caller rolled back');
      }),
    ).rejects.toThrow('caller rolled back');

    expect(await queue.countByStatus()).toEqual({});
  });

  it('enqueues atomically with the caller transaction', async () => {
    const job = await ctx.db.transaction(async (tx) => {
      const result = await queue.enqueue({ kind: 'test.atomic', payload: { n: 2 } }, tx);
      return result.job;
    });

    const stored = await queue.getById(job.id);
    expect(stored?.kind).toBe('test.atomic');
    expect(stored?.payload).toEqual({ n: 2 });
    expect(await queue.countByStatus()).toEqual({ queued: 1 });
  });
});
