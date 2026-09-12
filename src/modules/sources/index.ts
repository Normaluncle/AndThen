import { registerReasonRoutes, registerReasonJobs } from './reasons.js';
import type { ModuleDefinition } from '../../shared/types.js';
import { registerSourcesRoutes } from './routes.js';
import { registerAnalysisRoutes, registerAnalysisJobs } from './analysis.js';

/**
 * Sources module (PRD §7, FR-01..FR-06, FR-10, FR-12 partial).
 *
 * Owns source import + snapshots, per-purpose consents, manual author
 * verification, the public story projection, reader interest and the caller's
 * following list, plus snapshot-bound analysis through the independent model API.
 */
export const sourcesModule: ModuleDefinition = {
  name: 'sources',
  registerRoutes: async (app, ctx) => { await registerSourcesRoutes(app, ctx); await registerAnalysisRoutes(app, ctx); await registerReasonRoutes(app, ctx); },
  registerJobHandlers: (ctx,registry)=>{registerAnalysisJobs(ctx,registry);registerReasonJobs(ctx,registry);},
};
