import { z } from 'zod';
import type { OfficialCandidate } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { officialGet } from './transport.js';

/** URL identity comes from the URL, never a numeric API field (IDs exceed JS precision). */
export function canonicalZhihuUrl(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || url.port || !['https:', 'http:'].includes(url.protocol)) throw AppError.validation('Invalid Zhihu URL');
  if (url.hostname === 'www.zhihu.com' || url.hostname === 'zhihu.com') {
    const match = /^\/(?:question\/\d+\/)?answer\/(\d+)\/?$/.exec(url.pathname);
    if (match) return `https://www.zhihu.com/answer/${match[1]}`;
  }
  if (url.hostname === 'zhuanlan.zhihu.com') {
    const match = /^\/p\/(\d+)\/?$/.exec(url.pathname);
    if (match) return `https://zhuanlan.zhihu.com/p/${match[1]}`;
  }
  throw AppError.validation('Only Zhihu answer and article links are supported');
}

/** Accept normal sharing text or Markdown; do not fetch the pasted URL. */
export function parseZhihuShare(raw: string): string {
  const matches = raw.match(/https?:\/\/[^\s<>\[\]()"'，。；！]+/g) ?? [];
  const urls = new Set<string>();
  for (const match of matches) {
    try { urls.add(canonicalZhihuUrl(match)); } catch { /* Ignore non-content links. */ }
  }
  if (urls.size !== 1) throw AppError.validation(urls.size ? '请一次只粘贴一篇知乎回答或文章。' : '未找到有效的知乎回答或文章链接。');
  return [...urls][0]!;
}

// The official search response carries engagement numbers we used to drop on the
// floor (only 7 of its fields were declared). They are parsed leniently: a missing
// or malformed count becomes null rather than failing the whole item.
const count = z.number().int().min(0).max(100_000_000).nullish().catch(null);
const item = z.object({ Title: z.string(), Url: z.string(), ContentText: z.string(), AuthorName: z.string().default('知乎用户'),
  EditTime: z.number().int().positive().max(253402300799).nullish().catch(null), AuthorAvatar: z.string().default(''), CommentInfoList: z.array(z.object({ Content: z.string() })).default([]),
  VoteUpCount: count, CommentCount: count, RankingScore: z.number().nullish().catch(null) });

export async function officialSearch(secret: string | undefined, query: string, transport: typeof fetch = fetch): Promise<OfficialCandidate[]> {
  const parsed = await officialGet(secret, '/api/v1/content/zhihu_search', { Query: query, Count: '10' }, z.object({ Items: z.array(z.unknown()) }), transport);
  return parsed.Items.flatMap(rawItem => {
    const p = item.safeParse(rawItem);
    if (!p.success) return [];
    try {
      return [{ url: canonicalZhihuUrl(p.data.Url), title: p.data.Title, text: p.data.ContentText,
        author_name: p.data.AuthorName, author_avatar: /^https:\/\/[\w.-]+\.zhimg\.com\//.test(p.data.AuthorAvatar) ? p.data.AuthorAvatar : null,
        upstream_updated_at: p.data.EditTime ? new Date(p.data.EditTime * 1000).toISOString() : null,
        vote_up_count: p.data.VoteUpCount ?? null, comment_count: p.data.CommentCount ?? null, ranking_score: p.data.RankingScore ?? null,
        author_url: null, material_level: 'api_summary' as const, comments: p.data.CommentInfoList.map(x => x.Content), comments_coverage: 'selected' as const }];
    } catch { return []; }
  });
}
