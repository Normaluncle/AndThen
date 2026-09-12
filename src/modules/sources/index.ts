import type { ModuleDefinition } from '../../shared/types.js';
import { registerSourcesRoutes } from './routes.js';

/**
 * Sources module (PRD §7, FR-01..FR-06, FR-10, FR-12 partial).
 *
 * Owns source import + snapshots, per-purpose consents, manual author
 * verification, the public story projection, reader interest and the caller's
 * following list. AI analysis is owned by the AI module (POST
 * /sources/:id/analyze) and is deliberately not implemented here.
 */
export const sourcesModule: ModuleDefinition = {
  name: 'sources',
  registerRoutes: registerSourcesRoutes,
};
