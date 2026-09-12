import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { notifications, interviewSessions, followupVersions } from '../../db/schema.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleRegistrar } from '../../shared/types.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { AppError, success } from '../../http/errors.js';
import { draftStatementSchema } from '../../ai/tasks.js';
import { confirmDraft, createManualDraft, editDraft, getDraft, publicFollowup, publishDraft, withdrawFollowup } from './service.js';
import { requirePrivateFresh } from './retention.js';

export const registerFollowupRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ id: z.string().uuid() });
  const response = { 200: envelopeSchema(z.record(z.unknown())), 400: errorEnvelopeSchema, 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema, 409: errorEnvelopeSchema, 410: errorEnvelopeSchema, 422: errorEnvelopeSchema };
  const base = { tags: ['followups'], params, response, security: [{ bearerAuth: [] }] };
  const hooks = { preHandler: [app.authenticate] };
  for (const path of ['/notifications', '/me/notifications']) api.get(path, { ...hooks, schema: { tags: ['notifications'], response, security: base.security, summary: 'List own notification metadata; bodies are read through the authorized public endpoint' } }, async req => {
    const items = await ctx.db.select().from(notifications).where(eq(notifications.readerKey, requireAuthContext(req).userId)).orderBy(desc(notifications.createdAt)).limit(100);
    return success(req.id, { items });
  });
  api.post('/notifications/:id/read', { ...hooks, schema: { ...base, summary: 'Mark own notification read' } }, async req => {
    const [item] = await ctx.db.select().from(notifications).where(and(eq(notifications.id, req.params.id), eq(notifications.readerKey, requireAuthContext(req).userId)));
    if (!item) throw AppError.notFound();
    await ctx.db.update(notifications).set({ status: 'read', readAt: ctx.now() }).where(and(eq(notifications.id, item.id), eq(notifications.status, 'unread')));
    return success(req.id, { notification_id: item.id });
  });
  api.get('/jobs/:id', { ...hooks, schema: { ...base, summary: 'Read own asynchronous job status without payload or provider errors' } }, async req => {
    const job = await ctx.jobs.getById(req.params.id);
    if (!job) throw AppError.notFound();
    if (job.payload.owner_user_id !== requireAuthContext(req).userId) throw AppError.forbidden();
    if (typeof job.payload.session_id === 'string') {
      const [session] = await ctx.db.select().from(interviewSessions).where(eq(interviewSessions.id, job.payload.session_id));
      if (!session) throw AppError.withdrawn();
      requirePrivateFresh(session.updatedAt, ctx.now());
    }
    if (typeof job.payload.draft_id === 'string') {
      const [draft] = await ctx.db.select().from(followupVersions).where(eq(followupVersions.id, job.payload.draft_id));
      if (!draft || draft.contentPurgedAt) throw AppError.withdrawn();
      requirePrivateFresh(draft.updatedAt, ctx.now());
    }
    return success(req.id, { job_id: job.id, status: job.status, result: job.result, attempts: job.attempts });
  });
  api.post('/interviews/:id/draft', { ...hooks, schema: { ...base, summary: 'Build an evidence-preserving manual draft from saved author answers' } }, async req => success(req.id, await createManualDraft(ctx, requireAuthContext(req), req.params.id)));
  api.get('/drafts/:id', { ...hooks, schema: { ...base, summary: 'Read own draft with evidence and confirmations' } }, async req => success(req.id, await getDraft(ctx.db, req.params.id, requireAuthContext(req))));
  api.patch('/drafts/:id', { ...hooks, schema: { ...base, summary: 'Create a new version from explicit author edits; previous public version stays visible', body: z.object({ expected_version: z.number().int().positive(), statements: z.array(draftStatementSchema).min(1).max(100) }).strict() } }, async req => success(req.id, await editDraft(ctx, requireAuthContext(req), req.params.id, req.body.expected_version, req.body.statements)));
  api.post('/drafts/:id/confirm', { ...hooks, schema: { ...base, summary: 'Confirm all statement IDs against the current content hash', body: z.object({ content_hash: z.string().length(64), statement_ids: z.array(z.string()).min(1).max(100) }).strict() } }, async req => success(req.id, await confirmDraft(ctx, requireAuthContext(req), req.params.id, req.body.content_hash, req.body.statement_ids)));
  api.post('/drafts/:id/publish', { ...hooks, schema: { ...base, summary: 'Atomically publish the confirmed draft and freeze follower recipients', body: z.object({ content_hash: z.string().length(64), confirms_publication: z.literal(true) }).strict() } }, async req => success(req.id, await publishDraft(ctx, requireAuthContext(req), req.params.id, req.body.content_hash)));
  api.post('/followups/:id/withdraw', { ...hooks, schema: { ...base, summary: 'Immediately withdraw the current public version' } }, async req => success(req.id, await withdrawFollowup(ctx, requireAuthContext(req), req.params.id)));
  api.get('/followups/:id', { schema: { ...base, security: [], summary: 'Read only currently authorized public statements' } }, async req => success(req.id, await publicFollowup(ctx.db, req.params.id)));
};
