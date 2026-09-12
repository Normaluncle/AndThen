import { randomUUID } from 'node:crypto';
import { logLlmPolicy } from './ai/client.js';
import { getEnv } from './config/env.js';
import { createDatabase, createPool } from './db/client.js';
import { JobRegistry, JobQueue, JobWorker, recordWorkerHeartbeat } from './jobs/index.js';
import { registerModuleJobHandlers, runModuleWorkerStart } from './modules/index.js';
import { createLogger } from './shared/logger.js';
import type { ModuleContext } from './shared/types.js';

/**
 * Worker entrypoint. Same image as the API, different command.
 *
 * Handler registration is module-driven: each module's `registerJobHandlers`
 * runs here. Adding a handler never requires editing this file.
 */
async function main(): Promise<void> {
  const env = getEnv();
  const logger = createLogger(env, { base: { service: 'andthen-worker', env: env.NODE_ENV } });
  logLlmPolicy(env, logger);

  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    applicationName: 'andthen-worker',
  });
  const db = createDatabase(pool);

  const ctx: ModuleContext = {
    db,
    env,
    logger,
    jobs: new JobQueue(db),
    now: () => new Date(),
  };

  const registry = new JobRegistry();
  registerModuleJobHandlers(ctx, registry);

  const workerId = env.WORKER_ID ?? `worker-${randomUUID()}`;
  logger.info({ workerId, kinds: registry.kinds() }, 'registered job handlers');

  // Let modules seed work that must exist independently of any request
  // (e.g. an outbox sweep keyed by dedupeKey).
  await runModuleWorkerStart(ctx);

  const worker = new JobWorker({
    queue: ctx.jobs,
    registry,
    logger,
    workerId,
    concurrency: env.WORKER_CONCURRENCY,
    leaseSeconds: env.JOB_LEASE_SECONDS,
    pollIntervalMs: env.JOB_POLL_INTERVAL_MS,
    onTick: () =>
      recordWorkerHeartbeat(db, {
        workerId,
        kind: 'worker',
        meta: { concurrency: env.WORKER_CONCURRENCY, kinds: registry.kinds() },
      }),
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down worker');
    await worker.stop();
    await pool.end();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await worker.start();
}

main().catch((err: unknown) => {
  console.error('[worker] failed to start:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
