import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleRegistrar } from '../../shared/types.js';
import { followupCases, jobs, sourcePreparations, sources } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { success, AppError } from '../../http/errors.js';

export const registerManagementRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const querystring = z.object({ offset: z.coerce.number().int().min(0).default(0) }).strict();
  api.post('/operator/jobs/:id/retry', { preHandler:[app.authenticate,app.requireRole('admin')],schema:{tags:['workbench'],
    params:z.object({id:z.string().uuid()}),body:z.object({expected_updated_at:z.string().datetime()}).strict(),
    response:{200:envelopeSchema(z.object({job_id:z.string().uuid(),deduped:z.boolean()})),401:errorEnvelopeSchema,403:errorEnvelopeSchema,409:errorEnvelopeSchema}}},async request=>{
    const result=await ctx.db.transaction(async tx=>{
      const [old]=await tx.select().from(jobs).where(eq(jobs.id,request.params.id)).for('update');
      if(!old||old.status!=='failed'||old.updatedAt.toISOString()!==request.body.expected_updated_at)throw AppError.conflict('Failed task changed');
      // A fresh task invokes the original handler, including its current permission/version checks.
      const next=await ctx.jobs.enqueue({kind:old.kind,payload:old.payload,dedupeKey:old.dedupeKey??`operator-retry:${old.id}`,maxAttempts:old.maxAttempts},tx);
      await tx.update(jobs).set({status:'cancelled',updatedAt:ctx.now()}).where(eq(jobs.id,old.id));
      return {job_id:next.job.id,deduped:next.deduped};
    });
    return success(request.id,result);
  });
  api.get('/operator/sources', {
    preHandler: [app.authenticate, app.requireRole('researcher', 'admin')],
    schema: {
      tags: ['workbench'], security: [{ bearerAuth: [] }], querystring,
      summary: 'List manageable source metadata, without private material or credentials',
      response: {
        200: envelopeSchema(z.object({ items: z.array(z.object({
          source_id: z.string().uuid(), title: z.string().nullable(), permission_status: z.string(),
          case_id: z.string().uuid().nullable(), case_status: z.string().nullable(),
          preparation_status: z.string().nullable(),
        })), next_offset: z.number().nullable() })),
        401: errorEnvelopeSchema, 403: errorEnvelopeSchema,
      },
    },
  }, async request => {
    const auth = requireAuthContext(request);
    const rows = await ctx.db.select({
      source_id: sources.id, title: sources.title, permission_status: sources.permissionStatus,
      case_id: followupCases.id, case_status: followupCases.status,
      preparation_status: sourcePreparations.status,
    }).from(sources).leftJoin(followupCases, eq(followupCases.sourceId, sources.id))
      .leftJoin(sourcePreparations, eq(sourcePreparations.sourceId, sources.id))
      .where(and(isNull(sources.deletedAt), auth.role === 'admin' ? undefined :
        or(eq(sources.createdByUserId, auth.userId), eq(followupCases.createdByUserId, auth.userId))))
      .orderBy(desc(sources.createdAt), desc(sources.id)).limit(51).offset(request.query.offset);
    return success(request.id, { items: rows.slice(0, 50), next_offset: rows.length > 50 ? request.query.offset + 50 : null });
  });

  api.get('/operator/jobs', {
    preHandler: [app.authenticate, app.requireRole('admin')],
    schema: {
      tags: ['workbench'], security: [{ bearerAuth: [] }], querystring,
      summary: 'List failed task metadata; never returns payload, result or provider errors',
      response: {
        200: envelopeSchema(z.object({ items: z.array(z.object({
          id: z.string().uuid(), kind: z.string(), status: z.string(), attempts: z.number(),
          updated_at: z.string(),
        })), next_offset: z.number().nullable() })),
        401: errorEnvelopeSchema, 403: errorEnvelopeSchema,
      },
    },
  }, async request => {
    const rows = await ctx.db.select({ id: jobs.id, kind: jobs.kind, status: jobs.status,
      attempts: jobs.attempts, updatedAt: jobs.updatedAt }).from(jobs).where(eq(jobs.status, 'failed'))
      .orderBy(desc(jobs.updatedAt), desc(jobs.id)).limit(51).offset(request.query.offset);
    return success(request.id, {
      items: rows.slice(0, 50).map(({ updatedAt, ...row }) => ({ ...row, updated_at: updatedAt.toISOString() })),
      next_offset: rows.length > 50 ? request.query.offset + 50 : null,
    });
  });
};
