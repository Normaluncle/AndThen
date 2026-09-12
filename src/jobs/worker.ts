import type { Logger } from '../shared/logger.js';
import type { JobQueue } from './queue.js';
import type { JobHandlerRegistry } from './types.js';
import type { JobRow } from '../db/schema.js';

export interface JobWorkerOptions {
  queue: JobQueue;
  registry: JobHandlerRegistry;
  logger: Logger;
  workerId: string;
  concurrency?: number;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  /** Restrict this worker to specific job kinds. */
  kinds?: string[];
  /** Called on every loop tick; used to refresh worker_heartbeats. */
  onTick?: () => Promise<void>;
}

/**
 * Worker loop.
 *
 * - Claims only when below the concurrency limit.
 * - Renews the lease while a handler runs; losing the lease aborts the handler.
 * - A handler whose lease was lost cannot commit: `complete`/`fail` are fenced
 *   on the token captured at claim time.
 */
export class JobWorker {
  private running = false;
  private readonly active = new Set<Promise<void>>();
  private readonly concurrency: number;
  private readonly leaseSeconds: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly options: JobWorkerOptions) {
    this.concurrency = options.concurrency ?? 4;
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.options.logger.info(
      { workerId: this.options.workerId, concurrency: this.concurrency, kinds: this.options.kinds ?? 'all' },
      'worker started',
    );

    while (this.running) {
      await this.safeTick();
      await this.safeReclaim();

      while (this.running && this.active.size < this.concurrency) {
        const job = await this.safeClaim();
        if (!job) break;
        this.track(job);
      }

      if (this.active.size >= this.concurrency) {
        await Promise.race(this.active);
      } else {
        await this.sleep(this.pollIntervalMs);
      }
    }

    await Promise.allSettled([...this.active]);
    this.options.logger.info({ workerId: this.options.workerId }, 'worker stopped');
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.allSettled([...this.active]);
  }

  /** Claim and fully process a single job. Returns true if a job was handled. */
  async runOnce(): Promise<boolean> {
    await this.safeReclaim();
    const job = await this.safeClaim();
    if (!job) return false;
    await this.process(job);
    return true;
  }

  private track(job: JobRow): void {
    const promise = this.process(job);
    const tracked = promise.finally(() => {
      this.active.delete(tracked);
    });
    this.active.add(tracked);
  }

  private async process(job: JobRow): Promise<void> {
    const { queue, registry, logger } = this.options;
    const handler = registry.get(job.kind);
    if (!handler) {
      logger.error({ jobId: job.id, kind: job.kind }, 'no handler registered for job kind');
      await queue.fail(job.id, job.fencingToken, `No handler registered for kind "${job.kind}"`, {
        retryable: false,
      });
      return;
    }

    const controller = new AbortController();
    const heartbeatMs = Math.max(1000, Math.floor((this.leaseSeconds * 1000) / 3));
    const timer = setInterval(() => {
      void queue
        .heartbeat(job.id, job.fencingToken, this.leaseSeconds)
        .then((ok) => {
          if (!ok) {
            logger.warn({ jobId: job.id }, 'job lease lost; aborting handler');
            controller.abort(new Error('job lease lost'));
          }
        })
        .catch((err: unknown) => logger.warn({ err, jobId: job.id }, 'heartbeat failed'));
    }, heartbeatMs);
    timer.unref?.();

    const leaseLost = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('job lease lost')), {
        once: true,
      });
    });
    // Never let the lease-lost promise surface as an unhandled rejection.
    leaseLost.catch(() => undefined);

    try {
      const result = await Promise.race([
        handler({
          job,
          payload: job.payload,
          attempt: job.attempts,
          maxAttempts: job.maxAttempts,
          signal: controller.signal,
          logger: logger.child({ jobId: job.id, kind: job.kind, attempt: job.attempts }),
          heartbeat: async () => {
            const ok = await queue.heartbeat(job.id, job.fencingToken, this.leaseSeconds);
            if (!ok) throw new Error('job lease lost');
          },
        }),
        leaseLost,
      ]);

      const committed = await queue.complete(job.id, job.fencingToken, result?.data ?? null);
      if (committed) {
        logger.info({ jobId: job.id, kind: job.kind, attempt: job.attempts }, 'job succeeded');
      } else {
        logger.warn(
          { jobId: job.id, kind: job.kind, fencingToken: job.fencingToken },
          'stale job result rejected (lease was reclaimed)',
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const committed = await queue.fail(job.id, job.fencingToken, message, {
        retryable: true,
        maxAttempts: job.maxAttempts,
      });
      if (committed) {
        logger.warn({ jobId: job.id, kind: job.kind, err: message }, 'job failed');
      } else {
        logger.warn(
          { jobId: job.id, kind: job.kind, err: message },
          'stale job failure ignored (lease was reclaimed)',
        );
      }
    } finally {
      clearInterval(timer);
    }
  }

  private async safeClaim(): Promise<JobRow | null> {
    try {
      return await this.options.queue.claim({
        workerId: this.options.workerId,
        leaseSeconds: this.leaseSeconds,
        ...(this.options.kinds ? { kinds: this.options.kinds } : {}),
      });
    } catch (err: unknown) {
      this.options.logger.error({ err }, 'job claim failed');
      await this.sleep(this.pollIntervalMs);
      return null;
    }
  }

  private async safeReclaim(): Promise<void> {
    try {
      const reclaimed = await this.options.queue.reclaimExpired();
      if (reclaimed > 0) this.options.logger.warn({ reclaimed }, 'reclaimed expired job leases');
    } catch (err: unknown) {
      this.options.logger.error({ err }, 'lease reclaim failed');
    }
  }

  private async safeTick(): Promise<void> {
    if (!this.options.onTick) return;
    try {
      await this.options.onTick();
    } catch (err: unknown) {
      this.options.logger.warn({ err }, 'worker heartbeat write failed');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref?.();
    });
  }
}
