import type { ModuleDefinition } from '../../shared/types.js';

/**
 * RESERVED MODULE — no routes or handlers are registered in the foundation
 * commit.
 *
 * Planned ownership (PRD §9, §13; FR-07..FR-11): follow-up suitability gating,
 * candidate queues, invitation records, accept/decline/do-not-contact
 * decisions, and the case state machine. `followup_cases.status` already
 * carries the full transition set; execution state lives in `jobs.status`.
 *
 * To implement: add `routes.ts` + `service.ts` here, then set
 * `registerRoutes: registerCasesRoutes` below. Do not edit app.ts.
 */
export const casesModule: ModuleDefinition = {
  name: 'cases',
};
