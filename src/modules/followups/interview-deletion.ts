import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleRegistrar } from '../../shared/types.js';
import { interviewSessions, followupCases, followupVersions, jobs, aiRuns, outbox, notifications, researchEvents, auditLogs, idempotencyKeys, deletionJobs } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { AppError, success } from '../../http/errors.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { requireCaseAuthor } from '../interviews/service.js';

export const registerInterviewDeletionRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.delete('/interviews/:id', { preHandler: [app.authenticate], schema: {
    tags: ['deletion'], security: [{ bearerAuth: [] }], params: z.object({ id: z.string().uuid() }),
    body: z.object({ confirms_deletion_and_withdrawal: z.literal(true) }).strict(),
    summary: 'Delete own interview and derived draft content, withdrawing affected publication in the same transaction',
    response: { 200: envelopeSchema(z.object({ deletion_id: z.string().uuid(), status: z.literal('succeeded') })), 400: errorEnvelopeSchema, 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
  } }, async req => {
    const auth = requireAuthContext(req);
    const receipt = await ctx.db.transaction(async tx => {
      const replay = async () => (await tx.select().from(deletionJobs).where(and(eq(deletionJobs.scope, 'interview'), eq(deletionJobs.subjectId, req.params.id), eq(deletionJobs.requestedByUserId, auth.userId))))[0];
      const existing = await replay();
      if (existing) return existing;
      const [initial] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, req.params.id));
      if (!initial) { const done = await replay(); if (done) return done; throw AppError.notFound(); }
      if (initial.ownerUserId !== auth.userId) throw AppError.notFound();
      const { caseRow } = await requireCaseAuthor(tx, initial.caseId, auth);
      const completed = await replay();
      if (completed) return completed;
      const [session] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, initial.id)).for('update');
      if (!session) throw AppError.notFound();
      const versions = await tx.select({ id: followupVersions.id }).from(followupVersions).where(eq(followupVersions.interviewId, session.id));
      const ids = versions.map(v => v.id);
      const affected = sql`${jobs.payload}->>'session_id'=${session.id} or ${ids.length ? inArray(sql`${jobs.payload}->>'draft_id'`, ids) : sql`false`} or ${ids.length ? inArray(sql`${jobs.payload}->>'version_id'`, ids) : sql`false`}`;
      const relatedJobs = await tx.select({ id: jobs.id }).from(jobs).where(affected);
      await tx.update(jobs).set({ status: 'cancelled', leaseOwner: null, leaseExpiresAt: null, finishedAt: ctx.now() }).where(and(sql`(${affected})`, sql`${jobs.status} in ('queued','running')`));
      await tx.update(jobs).set({ payload: {}, result: null, lastError: null }).where(affected);
      await tx.delete(aiRuns).where(eq(aiRuns.interviewSessionId, session.id));
      if (relatedJobs.length) await tx.delete(aiRuns).where(inArray(aiRuns.jobId, relatedJobs.map(j => j.id)));
      if (ids.length) {
        await tx.delete(aiRuns).where(inArray(sql`${aiRuns.output}->>'draft_id'`, ids));
        await tx.delete(outbox).where(inArray(sql`${outbox.payload}->>'version_id'`, ids));
        await tx.delete(notifications).where(inArray(notifications.followupVersionId, ids));
        await tx.delete(researchEvents).where(inArray(researchEvents.followupVersionId, ids));
        await tx.delete(auditLogs).where(inArray(auditLogs.subjectId, ids));
        await tx.update(followupVersions).set({ status: 'withdrawn', statements: [], unresolvedItems: [], authorEdits: [], authorConfirmations: [], privatePurgedAt: ctx.now(), contentPurgedAt: ctx.now(), withdrawnAt: ctx.now() }).where(inArray(followupVersions.id, ids));
      }
      await tx.delete(auditLogs).where(eq(auditLogs.subjectId, session.id));
      await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, auth.userId));
      await tx.delete(interviewSessions).where(eq(interviewSessions.id, session.id));
      if (!caseRow.publishedVersionId || ids.includes(caseRow.publishedVersionId)) {
        const [remaining] = await tx.select().from(interviewSessions).where(and(eq(interviewSessions.caseId, caseRow.id), sql`${interviewSessions.status} in ('active','paused')`));
        await tx.update(followupCases).set({ publishedVersionId: null, status: caseRow.declineFlag || caseRow.doNotContact ? 'declined' : remaining ? remaining.status === 'paused' ? 'paused' : 'interviewing' : 'accepted', updatedAt: ctx.now() }).where(eq(followupCases.id, caseRow.id));
      }
      const [record] = await tx.insert(deletionJobs).values({ scope: 'interview', subjectId: session.id, subjectUserId: auth.userId, requestedByUserId: auth.userId, status: 'succeeded', finishedAt: ctx.now(), steps: [
        { step: 'interview_and_derived_content_removed', status: 'succeeded', versions: ids.length },
        { step: 'provider_retention', status: 'external_policy_no_remote_delete_api' },
        { step: 'backups', status: 'rotation_verification_required' },
      ] }).returning();
      return record!;
    });
    return success(req.id, { deletion_id: receipt.id, status: 'succeeded' as const });
  });
};
