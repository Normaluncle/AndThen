import type { ModuleDefinition } from '../../shared/types.js';
import { registerFollowupRoutes } from './routes.js';
import { registerFollowupJobs } from './worker.js';
import { registerDeletionRoutes, registerDeletionJobs } from './deletion.js';
import { registerValidationRoutes, registerValidationJobs } from './validation.js';
import { registerDraftingRoutes, registerDraftingJobs } from './drafting.js';

/**
 * RESERVED MODULE — no routes or handlers are registered in the foundation
 * commit.
 *
 * Planned ownership (PRD §12, FR-17..FR-20): draft versions, per-item author
 * confirmation bound to a content hash, publish transaction, reader
 * notification fan-out via the outbox, and withdraw. The foundation already
 * provides the side-effect dedup primitive: enqueue outbox rows keyed by
 * `(topic, dedupe_key)` and freeze recipients at publish time.
 *
 * To implement: add `routes.ts` + `service.ts` + job handlers here, then set
 * `registerRoutes` and `registerJobHandlers` below. Do not edit app.ts.
 */
export const followupsModule: ModuleDefinition = {
  name: 'followups',
  registerRoutes: async (app, ctx) => { await registerFollowupRoutes(app, ctx); await registerDeletionRoutes(app, ctx); await registerValidationRoutes(app, ctx); await registerDraftingRoutes(app, ctx); },
  registerJobHandlers: (ctx, registry) => { registerFollowupJobs(ctx, registry); registerDeletionJobs(ctx, registry); registerValidationJobs(ctx, registry); registerDraftingJobs(ctx, registry); },
};
