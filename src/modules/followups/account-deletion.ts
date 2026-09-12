import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleRegistrar } from '../../shared/types.js';
import { sources, users, followupCases, interests, notifications, researchEvents, outbox, jobs, aiRuns, auditLogs, idempotencyKeys, deletionJobs } from '../../db/schema.js';
import { parseBearerToken, requireAuthContext } from '../../http/auth.js';
import { AppError, success } from '../../http/errors.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';

const receiptHash = (secret: string) => `account:${createHash('sha256').update(secret).digest('hex')}`;

export const registerAccountDeletionRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.post('/me/account-deletion', { preHandler: [app.authenticate, app.requireRole('reader', 'author')], schema: {
    tags: ['deletion'], security: [{ bearerAuth: [] }], summary: 'Erase an end-user account and author-owned sources; client saves receipt ID/secret before sending',
    body: z.object({ receipt_id: z.string().uuid(), receipt_secret: z.string().min(32).max(128), confirms_account_and_content_deletion: z.literal(true) }).strict(),
    response: { 200: envelopeSchema(z.object({ deletion_id: z.string().uuid(), status: z.literal('succeeded') })), 400: errorEnvelopeSchema, 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 409: errorEnvelopeSchema, 503: errorEnvelopeSchema },
  } }, async req => {
    const auth = requireAuthContext(req);
    const reason = receiptHash(req.body.receipt_secret);
    for (let attempt = 0; ; attempt++) {
      try {
        const id = await ctx.db.transaction(async tx => {
          // Rare local-Demo operation: serialize business writers, then erase in one
          // transaction. No provider call or filesystem operation holds these locks.
          await tx.execute(sql`set local lock_timeout='3s'`);
          await tx.execute(sql`set local statement_timeout='15s'`);
          await tx.execute(sql`lock table sources, followup_cases, interview_sessions, followup_versions, interests, notifications, research_events, outbox, jobs, ai_runs, audit_logs, idempotency_keys, consents, author_verifications, invitations, source_snapshots, login_tokens, sessions, users, deletion_jobs in exclusive mode`);
          const [existing] = await tx.select().from(deletionJobs).where(eq(deletionJobs.id, req.body.receipt_id));
          if (existing) {
            if (existing.subjectId !== auth.userId || existing.reason !== reason) throw AppError.conflict('Receipt ID already used');
            return existing.id;
          }
          const [owner] = await tx.select().from(users).where(eq(users.id, auth.userId));
          if (!owner) throw AppError.unauthorized('Account unavailable');
          const [memory] = await tx.select().from(authorMemories).where(eq(authorMemories.userId, auth.userId)).for('update');
          if (memory) {
            await tx.delete(authorMemories).where(eq(authorMemories.userId, auth.userId));
            await ctx.jobs.enqueue({ kind: 'memory.delete', payload: { user_id: auth.userId, generation: memory.generation }, dedupeKey: `memory:delete:${memory.generation}` }, tx);
          }
          const owned = await tx.select({ id: sources.id }).from(sources).where(sql`${sources.createdByUserId}=${auth.userId} or exists(select 1 from author_verifications v where v.source_id=${sources.id} and v.user_id=${auth.userId} and v.status='verified') or exists(select 1 from followup_cases c where c.source_id=${sources.id} and c.author_user_id=${auth.userId})`);
          const ids = owned.map(s => s.id);
          const cases = ids.length ? await tx.select({ id: followupCases.id }).from(followupCases).where(inArray(followupCases.sourceId, ids)) : [];
          const affected = sql`(${jobs.payload}->>'owner_user_id'=${auth.userId} or ${ids.length ? inArray(sql`${jobs.payload}->>'source_id'`, ids) : sql`false`})`;
          const affectedJobs = await tx.select({ id: jobs.id }).from(jobs).where(affected);
          await tx.update(jobs).set({ status: 'cancelled', leaseOwner: null, leaseExpiresAt: null, finishedAt: ctx.now() }).where(and(affected, sql`${jobs.status} in ('queued','running')`));
          await tx.update(jobs).set({ payload: {}, result: null, lastError: null }).where(affected);
          if (affectedJobs.length) await tx.delete(aiRuns).where(inArray(aiRuns.jobId, affectedJobs.map(j => j.id)));
          if (ids.length) {
            await tx.delete(aiRuns).where(inArray(aiRuns.sourceId, ids));
            await tx.delete(researchEvents).where(inArray(researchEvents.sourceId, ids));
            await tx.delete(auditLogs).where(inArray(auditLogs.subjectId, ids));
            await tx.delete(outbox).where(inArray(sql`${outbox.payload}->>'source_id'`, ids));
            for (const sourceId of ids) await tx.delete(idempotencyKeys).where(sql`${idempotencyKeys.responseBody}::text like ${`%${sourceId}%`}`);
          }
          if (cases.length) {
            const caseIds = cases.map(c => c.id);
            await tx.delete(auditLogs).where(inArray(auditLogs.caseId, caseIds));
            await tx.delete(aiRuns).where(inArray(aiRuns.caseId, caseIds));
            await tx.delete(researchEvents).where(inArray(researchEvents.caseId, caseIds));
          }
          await tx.delete(interests).where(eq(interests.readerKey, auth.userId));
          await tx.delete(notifications).where(eq(notifications.readerKey, auth.userId));
          await tx.delete(researchEvents).where(eq(researchEvents.readerKey, auth.userId));
          await tx.delete(auditLogs).where(eq(auditLogs.actorUserId, auth.userId));
          await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, auth.userId));
          await tx.update(outbox).set({ recipients: sql`coalesce((select jsonb_agg(r) from jsonb_array_elements(${outbox.recipients}) r where r->>'readerKey' is distinct from ${auth.userId}), '[]'::jsonb)` }).where(sql`exists(select 1 from jsonb_array_elements(${outbox.recipients}) r where r->>'readerKey'=${auth.userId})`);
          if (ids.length) await tx.delete(sources).where(inArray(sources.id, ids));
          await tx.delete(users).where(eq(users.id, auth.userId));
          await tx.insert(deletionJobs).values({ id: req.body.receipt_id, scope: 'user', subjectId: auth.userId, reason, status: 'succeeded', finishedAt: ctx.now(), steps: [
            { step: 'account_credentials_activity_and_author_content', status: 'succeeded', source_count: ids.length },
            { step: 'provider_retention', status: 'external_policy_no_remote_delete_api' },
            { step: 'backups', status: 'rotation_verification_required' },
          ] });
          return req.body.receipt_id;
        });
        return success(req.id, { deletion_id: id, status: 'succeeded' as const });
      } catch (error) {
        const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
        if (code === '40P01' && attempt < 2) continue;
        if (['40P01', '55P03', '57014'].includes(code ?? '')) throw AppError.serviceUnavailable('Account erasure busy; check saved receipt before retrying');
        throw error;
      }
    }
  });
  api.get('/deletion-receipts/:id', { schema: { tags: ['deletion'], params: z.object({ id: z.string().uuid() }), summary: 'Read an account-erasure receipt using its dedicated bearer secret, never a login session', response: { 200: envelopeSchema(z.record(z.unknown())), 404: errorEnvelopeSchema } } }, async req => {
    const secret = parseBearerToken(req.headers.authorization);
    if (!secret || secret.length < 32 || secret.length > 128) throw AppError.notFound();
    const [receipt] = await ctx.db.select().from(deletionJobs).where(and(eq(deletionJobs.id, req.params.id), eq(deletionJobs.scope, 'user'), eq(deletionJobs.reason, receiptHash(secret))));
    if (!receipt) throw AppError.notFound();
    return success(req.id, { deletion_id: receipt.id, status: receipt.status, steps: receipt.steps, finished_at: receipt.finishedAt });
  });
};
import { authorMemories } from '../../db/schema.js';
