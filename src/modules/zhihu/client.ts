import { z } from 'zod';
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

const item = z.object({ Title: z.string(), Url: z.string(), ContentText: z.string(), AuthorName: z.string().default('知乎用户'),
  AuthorAvatar: z.string().default(''), CommentInfoList: z.array(z.object({ Content: z.string() })).default([]) });

export async function officialSearch(secret: string | undefined, query: string, transport: typeof fetch = fetch) {
  const parsed = await officialGet(secret, '/api/v1/content/zhihu_search', { Query: query, Count: '10' }, z.object({ Items: z.array(z.unknown()) }), transport);
  return parsed.Items.flatMap(rawItem => {
    const p = item.safeParse(rawItem);
    if (!p.success) return [];
    try {
      return [{ url: canonicalZhihuUrl(p.data.Url), title: p.data.Title, text: p.data.ContentText,
        author_name: p.data.AuthorName, author_avatar: /^https:\/\/[\w.-]+\.zhimg\.com\//.test(p.data.AuthorAvatar) ? p.data.AuthorAvatar : null,
        author_url: null, material_level: 'api_summary' as const, comments: p.data.CommentInfoList.map(x => x.Content), comments_coverage: 'selected' as const }];
    } catch { return []; }
  });
}
