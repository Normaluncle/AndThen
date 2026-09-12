import type { ModuleDefinition } from '../../shared/types.js';
import { registerResearchRoutes } from './routes.js';

/**
 * RESERVED MODULE — no routes or handlers are registered in the foundation
 * commit.
 *
 * Planned ownership (PRD §20, §21; FR-05): research events, cohort exclusion,
 * de-identified export, and the admin surface. `research_events` and
 * `audit_logs` tables already exist; cohort is server-maintained and can never
 * be set by a client.
 *
 * To implement: add `routes.ts` + `service.ts` here, then set
 * `registerRoutes: registerResearchRoutes` below. Do not edit app.ts.
 */
export const researchModule: ModuleDefinition = {
  name: 'research',
  registerRoutes: registerResearchRoutes,
};
