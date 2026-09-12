import type { JobRow } from '../db/schema.js';
import type { Transaction } from '../db/client.js';
import type { Logger } from '../shared/logger.js';

export type JobStatus = JobRow['status'];

/** Context handed to a handler. Handlers must not assume the lease is infinite. */
export interface JobHandlerContext {
  job: JobRow;
  payload: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
  /** Aborted when the lease is lost; long work must observe it. */
  signal: AbortSignal;
  logger: Logger;
  /** Extends the lease. Throws if the lease was lost (fencing mismatch). */
  heartbeat: () => Promise<void>;
  /**
   * Run a business write under this job's fence, in one transaction.
   *
   * REQUIRED for any handler that writes state: it re-checks the fencing token,
   * the `running` status and the lease while holding the job row `FOR UPDATE`,
   * so a late result cannot be persisted after the job was reclaimed. Throws
   * `JobLeaseLostError` when the claim is gone.
   */
  withFence: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
}

export interface JobResult {
  data?: Record<string, unknown>;
}

export type JobHandler = (ctx: JobHandlerContext) => Promise<JobResult | void>;

export interface EnqueueOptions {
  kind: string;
  payload?: Record<string, unknown>;
  /** Absolute time; defaults to now. */
  runAt?: Date;
  /** Higher runs first. Default 0. */
  priority?: number;
  maxAttempts?: number;
  /**
   * Serialization key. While a job with this key is queued or running, a second
   * enqueue with the same key is a no-op and returns the existing job.
   */
  dedupeKey?: string;
}

export interface EnqueueResult {
  job: JobRow;
  deduped: boolean;
}

export interface ClaimOptions {
  workerId: string;
  leaseSeconds: number;
  /** Restrict to these kinds. Empty/undefined = all kinds. */
  kinds?: string[];
}

export interface JobHandlerRegistry {
  register(kind: string, handler: JobHandler): void;
  get(kind: string): JobHandler | undefined;
  kinds(): string[];
}

export class JobRegistry implements JobHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(kind: string, handler: JobHandler): void {
    if (this.handlers.has(kind)) {
      throw new Error(`Job handler already registered for kind "${kind}"`);
    }
    this.handlers.set(kind, handler);
  }

  get(kind: string): JobHandler | undefined {
    return this.handlers.get(kind);
  }

  kinds(): string[] {
    return [...this.handlers.keys()].sort();
  }
}
