import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import type { Database } from '../db/client.js';
import type { JobQueue } from '../jobs/queue.js';
import type { JobHandlerRegistry } from '../jobs/types.js';
import type { Logger } from './logger.js';

/**
 * The Fastify instance type used across the app. Because the logger is typed as
 * `FastifyBaseLogger`, this is just the library default — including for
 * encapsulated plugin instances created by `app.register(...)`.
 */
export type AppInstance = FastifyInstance;

/** Authenticated caller, resolved entirely from server-side state. */
export interface AuthContext {
  userId: string;
  /** Server-authoritative; never taken from a request body or header. */
  role: 'reader' | 'author' | 'researcher' | 'admin';
  cohort: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Everything a business module needs. Passed to every module registrar so
 * modules never reach for globals or build their own connections.
 */
export interface ModuleContext {
  db: Database;
  env: Env;
  logger: Logger;
  jobs: JobQueue;
  /** Injectable clock; tests override it to exercise lease expiry. */
  now: () => Date;
}

/**
 * The frozen module contract. Every module under src/modules/<name>/index.ts
 * exports exactly this shape (directly or wrapped), and app.ts / worker.ts
 * compose them. Adding a route means adding it inside the module's registrar —
 * not editing app.ts.
 */
export type ModuleRegistrar = (app: AppInstance, ctx: ModuleContext) => Promise<void> | void;

export interface ModuleDefinition {
  name: string;
  /** HTTP routes for this module. Optional: some modules are worker-only. */
  registerRoutes?: ModuleRegistrar;
  /** Job kinds this module handles, registered on the worker. */
  registerJobHandlers?: (ctx: ModuleContext, registry: JobHandlerRegistry) => void;
  /**
   * Called exactly once by the worker, after handlers are registered and before
   * the loop starts. Use it to seed work that must exist regardless of who
   * triggered it — e.g. the followups module enqueueing an outbox sweep with a
   * `dedupeKey` so a restart never leaves undrained side effects behind.
   *
   * Must be idempotent and must not block: the worker has not started polling yet.
   */
  onWorkerStart?: (ctx: ModuleContext) => Promise<void> | void;
}

export interface Pagination {
  limit: number;
  offset: number;
}

/** Standard list payload shape returned by module list endpoints. */
export interface ListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
