import type { ModuleContext, ModuleDefinition } from '../shared/types.js';
import type { JobHandlerRegistry } from '../jobs/types.js';
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
  for (const module of modules) {
    module.registerJobHandlers?.(ctx, registry);
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
