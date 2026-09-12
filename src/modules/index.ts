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

export {
  identityModule,
  sourcesModule,
  casesModule,
  interviewsModule,
  followupsModule,
  researchModule,
};
