import type { ModuleDefinition } from '../../shared/types.js';
import { registerCasesRoutes } from './routes.js';
import { registerReviewRoutes } from './review.js';

/**
 * Cases module (PRD §9, §10, §13; FR-07..FR-11).
 *
 * Owns case creation/read, the human invitation *record* (never an actual
 * send) and the author's accept/decline/do-not-contact decision. Interview
 * sessions and drafts belong to other modules.
 */
export const casesModule: ModuleDefinition = {
  name: 'cases',
  registerRoutes: async (app, ctx) => { await registerCasesRoutes(app, ctx); await registerReviewRoutes(app, ctx); },
};
