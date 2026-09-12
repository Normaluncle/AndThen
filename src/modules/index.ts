import type { ModuleContext, ModuleDefinition } from '../shared/types.js';
import type { JobHandlerRegistry } from '../jobs/types.js';
import { and, eq } from 'drizzle-orm';
import { aiRuns } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import { JobLeaseLostError } from '../jobs/transaction.js';
import { identityModule } from './identity/index.js';
import { sourcesModule } from './sources/index.js';
import { casesModule } from './cases/index.js';
import { interviewsModule } from './interviews/index.js';
import { followupsModule } from './followups/index.js';
import { researchModule } from './research/index.js';

/**
 * The module registry. Order matters only for route registration; paths are
 * distinct so there is no conflict. Adding a module = adding it here, never
 * editing app.ts or worker.ts.
 */
export const modules: readonly ModuleDefinition[] = [
  identityModule,
  sourcesModule,
  casesModule,
  interviewsModule,
  followupsModule,
  researchModule,
];

export function registerModuleJobHandlers(ctx: ModuleContext, registry: JobHandlerRegistry): void {
  const audited: JobHandlerRegistry = {
    get: kind => registry.get(kind),
    kinds: () => registry.kinds(),
    register(kind, handler) {
      registry.register(kind, !kind.startsWith('ai.') ? handler : async job => {
        try { return await handler(job); }
        catch (err) {
          // This only closes audit metadata. It never writes model output or business state,
          // so it remains safe after loss of a business-write fence or source deletion.
          const cancelled = job.signal.aborted || err instanceof JobLeaseLostError;
          await ctx.db.update(aiRuns).set({ status: cancelled ? 'cancelled' : 'failed', output: null,
            errorCode: cancelled ? 'context_invalidated' : err instanceof AppError ? err.code : 'task_failed', finishedAt: ctx.now() })
            .where(and(eq(aiRuns.jobId, job.job.id), eq(aiRuns.status, 'running')));
          throw err;
        }
      });
    },
  };
  for (const module of modules) {
    module.registerJobHandlers?.(ctx, audited);
  }
}

/**
 * Run each module's `onWorkerStart` hook once, before the worker loop begins.
 * A failing hook is logged and skipped: one module's startup seed must not stop
 * the worker from draining everyone else's jobs.
 *
 * `moduleList` is injectable so the lifecycle can be tested without adding a
 * fake module to the real registry.
 */
export async function runModuleWorkerStart(
  ctx: ModuleContext,
  moduleList: readonly ModuleDefinition[] = modules,
): Promise<void> {
  for (const module of moduleList) {
    if (!module.onWorkerStart) continue;
    try {
      await module.onWorkerStart(ctx);
    } catch (err: unknown) {
      ctx.logger.error({ err, module: module.name }, 'module onWorkerStart hook failed');
    }
  }
}

export {
  identityModule,
  sourcesModule,
  casesModule,
  interviewsModule,
  followupsModule,
  researchModule,
};
