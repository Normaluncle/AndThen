import { fileURLToPath } from 'node:url';
import { getEnv } from '../config/env.js';
import { createDatabase, createPool } from '../db/client.js';
import { getLatestWorkerHeartbeat, getWorkerHeartbeat } from '../jobs/heartbeat.js';

/**
 * Worker container healthcheck.
 *
 * Reads `worker_heartbeats` and exits non-zero when the worker has stopped
 * reporting. Reporting "up" from inside the process would prove nothing — the
 * loop could be wedged while the process still answers. Reading the last
 * heartbeat proves the worker loop actually ticked.
 *
 * With WORKER_ID set, that exact worker must be fresh. Otherwise the most
 * recently seen worker heartbeat must be fresh.
 */
export const WORKER_HEALTH_KIND = 'worker';

export interface WorkerHealthResult {
  ok: boolean;
  workerId: string | null;
  ageMs: number | null;
  maxAgeMs: number;
  reason?: string;
}

export async function checkWorkerHealth(
  db: Parameters<typeof getWorkerHeartbeat>[0],
  options: { workerId?: string | null; maxAgeMs: number },
): Promise<WorkerHealthResult> {
  const base = { workerId: options.workerId ?? null, maxAgeMs: options.maxAgeMs };

  const heartbeat = options.workerId
    ? await getWorkerHeartbeat(db, options.workerId)
    : await getLatestWorkerHeartbeat(db, WORKER_HEALTH_KIND);

  if (!heartbeat) {
    return {
      ...base,
      ok: false,
      ageMs: null,
      reason: options.workerId
        ? `no heartbeat recorded for worker "${options.workerId}"`
        : 'no worker heartbeat recorded',
    };
  }

  const ageMs = Date.now() - heartbeat.lastSeenAt.getTime();
  const ok = ageMs <= options.maxAgeMs;
  return {
    ok,
    workerId: heartbeat.workerId,
    ageMs,
    maxAgeMs: options.maxAgeMs,
    ...(ok ? {} : { reason: `heartbeat is ${ageMs}ms old (max ${options.maxAgeMs}ms)` }),
  };
}

async function main(): Promise<void> {
  const env = getEnv();
  const maxAgeMs = env.WORKER_HEALTH_MAX_AGE_SECONDS * 1000;

  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: 1,
    applicationName: 'andthen-worker-health',
  });
  const db = createDatabase(pool);

  try {
    const result = await checkWorkerHealth(db, { workerId: env.WORKER_ID ?? null, maxAgeMs });
    if (result.ok) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    process.stderr.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('[worker-health] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
