import type { ModuleDefinition } from '../../shared/types.js';
import { registerInterviewRoutes } from './routes.js';
import { registerInterviewJobs } from './worker.js';

/**
 * RESERVED MODULE — no routes or handlers are registered in the foundation
 * commit.
 *
 * Planned ownership (PRD §11, FR-12..FR-16): interview sessions and messages,
 * one-question-at-a-time generation (AI-B), skip/pause/resume, and the manual
 * fallback form. The foundation already provides the serialization primitive:
 * enqueue with `dedupeKey = "interview:<sessionId>:generate"` so a session can
 * never run two generations concurrently.
 *
 * To implement: add `routes.ts` + `service.ts` + a job handler here, then set
 * `registerRoutes` and `registerJobHandlers` below. Do not edit app.ts.
 */
export const interviewsModule: ModuleDefinition = {
  name: 'interviews',
  registerRoutes: registerInterviewRoutes,
  registerJobHandlers: registerInterviewJobs,
};
