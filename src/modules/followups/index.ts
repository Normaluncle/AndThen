import type { ModuleDefinition } from '../../shared/types.js';
import { registerFollowupRoutes } from './routes.js';
import { registerFollowupJobs } from './worker.js';
import { registerDeletionRoutes, registerDeletionJobs } from './deletion.js';
import { registerValidationRoutes, registerValidationJobs } from './validation.js';
import { registerDraftingRoutes, registerDraftingJobs } from './drafting.js';
import { seedMaintenance, registerMaintenanceJobs } from './maintenance.js';
import { registerReaderDeletionRoutes } from './reader-deletion.js';

/** Draft versions, model drafting/validation, publication, notification and data cleanup. */
export const followupsModule: ModuleDefinition = {
  name: 'followups',
  registerRoutes: async (app, ctx) => { await registerFollowupRoutes(app, ctx); await registerDeletionRoutes(app, ctx); await registerReaderDeletionRoutes(app, ctx); await registerValidationRoutes(app, ctx); await registerDraftingRoutes(app, ctx); },
  registerJobHandlers: (ctx, registry) => { registerFollowupJobs(ctx, registry); registerDeletionJobs(ctx, registry); registerValidationJobs(ctx, registry); registerDraftingJobs(ctx, registry); registerMaintenanceJobs(ctx, registry); },
  onWorkerStart: async ctx => { await seedMaintenance(ctx); },
};
