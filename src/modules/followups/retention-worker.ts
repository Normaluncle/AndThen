import { and, eq, inArray, sql } from 'drizzle-orm';
import { sources, interviewSessions, followupVersions, aiRuns, jobs, idempotencyKeys, auditLogs } from '../../db/schema.js';
import type { ModuleContext } from '../../shared/types.js';
import type { JobHandlerContext } from '../../jobs/types.js';
import { invalidateAuthorMemory } from '../memory/service.js';
import { withJobFence } from '../../jobs/transaction.js';
import { PRIVATE_RETENTION_MS, publicStatements } from './retention.js';

const textArray = (values: string[]) => sql`ARRAY[${sql.join(values.map(value => sql`${value}`), sql`, `)}]::text[]`;

export async function purgeExpiredPrivateContent(ctx: ModuleContext, job: JobHandlerContext) {
  const cutoff = new Date(ctx.now().getTime() - PRIVATE_RETENTION_MS);
  const candidates = await ctx.db.select({ id: sources.id }).from(sources).where(sql`
    exists (select 1 from interview_sessions i join followup_cases c on c.id=i.case_id where c.source_id=${sources.id} and i.updated_at <= ${cutoff})
    or exists (select 1 from followup_versions v join followup_cases c on c.id=v.case_id where c.source_id=${sources.id} and v.updated_at <= ${cutoff}
      and ((v.status='published' and v.private_purged_at is null) or (v.status<>'published' and v.content_purged_at is null)))
  `).limit(1000);
  let interviews = 0;
  let versions = 0;
  for (const candidate of candidates) {
    await ctx.db.transaction(async tx => {
      const [source] = await tx.select().from(sources).where(eq(sources.id, candidate.id)).for('update');
      if (!source) return;
      await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
        const expiredSessions = await fenced.select().from(interviewSessions).where(and(sql`${interviewSessions.caseId} in (select id from followup_cases where source_id=${source.id})`, sql`${interviewSessions.updatedAt} <= ${cutoff}`)).for('update');
        const expiredVersions = await fenced.select().from(followupVersions).where(and(sql`${followupVersions.caseId} in (select id from followup_cases where source_id=${source.id})`, sql`${followupVersions.updatedAt} <= ${cutoff}`, sql`((${followupVersions.status}='published' and ${followupVersions.privatePurgedAt} is null) or (${followupVersions.status}<>'published' and ${followupVersions.contentPurgedAt} is null))`)).for('update');
        if (!expiredSessions.length && !expiredVersions.length) return;
        const sessionIds = expiredSessions.map(s => s.id);
        const versionIds = expiredVersions.map(v => v.id);
        // Cancel before deleting inputs, and erase result caches and advisory findings.
        // Source-first locking serializes this with every model writeback.
        const affected = sql`(${jobs.payload}->>'session_id' = any(${textArray(sessionIds)}) or ${jobs.payload}->>'draft_id' = any(${textArray(versionIds)}))`;
        const affectedJobs = await fenced.select({ id: jobs.id }).from(jobs).where(affected);
        await fenced.update(jobs).set({ status: 'cancelled', leaseOwner: null, leaseExpiresAt: null, finishedAt: ctx.now() }).where(and(affected, sql`${jobs.status} in ('queued','running')`));
        await fenced.update(jobs).set({ payload: {}, result: null, lastError: null }).where(affected);
        await fenced.delete(aiRuns).where(sql`${aiRuns.interviewSessionId}::text = any(${textArray(sessionIds)}) or ${aiRuns.output}->>'draft_id' = any(${textArray(versionIds)}) or ${aiRuns.jobId}::text = any(${textArray(affectedJobs.map(j => j.id))})`);
        for (const version of expiredVersions) {
          const keepPublic = version.status === 'published';
          await fenced.update(followupVersions).set({
            statements: keepPublic ? publicStatements(version.statements) : [],
            unresolvedItems: [], authorEdits: [], authorConfirmations: [],
            privatePurgedAt: ctx.now(), contentPurgedAt: keepPublic ? null : ctx.now(),
            // Preserve version numbers and historical hash as content-free audit receipts.
            // Do not refresh updatedAt: a background sweep is not an author operation.
          }).where(eq(followupVersions.id, version.id));
        }
        if (sessionIds.length) await fenced.delete(interviewSessions).where(inArray(interviewSessions.id, sessionIds));
        const ownerIds = [...new Set([...expiredSessions.map(s => s.ownerUserId), ...expiredVersions.map(v => v.createdByUserId)].filter((id): id is string => !!id))];
        for(const ownerId of ownerIds.sort())await invalidateAuthorMemory(ctx,fenced,ownerId);
        if (ownerIds.length) await fenced.delete(idempotencyKeys).where(inArray(idempotencyKeys.userId, ownerIds));
        await fenced.insert(auditLogs).values({ action: 'retention.private_purged', subjectType: 'source', subjectId: source.id, properties: { interviews: sessionIds.length, versions: versionIds.length, cutoff: cutoff.toISOString() } });
        interviews += sessionIds.length;
        versions += versionIds.length;
      });
    });
  }
  return { purged_interviews: interviews, purged_versions: versions };
}

