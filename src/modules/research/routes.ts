import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleRegistrar } from '../../shared/types.js';
import { researchEvents, sources, followupCases, followupVersions, interests, invitations, idempotencyKeys } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { AppError, success } from '../../http/errors.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { isExcludedCohort, isPubliclyVisible, resolveSourceAccess } from '../sources/access.js';
import { contentHash } from '../../ai/evidence.js';

const eventInput = z.object({
  source_id: z.string().uuid(),
  event_type: z.enum(['source_view', 'followup_view', 'feedback']),
  client_event_id: z.string().min(1).max(128),
  followup_version_id: z.string().uuid().optional(),
  feedback: z.enum(['useful', 'not_useful', 'uncertain']).optional(),
  prompted: z.boolean().default(false),
}).strict().superRefine((input, ctx) => {
  if (input.event_type === 'followup_view' && !input.followup_version_id) ctx.addIssue({ code: 'custom', message: 'followup_view needs a published version' });
  if ((input.event_type === 'feedback') !== !!input.feedback) ctx.addIssue({ code: 'custom', message: 'feedback value is only required for feedback events' });
});

export const registerResearchRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const common = { tags: ['research'], security: [{ bearerAuth: [] }] };
  api.post('/research/events', { preHandler: [app.authenticate], schema: { ...common, summary: 'Record allowlisted reader observations; identity, cohort and exclusions are server-derived', body: eventInput,
    response: { 200: envelopeSchema(z.object({ event_id: z.string().uuid(), deduped: z.boolean(), excluded: z.boolean() })), 400: errorEnvelopeSchema, 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema, 409: errorEnvelopeSchema } } }, async req => {
    const auth = requireAuthContext(req);
    const input = req.body;
    const data = await ctx.db.transaction(async tx => {
      // Lock source first: deletion and public-permission revocation use the same order.
      const [source] = await tx.select().from(sources).where(eq(sources.id, input.source_id)).for('update');
      if (!source || !await isPubliclyVisible(tx, source)) throw AppError.notFound();
      const scope = `research:${auth.userId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${scope}:${input.client_event_id}`}))`);
      const hash = contentHash(input);
      const [replay] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, input.client_event_id)));
      if (replay) {
        if (replay.requestHash !== hash) throw AppError.conflict('Event key reused with different content');
        const saved = z.object({ event_id: z.string().uuid(), excluded: z.boolean() }).parse(replay.responseBody);
        return { ...saved, deduped: true };
      }
      if (input.followup_version_id) {
        const [version] = await tx.select({ id: followupVersions.id }).from(followupVersions)
          .innerJoin(followupCases, eq(followupCases.publishedVersionId, followupVersions.id))
          .where(and(eq(followupVersions.id, input.followup_version_id), eq(followupVersions.status, 'published'), eq(followupCases.sourceId, source.id)));
        if (!version) throw AppError.notFound('Current public followup not found');
      }
      const access = await resolveSourceAccess(tx, source, auth);
      const excluded = auth.role !== 'reader' || access.isAuthor || isExcludedCohort(auth.cohort) || source.provenance !== 'real_authorized' || input.prompted;
      const [event] = await tx.insert(researchEvents).values({ eventType: input.event_type, cohort: auth.cohort, readerKey: auth.userId, sourceId: source.id, followupVersionId: input.followup_version_id,
        occurredAt: ctx.now(), properties: { excluded, prompted: input.prompted, feedback: input.feedback ?? null, provenance: source.provenance } }).returning({ id: researchEvents.id });
      const saved = { event_id: event!.id, excluded };
      await tx.insert(idempotencyKeys).values({ scope, key: input.client_event_id, requestHash: hash, userId: auth.userId, responseStatus: 200, responseBody: { ...saved, source_id: source.id }, expiresAt: new Date(ctx.now().getTime() + 30 * 86400000) });
      return { ...saved, deduped: false };
    });
    return success(req.id, data);
  });

  api.get('/research/export', { preHandler: [app.authenticate, app.requireRole('researcher', 'admin')], schema: { ...common, summary: 'Export per-source aggregate research metrics with explicit denominators; no raw identities or text', querystring: z.object({ source_id: z.string().uuid() }).strict(),
    response: { 200: envelopeSchema(z.record(z.unknown())), 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema } } }, async req => {
    const auth = requireAuthContext(req);
    const data = await ctx.db.transaction(async tx => {
      const [source] = await tx.select().from(sources).where(eq(sources.id, req.query.source_id)).for('update');
      if (!source || source.deletedAt) throw AppError.notFound();
      const access = await resolveSourceAccess(tx, source, auth);
      if (!access.isAdmin && !access.isImporter && !access.isAssignedResearcher) throw AppError.forbidden();
      const events = await tx.select().from(researchEvents).where(eq(researchEvents.sourceId, source.id));
      const follows = await tx.select().from(interests).where(eq(interests.sourceId, source.id));
      const cases = await tx.select().from(followupCases).where(eq(followupCases.sourceId, source.id));
      const inviteRows = await tx.select({ invitation: invitations }).from(invitations).innerJoin(followupCases, eq(followupCases.id, invitations.caseId)).where(eq(followupCases.sourceId, source.id));
      const authors = new Set(cases.map(c => c.authorUserId).filter(Boolean));
      if (source.sourceType === 'author_paste' && source.createdByUserId) authors.add(source.createdByUserId);
      const eligible = events.filter(e => e.properties.excluded === false && !isExcludedCohort(e.cohort) && e.readerKey && !authors.has(e.readerKey) && source.provenance === 'real_authorized');
      const cohorts = [...new Set(events.map(e => e.cohort).concat(follows.map(f => f.cohort)))].sort();
      const groups = cohorts.map(cohort => {
        const cohortEvents = eligible.filter(e => e.cohort === cohort);
        const exposed = new Set(cohortEvents.filter(e => e.eventType === 'source_view').map(e => e.readerKey!));
        const active = follows.filter(f => f.cohort === cohort && f.active && !f.excluded && f.triggeredBy === 'natural' && !authors.has(f.readerKey) && !isExcludedCohort(cohort) && source.provenance === 'real_authorized');
        const matched = new Set(active.filter(f => exposed.has(f.readerKey)).map(f => f.readerKey));
        return { cohort, unique_source_viewers: exposed.size, active_natural_followers: active.length, exposed_active_followers: matched.size,
          exposure_to_active_interest_ratio: exposed.size ? matched.size / exposed.size : null,
          feedback: { useful: cohortEvents.filter(e => e.eventType === 'feedback' && e.properties.feedback === 'useful').length, not_useful: cohortEvents.filter(e => e.eventType === 'feedback' && e.properties.feedback === 'not_useful').length, uncertain: cohortEvents.filter(e => e.eventType === 'feedback' && e.properties.feedback === 'uncertain').length },
          excluded_event_count: events.filter(e => e.cohort === cohort).length - cohortEvents.length };
      });
      const mature = inviteRows.filter(({ invitation: i }) => i.observationDeadline && i.observationDeadline <= ctx.now());
      const eligibleInvites = source.provenance === 'real_authorized' ? mature : [];
      const accepted = eligibleInvites.filter(({ invitation: i }) => i.result === 'accepted').length;
      return { export_id: randomUUID(), generated_at: ctx.now().toISOString(), source_id: source.id, provenance: source.provenance, cohorts: groups,
        invitation_observations: { recorded: inviteRows.length, window_complete: mature.length, pending_or_unknown_window: inviteRows.length - mature.length, eligible_denominator: eligibleInvites.length, currently_accepted_completed_records: accepted, current_acceptance_ratio: eligibleInvites.length ? accepted / eligibleInvites.length : null },
        limitations: ['Convenience sample; not a platform-wide conversion estimate', 'Exposure ratio uses distinct viewers matched to current active natural follows', 'No exposure denominator produces null, never a fabricated zero rate', 'Test, prompted and author behavior are excluded; feedback counts are observations, not unique people', 'Invitation acceptance reflects current status, not the unrecorded response time within a fixed observation window', 'No invitation sends or recruitment are performed by this API'] };
    });
    return success(req.id, data);
  });
};
