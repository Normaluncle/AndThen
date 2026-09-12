import { withJobFence,fenceOf,JobLeaseLostError } from '../../jobs/transaction.js';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleDefinition } from '../../shared/types.js';
import { authorMemories } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { success } from '../../http/errors.js';
import { envelopeSchema } from '../../http/envelope.js';
import { validMemoryRecords, memoryRequest, refreshMemory, requestRefresh } from './service.js';

const jobPayload = z.object({ user_id: z.string().uuid(), generation: z.string().uuid() });
export const memoryModule: ModuleDefinition = {
  name: 'memory',
  registerJobHandlers(ctx, registry) {
    registry.register('memory.refresh', async job => {
      const p = jobPayload.parse(job.payload);
      const interval = setInterval(() => { void job.heartbeat().catch(() => {}); }, 15000);
      try { return {data:await refreshMemory(ctx,p.user_id,p.generation,job)}; }
      catch (error) {
        if(!(error instanceof JobLeaseLostError)&&!job.signal.aborted)await ctx.db.transaction(async tx=>{
          await tx.select().from(authorMemories).where(eq(authorMemories.userId,p.user_id)).for('update');
          await withJobFence(tx,fenceOf(job.job),async fenced=>{await fenced.update(authorMemories).set({status:'error',errorCode:'memory_refresh_failed'}).where(and(eq(authorMemories.userId,p.user_id),eq(authorMemories.generation,p.generation)));});
        });
        throw error;
      } finally { clearInterval(interval); }
    });
    registry.register('memory.delete', async job => {
      const p = jobPayload.parse(job.payload);
      await memoryRequest(ctx, `/indexes/${p.user_id}/${p.generation}`, 'DELETE', undefined, job.signal);
      return { data: { deleted: true } };
    });
  },
  async registerRoutes(app, ctx) {
    const r = app.withTypeProvider<ZodTypeProvider>();
    const guard = { preHandler: [app.authenticate] };
    r.get('/me/memory', { ...guard, schema: { tags: ['memory'], response: { 200: envelopeSchema(z.object({
      enabled: z.boolean(), status: z.string(), updated_at: z.string().nullable(), error_code: z.string().nullable(),
      records: z.array(z.object({ name: z.string(), content: z.string(), source_id: z.string().uuid(), preference: z.boolean() })),
    })) } } }, async request => {
      const auth = requireAuthContext(request);
      const [row] = await ctx.db.select().from(authorMemories).where(eq(authorMemories.userId, auth.userId));
      if (row?.enabled && ctx.now().getTime() - row.updatedAt.getTime() > 86400000) await requestRefresh(ctx, auth.userId);
      const valid = row?.enabled ? await validMemoryRecords(ctx, auth.userId,row.records) : [];
      return success(request.id, { enabled: row?.enabled ?? false, status: row?.status ?? 'empty', updated_at: row?.updatedAt.toISOString() ?? null, error_code: row?.errorCode ?? null,
        records: valid.map(x => ({ name: x.name, content: x.content, source_id: x.sourceId, preference: x.preference })) });
    });
    r.put('/me/memory/consent', { ...guard, schema: { tags: ['memory'], body: z.object({ enabled: z.boolean() }).strict(), response: { 200: envelopeSchema(z.object({ enabled: z.boolean() })) } } }, async request => {
      const userId = requireAuthContext(request).userId;
      await ctx.db.transaction(async tx=>{
        await tx.insert(authorMemories).values({userId}).onConflictDoNothing();
        const [old]=await tx.select().from(authorMemories).where(eq(authorMemories.userId,userId)).for('update');
        if(old!.enabled===request.body.enabled)return;
        const generation=randomUUID();
        await tx.update(authorMemories).set({enabled:request.body.enabled,generation,records:[],inputHash:null,errorCode:null,status:request.body.enabled?'pending':'disabled',updatedAt:ctx.now()}).where(eq(authorMemories.userId,userId));
        await ctx.jobs.enqueue({kind:'memory.delete',payload:{user_id:userId,generation:old!.generation},dedupeKey:`memory:delete:${old!.generation}`},tx);
        if(request.body.enabled)await ctx.jobs.enqueue({kind:'memory.refresh',payload:{user_id:userId,generation},dedupeKey:`memory:${userId}:refresh`},tx);
      });
      return success(request.id, { enabled: request.body.enabled });
    });
    r.post('/me/memory/refresh', { ...guard, schema: { tags: ['memory'], response: { 200: envelopeSchema(z.object({ queued: z.boolean() })) } } }, async request => {
      await requestRefresh(ctx, requireAuthContext(request).userId);
      return success(request.id, { queued: true });
    });
  },
};
