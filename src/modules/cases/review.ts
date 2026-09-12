import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleRegistrar } from '../../shared/types.js';
import type { Executor } from '../../db/client.js';
import { auditLogs, followupCases } from '../../db/schema.js';
import { AppError, success } from '../../http/errors.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { lockCase } from '../interviews/service.js';
import { latestSnapshot } from '../sources/service.js';
import { sourceRisk } from '../sources/analysis.js';
import { hasActiveConsent, isVerifiedAuthor } from '../sources/access.js';

export async function requireCurrentReview(db: Executor, caseId: string, snapshotHash: string) {
  const [review] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'case.reviewed'), eq(auditLogs.caseId, caseId))).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(1);
  if (!review || review.properties.decision !== 'eligible' || review.properties.snapshot_hash !== snapshotHash) throw AppError.conflict('Human review of the current source is required before recording an invitation');
}

export const registerReviewRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.post('/cases/:id/review', { preHandler: [app.authenticate, app.requireRole('researcher', 'admin')], schema: {
    tags: ['cases'], security: [{ bearerAuth: [] }], summary: 'Human review bound to case revision and source snapshot; never sends an invitation', params: z.object({ id: z.string().uuid() }),
    body: z.object({ expected_version: z.string().datetime({ offset: true }), snapshot_hash: z.string().min(1).max(128), decision: z.enum(['eligible', 'hold', 'excluded']),
      reason_code: z.enum(['source_checked', 'missing_material', 'sensitive_material', 'not_suitable', 'permission_missing']),
      evidence_ref: z.string().min(1).max(256), confirms_source_and_safety_review: z.literal(true) }).strict(),
    response: { 200: envelopeSchema(z.object({ case_id: z.string().uuid(), status: z.string(), version: z.string(), snapshot_hash: z.string() })), 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema, 409: errorEnvelopeSchema, 422: errorEnvelopeSchema },
  } }, async req => {
    const auth = requireAuthContext(req);
    const data = await ctx.db.transaction(async tx => {
      const { source, caseRow } = await lockCase(tx, req.params.id);
      if (auth.role !== 'admin' && caseRow.createdByUserId !== auth.userId) throw AppError.forbidden();
      const beforeContact = ['candidate', 'hold', 'eligible'].includes(caseRow.status);
      const authorInProgress = ['accepted', 'interviewing', 'paused', 'draft', 'confirmed'].includes(caseRow.status);
      if (caseRow.declineFlag || caseRow.doNotContact || (!beforeContact && !authorInProgress)) throw AppError.conflict('Closed cases cannot be reopened by review');
      if (authorInProgress && req.body.decision !== 'eligible') throw AppError.conflict('An in-progress author case may only receive an affirmative review; it is not reset to a contact state');
      if (caseRow.updatedAt.getTime() !== new Date(req.body.expected_version).getTime()) throw AppError.conflict('Case revision changed');
      const snapshot = await latestSnapshot(tx, source.id);
      if (!snapshot || snapshot.contentHash !== req.body.snapshot_hash) throw AppError.conflict('Snapshot changed');
      if (req.body.decision === 'eligible') {
        if (!['private_only', 'public_approved'].includes(source.permissionStatus)) throw AppError.consentRequired();
        if (source.sourceType === 'third_party_link' && (!caseRow.authorUserId
          || !await isVerifiedAuthor(tx,source.id,caseRow.authorUserId)
          || !await hasActiveConsent(tx,source.id,'private_interview',caseRow.authorUserId))) throw AppError.consentRequired('Imported links require verified authorship and interview consent before review');
        if (!(snapshot.body ?? snapshot.excerpt)?.trim()) throw AppError.sourceIncomplete();
        if (req.body.reason_code !== 'source_checked') throw AppError.validation('Eligibility requires an affirmative source review');
        if (sourceRisk(snapshot.body ?? snapshot.excerpt ?? '').length && auth.role !== 'admin') throw AppError.forbidden('Sensitive material requires administrator review');
      }
      const revision = new Date(Math.max(ctx.now().getTime(), caseRow.updatedAt.getTime() + 1));
      const status = beforeContact ? req.body.decision : caseRow.status;
      await tx.update(followupCases).set({ status, reviewerRequired: req.body.decision !== 'eligible', updatedAt: revision }).where(eq(followupCases.id, caseRow.id));
      await tx.insert(auditLogs).values({ actorType: 'user', actorUserId: auth.userId, action: 'case.reviewed', subjectType: 'case', subjectId: caseRow.id, caseId: caseRow.id, requestId: req.id, createdAt: revision,
        properties: { decision: req.body.decision, reason_code: req.body.reason_code, evidence_ref: req.body.evidence_ref, snapshot_hash: snapshot.contentHash } });
      return { case_id: caseRow.id, status, version: revision.toISOString(), snapshot_hash: snapshot.contentHash };
    });
    return success(req.id, data);
  });
};
