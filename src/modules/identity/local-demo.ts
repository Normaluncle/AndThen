import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppInstance, ModuleContext } from '../../shared/types.js';
import { users } from '../../db/schema.js';
import { envelopeSchema } from '../../http/envelope.js';
import { AppError, success } from '../../http/errors.js';
import { createSession } from './service.js';

// Provisioned by the local fixture script, never supplied by the browser.
export const DEMO_ACCOUNTS = [
  { path: 'reader', id: 'c04bfed0-818f-4628-a3d9-b991bdfc8001', role: 'reader' },
  { path: 'author', id: 'c04bfed0-818f-4628-a3d9-b991bdfc8002', role: 'author' },
] as const;
export function localDemoEnabled(ctx: ModuleContext) {
  return ctx.env.LOCAL_DEMO_LOGIN && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(ctx.env.PUBLIC_BASE_URL).hostname);
}
export async function registerLocalDemoRoutes(app: AppInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/auth/demo/status', { schema: { response: { 200: envelopeSchema(z.object({enabled:z.boolean()})) } } }, async request => success(request.id,{enabled:localDemoEnabled(ctx)}));
  for (const preset of DEMO_ACCOUNTS) r.post('/auth/demo/'+preset.path, {
    schema: { tags:['identity'], body:z.object({}).strict(), response:{200:envelopeSchema(z.object({session_token:z.string(),user:z.object({id:z.string(),role:z.string(),cohort:z.string(),display_name:z.string().nullable()})}))} },
  }, async (request,reply) => {
    if (!localDemoEnabled(ctx)) throw AppError.notFound();
    const origin=request.headers.origin;
    if (origin && origin!==new URL(ctx.env.PUBLIC_BASE_URL).origin) throw AppError.forbidden('Local demo requires same-origin requests');
    const result=await ctx.db.transaction(async tx=>{
      const [user]=await tx.select().from(users).where(eq(users.id,preset.id)).for('update');
      if (!user || user.disabledAt || user.role!==preset.role || user.cohort!=='local_demo_fixture') throw AppError.forbidden('Local demo account is not provisioned');
      const session=await createSession(tx,{userId:user.id,cohort:user.cohort,ttlSeconds:7200});
      return {session_token:session.token,user:{id:user.id,role:user.role,cohort:user.cohort,display_name:user.displayName}};
    });
    reply.header('cache-control','no-store');
    return success(request.id,result);
  });
}
