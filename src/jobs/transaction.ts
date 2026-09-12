import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client.js';

/** Identifies one specific claim of a job (id + the token minted at claim time). */
export interface JobFence {
  jobId: string;
  fencingToken: number;
}

export function fenceOf(job: { id: string; fencingToken: number }): JobFence {
  return { jobId: job.id, fencingToken: job.fencingToken };
}

/**
 * Thrown when a job's lease was lost or reclaimed before the write committed.
 * Callers should let it propagate: the job is owned by someone else now, and
 * the retrying worker will redo the work.
 */
export class JobLeaseLostError extends Error {
  readonly jobId: string;

  constructor(jobId: string, reason: string) {
    super(`Job ${jobId} lease is no longer held (${reason})`);
    this.name = 'JobLeaseLostError';
    this.jobId = jobId;
  }
}

/**
 * Run a business write under a job's fence, in a single transaction.
 *
 * Locks the job row `FOR UPDATE` and verifies atomically that it is still
 * `running`, that the fencing token matches this claim, and that the lease has
 * not expired. `fn` then runs inside the same transaction, so the fence check
 * and the business write commit together — a worker that finished late (after
 * its lease expired and the job was reclaimed) cannot persist its result.
 *
 * All job handlers that write business state MUST use this, either via the
 * `withFence` given to the handler or directly through `JobQueue.withFence`.
 * `complete()` alone is not sufficient: it guards the job row, not the
 * business write that accompanies it.
 */
export async function withJobFence<T>(
  db: Database | Transaction,
  fence: JobFence,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT id
      FROM jobs
      WHERE id = ${fence.jobId}
        AND fencing_token = ${fence.fencingToken}
        AND status = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at > now()
      FOR UPDATE
    `);
    if ((result.rows as unknown[]).length === 0) {
      throw new JobLeaseLostError(fence.jobId, 'fencing token, status or lease is no longer valid');
    }
    return fn(tx);
  });
}
