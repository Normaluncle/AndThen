import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleRegistrar } from '../../shared/types.js';
import { storyReads, storyReactions, siteComments, siteReports, deletionJobs, interests, notifications, researchEvents, outbox, idempotencyKeys, auditLogs, sources } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { success } from '../../http/errors.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';

/** Activity erasure is separate from account closure; it never deletes another author's source. */
export const registerReaderDeletionRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.post('/me/data-deletion', { preHandler: [app.authenticate, app.requireRole('reader')], schema: {
    tags: ['deletion'], security: [{ bearerAuth: [] }],
    summary: 'Erase own reader activity through the request cutoff; account and subsequent activity remain available',
    body: z.object({ scope: z.literal('reader_activity'), confirms_deletion: z.literal(true), idempotency_key: z.string().min(1).max(128) }).strict(),
    response: { 200: envelopeSchema(z.object({ deletion_id: z.string().uuid(), status: z.literal('succeeded'), scope: z.literal('reader_activity') })), 400: errorEnvelopeSchema, 401: errorEnvelopeSchema, 403: errorEnvelopeSchema },
  } }, async req => {
    const auth = requireAuthContext(req);
    const reason = `reader_activity:${createHash('sha256').update(req.body.idempotency_key).digest('hex')}`;
    const receipt = await ctx.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reader-delete:${auth.userId}`}, 0))`);
      const [existing] = await tx.select().from(deletionJobs).where(and(eq(deletionJobs.scope, 'user'), eq(deletionJobs.subjectId, auth.userId), eq(deletionJobs.reason, reason)));
      if (existing) return existing;
      const cutoff = ctx.now();
      await tx.delete(storyReads).where(eq(storyReads.userId,auth.userId));
      await tx.delete(storyReactions).where(and(eq(storyReactions.userId,auth.userId),sql`${storyReactions.updatedAt} <= ${cutoff}`));
      await tx.delete(siteComments).where(and(eq(siteComments.userId,auth.userId),sql`${siteComments.createdAt} <= ${cutoff}`));
      await tx.delete(siteReports).where(and(eq(siteReports.userId,auth.userId),sql`${siteReports.createdAt} <= ${cutoff}`));
      // Follow/notification/research writers also take the source lock. Remove the
      // reader from frozen outbox recipients so an old publication cannot replay.
      await tx.select({ id: sources.id }).from(sources).where(sql`
        ${sources.id} in (select source_id from interests where reader_key=${auth.userId})
        or ${sources.id} in (select source_id from research_events where reader_key=${auth.userId})
        or ${sources.id} in (select c.source_id from notifications n join followup_cases c on c.id=n.case_id where n.reader_key=${auth.userId})
        or ${sources.id}::text in (select payload->>'source_id' from outbox where exists (select 1 from jsonb_array_elements(recipients) r where r->>'readerKey'=${auth.userId}))
      `).orderBy(sources.id).for('update');
      await tx.delete(interests).where(and(eq(interests.readerKey, auth.userId), sql`${interests.updatedAt} <= ${cutoff}`));
      await tx.delete(notifications).where(and(eq(notifications.readerKey, auth.userId), sql`(${notifications.createdAt} <= ${cutoff} or ${notifications.followupVersionId} in (select id from followup_versions where published_at <= ${cutoff}))`));
      await tx.delete(researchEvents).where(and(eq(researchEvents.readerKey, auth.userId), sql`${researchEvents.createdAt} <= ${cutoff}`));
      await tx.delete(auditLogs).where(and(eq(auditLogs.actorUserId, auth.userId), sql`${auditLogs.createdAt} <= ${cutoff}`));
      await tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.userId, auth.userId), sql`${idempotencyKeys.createdAt} <= ${cutoff}`));
      await tx.update(outbox).set({ recipients: sql`coalesce((select jsonb_agg(r) from jsonb_array_elements(${outbox.recipients}) r where r->>'readerKey' is distinct from ${auth.userId}), '[]'::jsonb)` }).where(sql`${outbox.createdAt} <= ${cutoff} and exists (select 1 from jsonb_array_elements(${outbox.recipients}) r where r->>'readerKey'=${auth.userId})`);
      const [record] = await tx.insert(deletionJobs).values({ scope: 'user', subjectId: auth.userId, subjectUserId: auth.userId, requestedByUserId: auth.userId, reason, status: 'succeeded', finishedAt: ctx.now(), steps: [
        { step: 'reader_activity', status: 'succeeded', through: cutoff.toISOString() },
        { step: 'account', status: 'retained_for_login_and_receipt' },
        { step: 'backups', status: 'rotation_verification_required' },
      ] }).returning();
      return record!;
    });
    return success(req.id, { deletion_id: receipt.id, status: 'succeeded' as const, scope: 'reader_activity' as const });
  });
};
