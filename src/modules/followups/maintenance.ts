import { and, eq, sql } from 'drizzle-orm';
import { consents, sources, notifications, followupCases, aiRuns, jobs } from '../../db/schema.js';
import type { ModuleContext } from '../../shared/types.js';
import type { JobHandlerRegistry } from '../../jobs/types.js';
import { withJobFence } from '../../jobs/transaction.js';

const INTERVAL_MS = 10 * 60 * 1000;

export async function seedMaintenance(ctx: ModuleContext, next = false) {
  const bucket = Math.floor(ctx.now().getTime() / INTERVAL_MS) + (next ? 1 : 0);
  return ctx.jobs.enqueue({ kind: 'maintenance.consents', dedupeKey: `maintenance:consents:${bucket}`, runAt: next ? new Date(bucket * INTERVAL_MS) : ctx.now(), maxAttempts: 5 });
}

export function registerMaintenanceJobs(ctx: ModuleContext, registry: JobHandlerRegistry) {
  registry.register('maintenance.consents', async job => {
    const candidates = await ctx.db.select({ id: sources.id }).from(sources).where(sql`exists (
      select 1 from consents c where c.source_id=${sources.id} and c.status='granted'
      and ((c.expires_at is not null and c.expires_at <= ${ctx.now()})
        or (c.purpose='demo_public_display' and c.expires_at is null and c.granted_at <= ${new Date(ctx.now().getTime() - 90 * 86400000)}))
    )`).limit(1000);
    let expired = 0;
    // Each batch item is short and source-first, matching grant/revoke/delete order.
    for (const candidate of candidates) {
      await ctx.db.transaction(async tx => {
        const [source] = await tx.select().from(sources).where(eq(sources.id, candidate.id)).for('update');
        if (!source) return;
        await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async tx => {
        // The source row guards consent/public mutations. Job side effects are idempotent:
        // expiration only moves past deadlines to expired and never restores permission.
        const updated = await tx.update(consents).set({ status: 'expired' }).where(and(eq(consents.sourceId, source.id), eq(consents.status, 'granted'), sql`(
          (${consents.expiresAt} is not null and ${consents.expiresAt} <= ${ctx.now()}) or
          (${consents.purpose}='demo_public_display' and ${consents.expiresAt} is null and ${consents.grantedAt} <= ${new Date(ctx.now().getTime() - 90 * 86400000)})
        )`)).returning({ id: consents.id, purpose: consents.purpose });
        expired += updated.length;
        if (updated.some(c => c.purpose === 'external_model_processing' || c.purpose === 'private_interview')) {
          await tx.execute(sql`update jobs set status='cancelled', finished_at=now(), lease_owner=null, lease_expires_at=null where kind like 'ai.%' and status in ('queued','running') and payload->>'source_id'=${source.id}`);
          await tx.execute(sql`update interview_sessions set mode='manual', revision=revision+1, stop_reason='consent_expired', updated_at=now() where case_id in (select id from followup_cases where source_id=${source.id}) and status in ('active','paused')`);
          await tx.update(aiRuns).set({ status: 'cancelled', output: null, errorCode: 'consent_expired', finishedAt: ctx.now() }).where(and(eq(aiRuns.sourceId, source.id), sql`${aiRuns.status} in ('queued','running')`));
        }
        const activePublic = await tx.select({ id: consents.id }).from(consents).where(and(eq(consents.sourceId, source.id), eq(consents.purpose, 'demo_public_display'), eq(consents.status, 'granted'), sql`(${consents.expiresAt} is null or ${consents.expiresAt} > ${ctx.now()})`)).limit(1);
        if (!activePublic.length && source.permissionStatus === 'public_approved') {
          await tx.update(sources).set({ permissionStatus: 'revoked', updatedAt: ctx.now() }).where(eq(sources.id, source.id));
          await tx.update(notifications).set({ status: 'withdrawn' }).where(sql`${notifications.caseId} in (select id from followup_cases where source_id=${source.id})`);
        }
        });
      });
    }
    await job.withFence(async tx => {
      // A crash may leave audit metadata running after its durable job became terminal.
      await tx.update(aiRuns).set({ status: 'cancelled', output: null, errorCode: 'job_no_longer_active', finishedAt: ctx.now() }).where(and(eq(aiRuns.status, 'running'), sql`not exists (
        select 1 from jobs j where j.id=${aiRuns.jobId} and j.status='running' and j.lease_expires_at > now()
      )`));
    });
    await seedMaintenance(ctx, true);
    return { data: { expired_consents: expired, checked_sources: candidates.length } };
  });
}
