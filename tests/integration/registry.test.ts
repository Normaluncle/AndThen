import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobQueue } from '../../src/jobs/queue.js';
import { runModuleWorkerStart } from '../../src/modules/index.js';
import { createLogger } from '../../src/shared/logger.js';
import type { ModuleContext, ModuleDefinition } from '../../src/shared/types.js';
import { createTestContext, truncateAll, type TestContext } from '../helpers/testdb.js';

describe('module worker lifecycle (onWorkerStart)', () => {
  let ctx: TestContext;
  let moduleCtx: ModuleContext;

  beforeAll(async () => {
    ctx = await createTestContext('registry');
    moduleCtx = {
      db: ctx.db,
      env: ctx.env,
      logger: createLogger(ctx.env),
      jobs: new JobQueue(ctx.db),
      now: () => new Date(),
    };
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.db);
  });

  it('runs every module hook once, in registry order', async () => {
    const order: string[] = [];
    const list: ModuleDefinition[] = [
      {
        name: 'alpha',
        onWorkerStart: async () => {
          order.push('alpha');
        },
      },
      { name: 'beta' },
      {
        name: 'gamma',
        onWorkerStart: () => {
          order.push('gamma');
        },
      },
    ];

    await runModuleWorkerStart(moduleCtx, list);
    expect(order).toEqual(['alpha', 'gamma']);
  });

  it('lets a module seed durable work at startup', async () => {
    const list: ModuleDefinition[] = [
      {
        name: 'followups',
        onWorkerStart: async (c) => {
          await c.jobs.enqueue({
            kind: 'outbox.dispatch',
            dedupeKey: 'outbox:dispatch',
            payload: { seeded: true },
          });
        },
      },
    ];

    await runModuleWorkerStart(moduleCtx, list);
    await runModuleWorkerStart(moduleCtx, list);

    // Idempotent across restarts: the dedupe key keeps exactly one pending sweep.
    const counts = await moduleCtx.jobs.countByStatus();
    expect(counts).toEqual({ queued: 1 });

    const claimed = await moduleCtx.jobs.claim({ workerId: 'w', leaseSeconds: 60 });
    expect(claimed?.kind).toBe('outbox.dispatch');
    expect(claimed?.payload).toEqual({ seeded: true });
  });

  it('isolates a failing hook so other modules still start', async () => {
    const started: string[] = [];
    const list: ModuleDefinition[] = [
      {
        name: 'broken',
        onWorkerStart: () => {
          throw new Error('boom');
        },
      },
      {
        name: 'healthy',
        onWorkerStart: () => {
          started.push('healthy');
        },
      },
    ];

    await expect(runModuleWorkerStart(moduleCtx, list)).resolves.toBeUndefined();
    expect(started).toEqual(['healthy']);
  });
});
