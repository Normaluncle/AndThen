import {sourcePresentation} from '../sources/presentation.js';
import {presentationShape} from '../sources/presentation-schema.js';
import {latestSnapshot} from '../sources/service.js';
import { reasonSummary } from '../sources/reasons.js';
import { and, count, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleDefinition } from '../../shared/types.js';
import { interests, zhihuAccounts, authorMemories, authorVerifications, followupCases, followupVersions, interviewSessions, sources } from '../../db/schema.js';
import {queueOAuthSync} from '../zhihu/oauth-sync.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema } from '../../http/envelope.js';
import { requestRefresh } from '../memory/service.js';
import { success } from '../../http/errors.js';
import { registerManagementRoutes } from './management.js';

export const workbenchModule: ModuleDefinition = {
  name: 'workbench',
  async registerRoutes(app, ctx) {
    await registerManagementRoutes(app, ctx);
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.get('/me/workbench', { preHandler: [app.authenticate], schema: { tags: ['workbench'], response: { 200: envelopeSchema(z.object({ items: z.array(z.object({ ...presentationShape, published_at:z.string().nullable(), text:z.string().nullable(), id: z.string(), source_id: z.string(), title: z.string().nullable(), status: z.string(), interest_count: z.number(), reader_interests:z.record(z.unknown()), interview_id: z.string().nullable(), draft_id: z.string().nullable() })) })) } } }, async request => {
      const auth = requireAuthContext(request);
      const [account]=await ctx.db.select().from(zhihuAccounts).where(eq(zhihuAccounts.userId,auth.userId));
      if(account?.syncConsentAt&&!account.revokedAt&&account.expiresAt>ctx.now())await queueOAuthSync(ctx,auth.userId);
      const [memory]=await ctx.db.select().from(authorMemories).where(eq(authorMemories.userId,auth.userId));
      if(memory?.enabled&&ctx.now().getTime()-memory.updatedAt.getTime()>86400000)await requestRefresh(ctx,auth.userId);
      const rows = await ctx.db.select({ c: followupCases, title: sources.title }).from(followupCases)
        .innerJoin(sources, eq(sources.id, followupCases.sourceId))
        .innerJoin(authorVerifications, and(eq(authorVerifications.sourceId, sources.id), eq(authorVerifications.userId, auth.userId), eq(authorVerifications.status, 'verified')))
        .where(isNull(sources.deletedAt)).orderBy(desc(followupCases.updatedAt)).limit(100);
      const items = [];
      for (const { c, title } of rows) {
        const [session] = await ctx.db.select().from(interviewSessions).where(and(eq(interviewSessions.caseId, c.id), eq(interviewSessions.ownerUserId, auth.userId))).orderBy(desc(interviewSessions.createdAt)).limit(1);
        const [draft] = await ctx.db.select().from(followupVersions).where(eq(followupVersions.caseId, c.id)).orderBy(desc(followupVersions.version)).limit(1);
        const [demand]=await ctx.db.select({total:count()}).from(interests).where(and(eq(interests.sourceId,c.sourceId),eq(interests.active,true)));
        const snapshot=await latestSnapshot(ctx.db,c.sourceId);
        items.push({ ...await sourcePresentation(ctx.db,c.sourceId,title,snapshot), published_at:snapshot?.publishedAt?.toISOString()??null,text:snapshot?.excerpt??snapshot?.body??null, reader_interests:await reasonSummary(ctx.db,c.sourceId), interest_count:demand?.total??0, id: c.id, source_id: c.sourceId, title, status: c.status, interview_id: session?.id ?? null, draft_id: draft?.id ?? null });
      }
      return success(request.id, { items });
    });
  },
};
