import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleDefinition } from '../../shared/types.js';
import { success, AppError } from '../../http/errors.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema } from '../../http/envelope.js';
import { canonicalZhihuUrl, officialSearch } from './client.js';
import { importSource } from '../sources/service.js';

const candidate = z.object({ url: z.string(), title: z.string(), text: z.string(), author_name: z.string(), author_avatar: z.string().nullable(), author_url: z.null(), material_level: z.literal('api_summary'), comments: z.array(z.string()), comments_coverage: z.literal('selected') });
export const zhihuModule: ModuleDefinition = {
  name: 'zhihu',
  async registerRoutes(app, ctx) {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.get('/integrations/zhihu/capabilities', { schema: { tags: ['zhihu'], response: { 200: envelopeSchema(z.object({ search: z.boolean(), oauth: z.literal(false), oauth_reason: z.string(), arbitrary_fulltext: z.literal(false), comments: z.literal('selected_search_comments') })) } } }, async request => success(request.id, {
      search: !!ctx.env.ZHIHU_ACCESS_SECRET, oauth: false, oauth_reason: ctx.env.ZHIHU_APP_ID && ctx.env.ZHIHU_APP_KEY ? 'callback_security_requires_verification' : 'app_credentials_missing', arbitrary_fulltext: false, comments: 'selected_search_comments',
    }));
    r.get('/discovery/search', { preHandler: [app.authenticate], schema: { tags: ['zhihu'], querystring: z.object({ q: z.string().trim().min(1).max(300) }), response: { 200: envelopeSchema(z.object({ items: z.array(candidate) })) } } }, async request => success(request.id, { items: await officialSearch(ctx.env.ZHIHU_ACCESS_SECRET, request.query.q) }));
    r.post('/sources/resolve', { preHandler: [app.authenticate], schema: { tags: ['zhihu'], body: z.object({ url: z.string().url().max(1000) }).strict(), response: { 200: envelopeSchema(z.object({ source_id: z.string().uuid(), status: z.enum(['summary_available', 'pending_content']), candidate: candidate.nullable() })) } } }, async request => {
      const auth = requireAuthContext(request);
      const url = canonicalZhihuUrl(request.body.url);
      const items = await officialSearch(ctx.env.ZHIHU_ACCESS_SECRET, url);
      const match = items.find(x => x.url === url);
      const imported = await importSource(ctx, auth, { sourceType: 'third_party_link', originalUrl: url, originalAccountRef: null,
        title: match?.title ?? null, materialLevel: 'api_summary', body: match?.text ?? null, excerpt: null, excerptLocation: null,
        publishedAt: null, upstreamUpdatedAt: null, notes: 'Official exact URL resolution; ownership not established', provenance: 'official_api' });
      return success(request.id, { source_id: imported.source.id, status: match ? 'summary_available' : 'pending_content', candidate: match ?? null });
    });
    r.get('/auth/zhihu/start', { schema: { tags: ['zhihu'] } }, async () => { throw AppError.serviceUnavailable('Zhihu OAuth awaits application credentials and callback security verification'); });
  },
};
