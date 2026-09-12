import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { workerHeartbeats } from '../db/schema.js';

export interface HeartbeatInput {
  workerId: string;
  kind?: string;
  version?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Upsert a liveness row. Cheap enough to call on every worker loop tick, which
 * lets operators see which workers are alive and what they last reported.
 */
export async function recordWorkerHeartbeat(db: Database, input: HeartbeatInput): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values({
      workerId: input.workerId,
      kind: input.kind ?? 'worker',
      version: input.version ?? null,
      meta: input.meta ?? {},
    })
    .onConflictDoUpdate({
      target: workerHeartbeats.workerId,
      set: {
        lastSeenAt: new Date(),
        kind: input.kind ?? 'worker',
        version: input.version ?? null,
        meta: input.meta ?? {},
      },
    });
}

export async function getWorkerHeartbeat(db: Database, workerId: string) {
  const rows = await db
    .select()
    .from(workerHeartbeats)
    .where(eq(workerHeartbeats.workerId, workerId))
    .limit(1);
  return rows[0];
}

/** Most recently seen heartbeat of a given kind; used by the worker healthcheck. */
export async function getLatestWorkerHeartbeat(db: Database, kind = 'worker') {
  const rows = await db
    .select()
    .from(workerHeartbeats)
    .where(eq(workerHeartbeats.kind, kind))
    .orderBy(desc(workerHeartbeats.lastSeenAt))
    .limit(1);
  return rows[0];
}
