import type { ModuleDefinition } from '../../shared/types.js';

/**
 * RESERVED MODULE — no routes or handlers are registered in the foundation
 * commit. This file exists so `src/modules/index.ts` has a stable import slot.
 *
 * Planned ownership (PRD §7, FR-01..FR-03): source registration, snapshot
 * ingestion, material-level enforcement (exact_excerpt vs summary), permission
 * status, and the degrade path when an official search is unavailable.
 *
 * To implement: add `routes.ts` + `service.ts` here, then set
 * `registerRoutes: registerSourcesRoutes` below. Do not edit app.ts.
 */
export const sourcesModule: ModuleDefinition = {
  name: 'sources',
};
