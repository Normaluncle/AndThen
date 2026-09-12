import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Executor, Transaction } from '../db/client.js';
import { jobs } from '../db/schema.js';
import type { JobRow } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import { withJobFence, type JobFence } from './transaction.js';
import type { ClaimOptions, EnqueueOptions, EnqueueResult } from './types.js';

const ACTIVE_STATUSES = ['queued', 'running'] as const;

/** Every mutation of a running job is guarded by this predicate. */
const LEASE_HELD = sql`lease_expires_at IS NOT NULL AND lease_expires_at > now()`;

/**
 * Durable job queue.
 *
 * Guarantees implemented here (and asserted in tests):
 *  - claim happens in a single short statement using FOR UPDATE SKIP LOCKED,
 *    so N workers never take the same job;
 *  - every claim increments `fencing_token`; a worker whose lease expired and
 *    was reclaimed cannot commit results (fencing mismatch -> 0 rows);
 *  - `dedupe_key` has a partial unique index over active jobs, so the same
 *    interview generation cannot be enqueued twice concurrently.
 */
export class JobQueue {
  constructor(private readonly db: Database, private readonly maxConcurrentAiJobs = 2, private readonly dailyAiJobLimit = 1000) {}

  /**
   * Enqueue a job.
   *
   * Pass `executor` (an open transaction) to make "save the input and queue the
   * work" atomic — if the transaction rolls back, the job never exists. Without
   * it the insert uses the pool.
   */
  async enqueue(options: EnqueueOptions, executor?: Executor): Promise<EnqueueResult> {
    const db = executor ?? this.db;
    if (!options.kind.startsWith('ai.')) return this.insert(options, db);
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('andthen-ai-daily-admission'))`);
      if (options.dedupeKey) {
        const [existing] = await tx.select().from(jobs).where(and(eq(jobs.dedupeKey, options.dedupeKey), inArray(jobs.status, [...ACTIVE_STATUSES]))).limit(1);
        if (existing) return { job: existing, deduped: true };
      }
      const counts = await tx.execute(sql`select count(*)::int as total from jobs where kind like 'ai.%' and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')`);
      const total = Number((counts.rows[0] as { total: number }).total);
      if (total >= this.dailyAiJobLimit) throw new AppError({ code: 'quota_exhausted', message: 'Daily AI job admission budget exhausted' });
      return this.insert(options, tx);
    });
  }

  private async insert(options: EnqueueOptions, executor?: Executor): Promise<EnqueueResult> {
    const db = executor ?? this.db;

    const inserted = await db
      .insert(jobs)
      .values({
        kind: options.kind,
        payload: options.payload ?? {},
        runAt: options.runAt ?? new Date(),
        priority: options.priority ?? 0,
        maxAttempts: options.maxAttempts ?? 5,
        dedupeKey: options.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning();

    const created = inserted[0];
    if (created) return { job: created, deduped: false };

    if (!options.dedupeKey) {
      throw AppError.internal('Job insert conflicted without a dedupe key');
    }
    const existing = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, options.dedupeKey), inArray(jobs.status, [...ACTIVE_STATUSES])))
      .limit(1);
    const job = existing[0];
    if (!job) throw AppError.internal('Deduplicated job could not be found');
    return { job, deduped: true };
  }

  /**
   * Run a business write under this job's fence, in one transaction.
   * See `withJobFence` — required for every handler that writes state.
   */
  async withFence<T>(fence: JobFence, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withJobFence(this.db, fence, fn);
  }

  /**
   * Claim one due job. Short transaction; the handler runs outside of it.
   */
  async claim(options: ClaimOptions): Promise<JobRow | null> {
    const kinds = options.kinds ?? [];
    // Build the kind filter as a fragment: a bare JS array interpolated into a
    // drizzle `sql` template becomes a value list, not a single array parameter.
    const kindFilter =
      kinds.length > 0 ? sql`AND kind = ANY(${sql.param(kinds)}::text[])` : sql``;

    const result = await this.db.transaction(async tx => {
      // Separate lock statement ensures the following READ COMMITTED snapshot
      // sees the previous claimant's committed lease across processes.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('andthen-ai-claim'))`);
      return tx.execute(sql`
      WITH candidate AS (
        SELECT id
        FROM jobs
        WHERE status = 'queued'
          AND run_at <= now()
          AND (kind NOT LIKE 'ai.%' OR (
            SELECT count(*) FROM jobs running_jobs
            WHERE running_jobs.kind LIKE 'ai.%' AND running_jobs.status='running'
              AND running_jobs.lease_expires_at > now()
          ) < ${this.maxConcurrentAiJobs})
          ${kindFilter}
        ORDER BY priority DESC, run_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs
      SET status = 'running',
          lease_owner = ${options.workerId},
          lease_expires_at = now() + make_interval(secs => ${options.leaseSeconds}),
          attempts = jobs.attempts + 1,
          fencing_token = jobs.fencing_token + 1,
          started_at = COALESCE(jobs.started_at, now()),
          updated_at = now()
      FROM candidate
      WHERE jobs.id = candidate.id
      RETURNING jobs.id
    `);
    });

    const rows = result.rows as Array<{ id: string }>;
    const claimed = rows[0];
    if (!claimed) return null;
    const job = await this.getById(claimed.id);
    if (!job) throw AppError.internal('Claimed job disappeared');
    return job;
  }

  /**
   * Extend the lease. Returns false when the lease was already lost — either the
   * fencing token moved on, the job is no longer running, or the lease expired.
   */
  async heartbeat(jobId: string, fencingToken: number, leaseSeconds: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE jobs
      SET lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
          updated_at = now()
      WHERE id = ${jobId}
        AND fencing_token = ${fencingToken}
        AND status = 'running'
        AND ${LEASE_HELD}
      RETURNING id
    `);
    return (result.rows as unknown[]).length > 0;
  }

  /**
   * Mark succeeded. Returns false (result rejected) when the claim is no longer
   * valid: the fencing token moved on, the job is not running, or the lease has
   * expired. An expired lease is rejected even before anyone reclaims it, so a
   * worker that overran its lease cannot commit.
   */
  async complete(
    jobId: string,
    fencingToken: number,
    result: Record<string, unknown> | null = null,
  ): Promise<boolean> {
    const updated = await this.db.execute(sql`
      UPDATE jobs
      SET status = 'succeeded',
          result = ${JSON.stringify(result)}::jsonb,
          lease_owner = NULL,
          lease_expires_at = NULL,
          finished_at = now(),
          updated_at = now()
      WHERE id = ${jobId}
        AND fencing_token = ${fencingToken}
        AND status = 'running'
        AND ${LEASE_HELD}
      RETURNING id
    `);
    return (updated.rows as unknown[]).length > 0;
  }

  /**
   * Mark failed. Retryable failures return the job to `queued` with backoff,
   * unless attempts are exhausted, in which case it becomes `failed`.
   * Returns false when the claim is no longer valid (see `complete`).
   */
  async fail(
    jobId: string,
    fencingToken: number,
    error: string,
    options: { retryable?: boolean; maxAttempts?: number } = {},
  ): Promise<boolean> {
    const retryable = options.retryable ?? true;
    const maxAttempts = options.maxAttempts ?? 5;
    const updated = await this.db.execute(sql`
      UPDATE jobs
      SET status = CASE
            WHEN ${retryable} AND jobs.attempts < ${maxAttempts} THEN 'queued'::execution_status
            ELSE 'failed'::execution_status
          END,
          run_at = CASE
            WHEN ${retryable} AND jobs.attempts < ${maxAttempts}
              THEN now() + make_interval(secs => LEAST(300, power(2, jobs.attempts)::int))
            ELSE jobs.run_at
          END,
          last_error = ${error},
          lease_owner = NULL,
          lease_expires_at = NULL,
          finished_at = CASE
            WHEN ${retryable} AND jobs.attempts < ${maxAttempts} THEN NULL
            ELSE now()
          END,
          updated_at = now()
      WHERE id = ${jobId}
        AND fencing_token = ${fencingToken}
        AND status = 'running'
        AND ${LEASE_HELD}
      RETURNING id
    `);
    return (updated.rows as unknown[]).length > 0;
  }

  /**
   * Return jobs whose lease expired to the queue. The next claim bumps the
   * fencing token, so the previous owner's late result is rejected.
   */
  async reclaimExpired(): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE jobs
      SET status = 'queued',
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = now()
      WHERE status = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < now()
      RETURNING id
    `);
    return (result.rows as unknown[]).length;
  }

  async getById(id: string): Promise<JobRow | undefined> {
    const rows = await this.db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return rows[0];
  }

  async cancel(id: string): Promise<boolean> {
    const rows = await this.db
      .update(jobs)
      .set({ status: 'cancelled', updatedAt: new Date(), finishedAt: new Date() })
      .where(and(eq(jobs.id, id), inArray(jobs.status, [...ACTIVE_STATUSES])))
      .returning({ id: jobs.id });
    return rows.length > 0;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: jobs.status, count: sql<number>`count(*)::int` })
      .from(jobs)
      .groupBy(jobs.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  }
}
