import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { checkWorkerHealth } from '../../src/health/worker-check.js';
import { recordWorkerHeartbeat } from '../../src/jobs/heartbeat.js';
import { createLogger } from '../../src/shared/logger.js';
import type { AppInstance } from '../../src/shared/types.js';
import { createTestContext, truncateAll, type TestContext } from '../helpers/testdb.js';

describe('health endpoints and worker heartbeat check', () => {
  let ctx: TestContext;
  let app: AppInstance;

  beforeAll(async () => {
    ctx = await createTestContext('health');
    const built = await buildApp({
      env: ctx.env,
      db: ctx.db,
      logger: createLogger(ctx.env),
      enableDocs: false,
    });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await ctx.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.db);
  });

  it('serves the canonical liveness and readiness paths', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ status: 'ok', data: { status: 'ok' } });
    expect(live.json().data.time).toEqual(expect.any(String));

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: 'ok',
      data: { status: 'ready', database: 'ok' },
    });
  });

  it('keeps the short aliases working and identical', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    const liveAlias = await app.inject({ method: 'GET', url: '/healthz' });
    expect(liveAlias.statusCode).toBe(200);
    expect(liveAlias.json().data.status).toBe(live.json().data.status);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    const readyAlias = await app.inject({ method: 'GET', url: '/readyz' });
    expect(readyAlias.statusCode).toBe(200);
    expect(readyAlias.json().data).toEqual(ready.json().data);
  });

  it('fails the readiness probe when the database is unreachable', async () => {
    // Force the probe's query to fail without touching the shared pool.
    const failingDb = {
      execute: () => Promise.reject(new Error('connection refused')),
    } as unknown as typeof ctx.db;
    const failing = await buildApp({
      env: ctx.env,
      db: failingDb,
      logger: createLogger(ctx.env),
      enableDocs: false,
    });
    await failing.app.ready();
    const res = await failing.app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error_code).toBe('service_unavailable');

    // Liveness must stay green: the process itself is fine.
    const live = await failing.app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);

    await failing.app.close();
  });

  it('reports unhealthy when a worker has never written a heartbeat', async () => {
    const result = await checkWorkerHealth(ctx.db, { workerId: 'worker-absent', maxAgeMs: 60_000 });
    expect(result.ok).toBe(false);
    expect(result.ageMs).toBeNull();
    expect(result.reason).toContain('worker-absent');
  });

  it('reports healthy for a fresh heartbeat and unhealthy once it goes stale', async () => {
    const workerId = 'worker-fresh';
    await recordWorkerHeartbeat(ctx.db, { workerId, kind: 'worker', meta: { concurrency: 1 } });

    const fresh = await checkWorkerHealth(ctx.db, { workerId, maxAgeMs: 60_000 });
    expect(fresh.ok).toBe(true);
    expect(fresh.workerId).toBe(workerId);
    expect(fresh.ageMs).toBeGreaterThanOrEqual(0);

    // Backdate the heartbeat: the check must fail on age, not merely on presence.
    await ctx.db.execute(
      sql`update worker_heartbeats set last_seen_at = now() - interval '10 minutes' where worker_id = ${workerId}`,
    );
    const stale = await checkWorkerHealth(ctx.db, { workerId, maxAgeMs: 60_000 });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toContain('old');
  });

  it('checks the most recent worker when no id is given, and the named one when it is', async () => {
    await recordWorkerHeartbeat(ctx.db, { workerId: 'worker-a', kind: 'worker' });
    await recordWorkerHeartbeat(ctx.db, { workerId: 'worker-b', kind: 'worker' });
    await ctx.db.execute(
      sql`update worker_heartbeats set last_seen_at = now() - interval '10 minutes' where worker_id = 'worker-a'`,
    );

    const latest = await checkWorkerHealth(ctx.db, { workerId: null, maxAgeMs: 60_000 });
    expect(latest.ok).toBe(true);
    expect(latest.workerId).toBe('worker-b');

    const named = await checkWorkerHealth(ctx.db, { workerId: 'worker-a', maxAgeMs: 60_000 });
    expect(named.ok).toBe(false);
  });
});
