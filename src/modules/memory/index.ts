import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleDefinition } from '../../shared/types.js';
import { authorMemories } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { success } from '../../http/errors.js';
import { envelopeSchema } from '../../http/envelope.js';
import { authorizedMaterials, memoryRequest, refreshMemory, requestRefresh } from './service.js';

const jobPayload = z.object({ user_id: z.string().uuid(), generation: z.string().uuid() });
export const memoryModule: ModuleDefinition = {
  name: 'memory',
  registerJobHandlers(ctx, registry) {
    registry.register('memory.refresh', async job => {
      const p = jobPayload.parse(job.payload);
      const interval = setInterval(() => { void job.heartbeat().catch(() => {}); }, 15000);
      try { await refreshMemory(ctx, p.user_id, p.generation, job.signal); }
      catch (error) {
        await ctx.db.update(authorMemories).set({ status: 'error', errorCode: 'memory_refresh_failed' })
          .where(and(eq(authorMemories.userId, p.user_id), eq(authorMemories.generation, p.generation)));
        throw error;
      } finally { clearInterval(interval); }
      return { data: { processed: true } };
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
      const allowed = row?.enabled ? await authorizedMaterials(ctx, auth.userId) : [];
      return success(request.id, { enabled: row?.enabled ?? false, status: row?.status ?? 'empty', updated_at: row?.updatedAt.toISOString() ?? null, error_code: row?.errorCode ?? null,
        records: (row?.records ?? []).filter(x => allowed.some(a => a.snapshot.id === x.snapshotId)).map(x => ({ name: x.name, content: x.content, source_id: x.sourceId, preference: x.preference })) });
    });
    r.put('/me/memory/consent', { ...guard, schema: { tags: ['memory'], body: z.object({ enabled: z.boolean() }).strict(), response: { 200: envelopeSchema(z.object({ enabled: z.boolean() })) } } }, async request => {
      const userId = requireAuthContext(request).userId;
      const [old] = await ctx.db.select().from(authorMemories).where(eq(authorMemories.userId, userId));
      if (old?.enabled === request.body.enabled) return success(request.id, { enabled: old.enabled });
      await ctx.db.insert(authorMemories).values({ userId, enabled: request.body.enabled, status: request.body.enabled ? 'pending' : 'disabled' })
        .onConflictDoUpdate({ target: authorMemories.userId, set: { enabled: request.body.enabled, generation: randomUUID(), records: [], inputHash: null, status: request.body.enabled ? 'pending' : 'disabled', updatedAt: ctx.now() } });
      if (old) await ctx.jobs.enqueue({ kind: 'memory.delete', payload: { user_id: userId, generation: old.generation }, dedupeKey: `memory:delete:${old.generation}` });
      if (request.body.enabled) await requestRefresh(ctx, userId);
      return success(request.id, { enabled: request.body.enabled });
    });
    r.post('/me/memory/refresh', { ...guard, schema: { tags: ['memory'], response: { 200: envelopeSchema(z.object({ queued: z.boolean() })) } } }, async request => {
      await requestRefresh(ctx, requireAuthContext(request).userId);
      return success(request.id, { queued: true });
    });
  },
};
