import { z } from 'zod';
import { oauthReady, registerOAuthRoutes } from './oauth-routes.js';
import {syncOAuthAuthor} from './oauth-sync.js';
import { eq } from 'drizzle-orm';
import { sources, zhihuCommentSyncs } from '../../db/schema.js';
import { storeCandidates,candidateFeed,followCandidate } from './discovery.js';
import { syncCommentPage } from './comments.js';
import { requirePublicStory } from '../sources/service.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleDefinition } from '../../shared/types.js';
import { success, AppError } from '../../http/errors.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { canonicalZhihuUrl, parseZhihuShare, officialSearch } from './client.js';
import { importSource } from '../sources/service.js';

import { ownContents, ownContent, ownComments, offsetSchema } from './creator.js';

const candidate = z.object({ candidate_id:z.string().uuid().optional(),linked_source_id:z.string().uuid().nullable().optional(),interested:z.boolean().optional(),url: z.string(), title: z.string(), text: z.string(), author_name: z.string(), author_avatar: z.string().nullable(), author_url: z.null(), material_level: z.literal('api_summary'), comments: z.array(z.string()), comments_coverage: z.literal('selected') });
export const zhihuModule: ModuleDefinition = {
  name: 'zhihu',
  registerJobHandlers(ctx,registry) { registry.register('zhihu.comments.sync',job=>syncCommentPage(ctx,job)); registry.register('zhihu.author.sync',job=>syncOAuthAuthor(ctx,job)); },
  async registerRoutes(app, ctx) {
    await registerOAuthRoutes(app, ctx);
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.get('/integrations/zhihu/capabilities', { schema: { tags: ['zhihu'], response: { 200: envelopeSchema(z.object({ search: z.boolean(), creator_account_reads: z.boolean(), comment_sync_scope: z.literal('access_secret_owner_only'), oauth: z.boolean(), oauth_reason: z.string(), arbitrary_fulltext: z.literal(false), comments: z.literal('selected_search_comments') })) } } }, async request => success(request.id, {
      search: !!ctx.env.ZHIHU_ACCESS_SECRET, creator_account_reads: !!ctx.env.ZHIHU_ACCESS_SECRET, comment_sync_scope: 'access_secret_owner_only', oauth: oauthReady(ctx), oauth_reason: oauthReady(ctx) ? 'available' : ctx.env.ZHIHU_APP_ID && ctx.env.ZHIHU_APP_KEY ? 'callback_security_requires_verification' : 'app_credentials_missing', arbitrary_fulltext: false, comments: 'selected_search_comments',
    }));
    r.get('/discovery/search', { preHandler: [app.authenticate], schema: { tags: ['zhihu'], querystring: z.object({ q: z.string().trim().min(1).max(300) }), response: { 200: envelopeSchema(z.object({ items: z.array(candidate) })) } } }, async request => success(request.id, { items: await storeCandidates(ctx,await officialSearch(ctx.env.ZHIHU_ACCESS_SECRET, request.query.q)) }));
    r.get('/discovery/feed',{preHandler:[app.authenticate],schema:{tags:['zhihu'],response:{200:envelopeSchema(z.object({items:z.array(candidate)}))}}},async request=>success(request.id,{items:await candidateFeed(ctx,requireAuthContext(request))}));
    r.get('/discovery/following',{preHandler:[app.authenticate],schema:{tags:['zhihu'],response:{200:envelopeSchema(z.object({items:z.array(candidate)}))}}},async request=>success(request.id,{items:await candidateFeed(ctx,requireAuthContext(request),true)}));
    r.put('/discovery/candidates/:id/interest',{preHandler:[app.authenticate],schema:{tags:['zhihu'],params:z.object({id:z.string().uuid()}),body:z.object({active:z.boolean()}).strict(),response:{200:envelopeSchema(z.record(z.unknown()))}}},async request=>success(request.id,await followCandidate(ctx,requireAuthContext(request),request.params.id,request.body.active)));
    r.post('/sources/resolve', { preHandler: [app.authenticate], schema: { tags: ['zhihu'], body: z.object({ url: z.string().min(1).max(4000) }).strict(), response: { 200: envelopeSchema(z.object({ source_id: z.string().uuid(), status: z.enum(['summary_available', 'pending_content']), candidate: candidate.nullable() })) } } }, async request => {
      const auth = requireAuthContext(request);
      const url = parseZhihuShare(request.body.url);
      const items = await officialSearch(ctx.env.ZHIHU_ACCESS_SECRET, url);
      const exact = items.find(x => x.url === url);
      const match=exact?(await storeCandidates(ctx,[exact]))[0]:undefined;
      const imported = await importSource(ctx, auth, { sourceType: 'third_party_link', originalUrl: url, originalAccountRef: null,
        title: match?.title ?? null, materialLevel: 'api_summary', body: match?.text ?? null, excerpt: null, excerptLocation: null,
        publishedAt: null, upstreamUpdatedAt: null, notes: 'Official exact URL resolution; ownership not established', provenance: 'official_api' });
      return success(request.id, { source_id: imported.source.id, status: match ? 'summary_available' : 'pending_content', candidate: match ?? null });
    });
    // These routes operate only for trusted administrators on the configured
    // credential's account. A local author login is never a substitute for OAuth.
    const creatorResponse = { 200: envelopeSchema(z.record(z.unknown())), 400: errorEnvelopeSchema, 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 422: errorEnvelopeSchema, 429: errorEnvelopeSchema, 503: errorEnvelopeSchema };
    const creatorHooks = { preHandler: [app.authenticate, app.requireRole('admin')] };
    r.get('/integrations/zhihu/creator/contents', { ...creatorHooks, schema: { tags: ['zhihu'], security: [{ bearerAuth: [] }], querystring: z.object({ offset: offsetSchema.default('0') }).strict(), response: creatorResponse } }, async request => success(request.id, await ownContents(ctx.env.ZHIHU_ACCESS_SECRET, request.query.offset)));
    r.get('/integrations/zhihu/creator/content', { ...creatorHooks, schema: { tags: ['zhihu'], security: [{ bearerAuth: [] }], querystring: z.object({ url: z.string().url().max(1000) }).strict(), response: creatorResponse } }, async request => success(request.id, await ownContent(ctx.env.ZHIHU_ACCESS_SECRET, request.query.url)));
    r.get('/integrations/zhihu/creator/comments', { ...creatorHooks, schema: { tags: ['zhihu'], security: [{ bearerAuth: [] }], querystring: z.object({ url: z.string().url().max(1000), offset: offsetSchema.default('0') }).strict(), response: creatorResponse } }, async request => success(request.id, await ownComments(ctx.env.ZHIHU_ACCESS_SECRET, request.query.url, request.query.offset)));
    r.post('/sources/:id/zhihu/comments/sync', { ...creatorHooks, schema: { tags:['zhihu'], security:[{bearerAuth:[]}], params:z.object({id:z.string().uuid()}), response:{...creatorResponse,202:envelopeSchema(z.record(z.unknown()))} } },async(request,reply)=>{
      const auth=requireAuthContext(request);
      const [source]=await ctx.db.select().from(sources).where(eq(sources.id,request.params.id));
      if(!source || source.deletedAt)throw AppError.notFound();
      if(!source.originalUrl)throw AppError.sourceIncomplete();
      canonicalZhihuUrl(source.originalUrl);
      const {job,deduped}=await ctx.jobs.enqueue({kind:'zhihu.comments.sync',maxAttempts:1,payload:{source_id:source.id,owner_user_id:auth.userId},dedupeKey:`zhihu:comments:${source.id}`});
      return reply.code(202).send(success(request.id,{job_id:job.id,deduped}));
    });
    r.get('/stories/:id/comments', {schema:{tags:['zhihu'],params:z.object({id:z.string().uuid()}),response:creatorResponse}},async request=>{
      await requirePublicStory(ctx.db,request.params.id);
      const [state]=await ctx.db.select().from(zhihuCommentSyncs).where(eq(zhihuCommentSyncs.sourceId,request.params.id));
      return success(request.id,{items:state?.items??[],coverage:'paged_roots_with_partial_children',synced_at:state?.updatedAt.toISOString()??null,is_end:state?.isEnd??false,stopped_reason:state?.stoppedReason??null});
    });
    r.get('/auth/zhihu/start', { schema: { tags: ['zhihu'] } }, async () => { throw AppError.serviceUnavailable('Zhihu OAuth awaits application credentials and callback security verification'); });
  },
};
