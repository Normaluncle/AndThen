import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import { canonicalZhihuUrl } from './client.js';
import { officialGet } from './transport.js';

export const offsetSchema = z.string().regex(/^\d{1,19}$/).refine(x => BigInt(x) <= 9223372036854775807n, 'Offset exceeds Int64');
const integerText = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().safe()]).transform(String);
const pagingSchema = z.object({ IsEnd: z.boolean(), NextOffset: integerText.optional() });
export function nextPage(paging: z.infer<typeof pagingSchema>, offset: string) {
  if (paging.IsEnd) return { is_end: true, next_offset: null, stopped_reason: null };
  const next = offsetSchema.safeParse(paging.NextOffset);
  if (!next.success || BigInt(next.data) <= BigInt(offset)) return { is_end: false, next_offset: null, stopped_reason: 'invalid_upstream_cursor' };
  return { is_end: false, next_offset: next.data, stopped_reason: null };
}

export async function ownContents(secret: string | undefined, offset = '0', transport: typeof fetch = fetch, oauthToken?: string) {
  offsetSchema.parse(offset);
  const result = await officialGet(secret, '/api/v1/user/contents', { ContentType: 'all', Limit: '20', Offset: offset, SortField: 'ts', SortOrder: 'desc' },
    z.object({ Items: z.array(z.object({ ContentType: z.string(), Url: z.string(), Title: z.string(), Summary: z.string(), CreatedAt: integerText })), Paging: pagingSchema }), transport, oauthToken);
  return { items: result.Items.flatMap(x => {
    try { return [{ url: canonicalZhihuUrl(x.Url), title: x.Title, text: x.Summary, created_at_seconds: x.CreatedAt, material_level: 'api_summary' as const }]; }
    catch { return []; } // Unsupported pins/videos are not silently converted into answer IDs.
  }), paging: nextPage(result.Paging, offset), identity_scope: oauthToken ? 'oauth_user' : 'access_secret_owner' };
}

/** Intentionally no OAuth argument: this endpoint cannot act as an OAuth user. */
export async function ownContent(secret: string | undefined, rawUrl: string, transport: typeof fetch = fetch) {
  const url = canonicalZhihuUrl(rawUrl);
  const data = await officialGet(secret, '/api/v1/user/content_detail', { ContentUrl: url },
    z.object({ ContentType: z.string(), ContentToken: z.string(), Url: z.string(), Title: z.string(), Body: z.string() }), transport);
  if (canonicalZhihuUrl(data.Url) !== url) throw AppError.serviceUnavailable('Official content URL mismatch');
  return { url, title: data.Title, body: data.Body, body_format: 'untrusted_html' as const, identity_scope: 'access_secret_owner' as const };
}

const commentSchema = z.object({ ID: integerText, Type: z.union([z.string(), z.number()]), Content: z.string(), CreatedAt: integerText,
  LikeCount: integerText, DislikeCount: integerText, AuthorToken: z.string().optional(), RootID: integerText.optional(), ReplyID: integerText.optional() });
function comment(data: z.infer<typeof commentSchema>) {
  const token = data.AuthorToken;
  return { id: data.ID, text: data.Content, created_at_seconds: data.CreatedAt, likes: data.LikeCount,
    author_url: token && /^[a-zA-Z0-9_-]{1,200}$/.test(token) ? `https://www.zhihu.com/people/${token}` : null,
    root_id: data.RootID ?? null, reply_id: data.ReplyID ?? null };
}
export async function ownComments(secret: string | undefined, rawUrl: string, offset = '0', transport: typeof fetch = fetch) {
  const url = canonicalZhihuUrl(rawUrl); offsetSchema.parse(offset);
  const data = await officialGet(secret, '/api/v1/user/content_comments', { ContentUrl: url, Offset: offset, Limit: '20', Order: 'ascending' },
    z.object({ Items: z.array(z.object({ Comment: commentSchema, Children: z.array(commentSchema).default([]) })), Paging: pagingSchema }), transport);
  return { url, items: data.Items.map(x => ({ ...comment(x.Comment), children: x.Children.map(comment) })), paging: nextPage(data.Paging, offset),
    coverage: 'paged_roots_with_partial_children' as const, identity_scope: 'access_secret_owner' as const };
}
