import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/testdb.js';
import { JobQueue } from '../../src/jobs/queue.js';

describe('database-wide AI lease admission', () => {
  let ctx: TestContext;
  beforeAll(async () => { ctx = await createTestContext('ai_limits'); });
  afterAll(async () => { await ctx.close(); });
  it('serializes daily admission, permits replay at the cap and leaves ordinary tasks available', async () => {
    const daily = await createTestContext('ai_daily_limits');
    try {
      const queues = [new JobQueue(daily.db, 2, 2), new JobQueue(daily.db, 2, 2)];
      const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => queues[i % 2]!.enqueue({ kind: 'ai.test_fixture', dedupeKey: `daily:${i}` })));
      const passed = results.filter(r => r.status === 'fulfilled');
      expect(passed).toHaveLength(2);
      for (const result of results) if (result.status === 'rejected') expect(result.reason.code).toBe('quota_exhausted');
      const existing = passed[0]!.value.job;
      expect((await queues[0]!.enqueue({ kind: existing.kind, dedupeKey: existing.dedupeKey! })).deduped).toBe(true);
      expect((await queues[0]!.enqueue({ kind: 'notification.test_fixture' })).job.kind).toBe('notification.test_fixture');
    } finally { await daily.close(); }
  });
  it('enforces a shared cap across queue instances without starving ordinary jobs', async () => {
    const queues = [new JobQueue(ctx.db, 1), new JobQueue(ctx.db, 1)];
    for (let i = 0; i < 4; i++) await queues[0]!.enqueue({ kind: 'ai.test_fixture' });
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => queues[i % 2]!.claim({ workerId: `test_fixture_${i}`, leaseSeconds: 60 })));
    const active = claims.filter(c => c !== null);
    expect(active).toHaveLength(1);
    await queues[1]!.enqueue({ kind: 'notification.test_fixture' });
    const ordinary = await queues[1]!.claim({ workerId: 'test_fixture_non_ai', leaseSeconds: 60 });
    expect(ordinary?.kind).toBe('notification.test_fixture');
    await queues[0]!.complete(active[0]!.id, active[0]!.fencingToken);
    expect((await queues[1]!.claim({ workerId: 'test_fixture_next', leaseSeconds: 60 }))?.kind).toBe('ai.test_fixture');
  });
});
