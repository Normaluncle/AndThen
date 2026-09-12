import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext, ModuleRegistrar } from '../../shared/types.js';
import type { JobHandlerRegistry } from '../../jobs/types.js';
import { sources, consents, followupCases, followupVersions, notifications, outbox, jobs, aiRuns, deletionJobs, auditLogs, researchEvents, idempotencyKeys } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { AppError, success } from '../../http/errors.js';
import { resolveSourceAccess } from '../sources/access.js';
import { withJobFence } from '../../jobs/transaction.js';
import { invalidateAuthorMemory } from '../memory/service.js';
import { authorVerifications } from '../../db/schema.js';

export const registerDeletionRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const schema = { tags: ['deletion'], security: [{ bearerAuth: [] }], params: z.object({ id: z.string().uuid() }), response: { 200: envelopeSchema(z.record(z.unknown())), 202: envelopeSchema(z.record(z.unknown())), 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema } };
  api.delete('/sources/:id', { preHandler: [app.authenticate], schema: { ...schema, summary: 'Immediately block source use and enqueue physical content deletion' } }, async (req, reply) => {
    const auth = requireAuthContext(req);
    const receipt = await ctx.db.transaction(async tx => {
      const [source] = await tx.select().from(sources).where(eq(sources.id, req.params.id)).for('update');
      if (!source) throw AppError.notFound();
      const access = await resolveSourceAccess(tx, source, auth);
      if (!access.isAuthor && !access.isAdmin) throw AppError.forbidden();
      const [existing] = await tx.select().from(deletionJobs).where(and(eq(deletionJobs.scope, 'source'), eq(deletionJobs.subjectId, source.id)));
      if (existing) return existing;
      await tx.update(sources).set({ deletedAt: ctx.now(), permissionStatus: 'revoked', updatedAt: ctx.now() }).where(eq(sources.id, source.id));
      const owners = await tx.select().from(authorVerifications).where(eq(authorVerifications.sourceId, source.id));
      for (const owner of owners) await invalidateAuthorMemory(ctx, tx, owner.userId);
      await tx.update(consents).set({ status: 'revoked', revokedAt: ctx.now() }).where(eq(consents.sourceId, source.id));
      const cases = await tx.select({ id: followupCases.id }).from(followupCases).where(eq(followupCases.sourceId, source.id));
      const ids = cases.map(c => c.id);
      if (ids.length) {
        await tx.update(followupCases).set({ status: 'withdrawn', publishedVersionId: null }).where(inArray(followupCases.id, ids));
        await tx.update(followupVersions).set({ status: 'withdrawn', withdrawnAt: ctx.now() }).where(inArray(followupVersions.caseId, ids));
        await tx.update(notifications).set({ status: 'withdrawn' }).where(inArray(notifications.caseId, ids));
      }
      await tx.execute(sql`update jobs set status='cancelled', lease_owner=null, lease_expires_at=null, finished_at=now() where status in ('queued','running') and payload->>'source_id'=${source.id}`);
      await tx.update(outbox).set({ status: 'cancelled', recipients: [] }).where(sql`${outbox.payload}->>'source_id'=${source.id}`);
      const [record] = await tx.insert(deletionJobs).values({ scope: 'source', subjectId: source.id, subjectUserId: source.createdByUserId, requestedByUserId: auth.userId, steps: [{ step: 'access_blocked', status: 'succeeded', at: ctx.now().toISOString() }] }).returning();
      await ctx.jobs.enqueue({ kind: 'source.delete', dedupeKey: `delete:${source.id}`, payload: { source_id: source.id, deletion_id: record!.id, owner_user_id: auth.userId } }, tx);
      return record!;
    });
    return reply.code(202).send(success(req.id, { deletion_id: receipt.id, status: receipt.status }));
  });
  api.get('/deletions/:id', { preHandler: [app.authenticate], schema: { ...schema, summary: 'Read own content-free deletion receipt' } }, async req => {
    const [receipt] = await ctx.db.select().from(deletionJobs).where(and(eq(deletionJobs.id, req.params.id), eq(deletionJobs.requestedByUserId, requireAuthContext(req).userId)));
    if (!receipt) throw AppError.notFound();
    return success(req.id, { deletion_id: receipt.id, status: receipt.status, steps: receipt.steps, finished_at: receipt.finishedAt });
  });
};

export function registerDeletionJobs(ctx: ModuleContext, registry: JobHandlerRegistry) {
  registry.register('source.delete', async job => {
    const p = z.object({ source_id: z.string().uuid(), deletion_id: z.string().uuid(), owner_user_id: z.string().uuid() }).parse(job.payload);
    await ctx.db.transaction(async tx => {
      await tx.select({ id: sources.id }).from(sources).where(eq(sources.id, p.source_id)).for('update');
      await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
        const cases = await fenced.select({ id: followupCases.id }).from(followupCases).where(eq(followupCases.sourceId, p.source_id));
        const ids = cases.map(c => c.id);
        await fenced.delete(aiRuns).where(eq(aiRuns.sourceId, p.source_id));
        await fenced.delete(researchEvents).where(eq(researchEvents.sourceId, p.source_id));
        await fenced.delete(auditLogs).where(eq(auditLogs.subjectId, p.source_id));
        if (ids.length) {
          await fenced.delete(auditLogs).where(inArray(auditLogs.caseId, ids));
          await fenced.delete(researchEvents).where(inArray(researchEvents.caseId, ids));
        }
        await fenced.delete(outbox).where(sql`${outbox.payload}->>'source_id'=${p.source_id}`);
        await fenced.update(jobs).set({ payload: {}, result: null, lastError: null }).where(and(sql`${jobs.payload}->>'source_id'=${p.source_id}`, sql`${jobs.id} <> ${job.job.id}`));
        // Cached import responses may include private snapshots. Erase the requesting user's cache.
        await fenced.delete(idempotencyKeys).where(sql`${idempotencyKeys.userId}=${p.owner_user_id} or ${idempotencyKeys.responseBody}::text like ${`%${p.source_id}%`}`);
        await fenced.delete(sources).where(eq(sources.id, p.source_id));
        await fenced.update(deletionJobs).set({ status: 'succeeded', finishedAt: ctx.now(), steps: [{ step: 'active_storage_and_derivatives_removed', status: 'succeeded', at: ctx.now().toISOString() }, { step: 'provider_retention', status: 'external_policy_no_remote_delete_api' }, { step: 'backups', status: 'rotation_verification_required' }] }).where(eq(deletionJobs.id, p.deletion_id));
      });
    });
    return { data: { deletion_id: p.deletion_id, deleted: true } };
  });
}
