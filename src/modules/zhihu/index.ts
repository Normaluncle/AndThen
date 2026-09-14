import {sourcePresentation} from '../sources/presentation.js';
import {seedDiscovery,scanDiscovery,discoveryKind,registerDiscoveryRoutes} from './auto-discovery.js';
import {presentationShape} from '../sources/presentation-schema.js';
import { z } from 'zod';
import { oauthReady, registerOAuthRoutes } from './oauth-routes.js';
import {syncOAuthAuthor} from './oauth-sync.js';
import { and, eq } from 'drizzle-orm';
import { sources, zhihuCommentSyncs,discoveryCandidates, interests } from '../../db/schema.js';
import { storeCandidates,candidateFeed,followCandidate } from './discovery.js';
import { syncCommentPage } from './comments.js';
import { requirePublicStory } from '../sources/service.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleDefinition } from '../../shared/types.js';
import { success, AppError } from '../../http/errors.js';
import { requireAuthContext, parseBearerToken } from '../../http/auth.js';
import { cookieToken } from '../../http/session-cookie.js';
import { resolveSession } from '../identity/service.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { canonicalZhihuUrl, parseZhihuShare, officialSearch } from './client.js';
import { engagementFields } from './heat.js';
import { resolveImportInput } from './resolve-input.js';
import { importSource } from '../sources/service.js';

import { ownContents, ownContent, ownComments, offsetSchema } from './creator.js';

const candidate = z.object({...z.object(presentationShape).partial().shape, candidate_id:z.string().uuid().optional(),linked_source_id:z.string().uuid().nullable().optional(),interested:z.boolean().optional(),url: z.string(), title: z.string(), text: z.string(), author_name: z.string(), author_avatar: z.string().nullable(), author_url: z.null(), upstream_updated_at: z.string().datetime().nullable().optional(), acquired_at: z.string().datetime().nullable().optional(), vote_up_count: z.number().int().min(0).nullable().optional(), comment_count: z.number().int().min(0).nullable().optional(), ranking_score: z.number().nullable().optional(), heat: z.number().int().min(0).nullable().optional(), material_level: z.literal('api_summary'), comments: z.array(z.string()), comments_coverage: z.literal('selected') });
export const zhihuModule: ModuleDefinition = {
  name: 'zhihu',
  onWorkerStart: async ctx=>{await seedDiscovery(ctx);},
  registerJobHandlers(ctx,registry) { registry.register(discoveryKind,job=>scanDiscovery(ctx,job)); registry.register('zhihu.comments.sync',job=>syncCommentPage(ctx,job)); registry.register('zhihu.author.sync',job=>syncOAuthAuthor(ctx,job)); },
  async registerRoutes(app, ctx) {
    await registerOAuthRoutes(app, ctx);
    await registerDiscoveryRoutes(app, ctx);
    const r = app.withTypeProvider<ZodTypeProvider>();
    async function presentCandidates<T extends {url:string;title:string;text:string}>(items:T[]){return Promise.all(items.map(async item=>({...item,...engagementFields(item as {vote_up_count?:number|null;comment_count?:number|null;ranking_score?:number|null}),...await sourcePresentation(ctx.db,item.url,item.title+' '+item.text)})));}

    r.get('/integrations/zhihu/capabilities', { schema: { tags: ['zhihu'], response: { 200: envelopeSchema(z.object({ search: z.boolean(), creator_account_reads: z.boolean(), comment_sync_scope: z.literal('access_secret_owner_only'), oauth: z.boolean(), oauth_reason: z.string(), arbitrary_fulltext: z.literal(false), comments: z.literal('selected_search_comments') })) } } }, async request => success(request.id, {
      search: !!ctx.env.ZHIHU_ACCESS_SECRET, creator_account_reads: !!ctx.env.ZHIHU_ACCESS_SECRET, comment_sync_scope: 'access_secret_owner_only', oauth: oauthReady(ctx), oauth_reason: oauthReady(ctx) ? 'available' : ctx.env.ZHIHU_APP_ID && ctx.env.ZHIHU_APP_KEY ? 'callback_security_requires_verification' : 'app_credentials_missing', arbitrary_fulltext: false, comments: 'selected_search_comments',
    }));
    r.get('/discovery/search', { schema: { tags: ['zhihu'], querystring: z.object({ q: z.string().trim().min(1).max(300) }), response: { 200: envelopeSchema(z.object({ items: z.array(candidate) })) } } }, async request => success(request.id, { items: await presentCandidates(await storeCandidates(ctx,await officialSearch(ctx.env.ZHIHU_ACCESS_SECRET, request.query.q))) }));
    r.get('/discovery/candidates/:id',{schema:{tags:['zhihu'],params:z.object({id:z.string().uuid()}),response:{200:envelopeSchema(z.object({candidate}))}}},async (request,reply)=>{
      const [row]=await ctx.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id,request.params.id));
      if(!row)throw AppError.notFound();
      if(row.sourceId){const [source]=await ctx.db.select().from(sources).where(eq(sources.id,row.sourceId));if(!source||source.deletedAt||['rejected','revoked'].includes(source.permissionStatus))throw AppError.notFound();}
      // A signed-in reader also learns whether they already follow this candidate, so the detail
      // page offers 取消关注 instead of asking them to follow something they already follow. The
      // route stays public: without a session the answer is simply `interested: false`.
      const token=request.headers.authorization?parseBearerToken(request.headers.authorization):cookieToken(request,ctx.env);
      const session=token?await resolveSession(ctx.db,token):null;
      const [interest]=session&&row.sourceId?await ctx.db.select().from(interests).where(and(eq(interests.sourceId,row.sourceId),eq(interests.readerKey,session.user.id))):[];
      if(session)reply.header('cache-control','no-store');
      return success(request.id,{candidate:{...(await presentCandidates([{...row.data,candidate_id:row.id}]))[0]!,linked_source_id:row.sourceId??null,interested:interest?.active??false}});
    });
    r.get('/discovery/feed',{preHandler:[app.authenticate],schema:{tags:['zhihu'],response:{200:envelopeSchema(z.object({items:z.array(candidate)}))}}},async request=>success(request.id,{items:await presentCandidates(await candidateFeed(ctx,requireAuthContext(request)))}));
    r.get('/discovery/following',{preHandler:[app.authenticate],schema:{tags:['zhihu'],response:{200:envelopeSchema(z.object({items:z.array(candidate)}))}}},async request=>success(request.id,{items:await presentCandidates(await candidateFeed(ctx,requireAuthContext(request),true))}));
    r.put('/discovery/candidates/:id/interest',{preHandler:[app.authenticate],schema:{tags:['zhihu'],params:z.object({id:z.string().uuid()}),body:z.object({active:z.boolean()}).strict(),response:{200:envelopeSchema(z.record(z.unknown()))}}},async request=>success(request.id,await followCandidate(ctx,requireAuthContext(request),request.params.id,request.body.active)));
    r.post('/sources/resolve', { preHandler: [app.authenticate], schema: { tags: ['zhihu'], body: z.object({ url: z.string().min(1).max(4000) }).strict(), response: { 200: envelopeSchema(z.object({ source_id: z.string().uuid(), status: z.enum(['summary_available', 'pending_content']), candidate: candidate.nullable() })) } } }, async request => {
      const auth = requireAuthContext(request);
      const url = parseZhihuShare(request.body.url);
      const items = await officialSearch(ctx.env.ZHIHU_ACCESS_SECRET, url);
      const exact = items.find(x => x.url === url);
      const match=exact?(await storeCandidates(ctx,[exact]))[0]:undefined;
      const imported = await importSource(ctx, auth, resolveImportInput(url, match));
      return success(request.id, { source_id: imported.source.id, status: match ? 'summary_available' : 'pending_content', candidate: match ? (await presentCandidates([match]))[0] ?? null : null });
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
