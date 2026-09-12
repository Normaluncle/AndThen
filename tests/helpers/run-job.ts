import type { ModuleContext } from '../../src/shared/types.js';
import { JobRegistry } from '../../src/jobs/types.js';
import { registerModuleJobHandlers } from '../../src/modules/index.js';

/** Executes a real claimed database job once; same fence contract as JobWorker. */
export async function runJob(ctx: ModuleContext, kind: string) {
  const registry = new JobRegistry();
  registerModuleJobHandlers(ctx, registry);
  const job = await ctx.jobs.claim({ workerId: 'test_fixture', leaseSeconds: 60, kinds: [kind] });
  if (!job) throw new Error(`No due ${kind} job`);
  const handler = registry.get(kind)!;
  const result = await handler({ job, payload: job.payload, attempt: job.attempts, maxAttempts: job.maxAttempts, signal: new AbortController().signal, logger: ctx.logger,
    heartbeat: async () => { await ctx.jobs.heartbeat(job.id, job.fencingToken, 60); },
    withFence: fn => ctx.jobs.withFence({ jobId: job.id, fencingToken: job.fencingToken }, fn),
  });
  await ctx.jobs.complete(job.id, job.fencingToken, result?.data ?? null);
  return result;
}
