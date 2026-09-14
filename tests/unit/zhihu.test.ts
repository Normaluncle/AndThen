import { describe, it, expect } from 'vitest';
import { canonicalZhihuUrl, officialSearch } from '../../src/modules/zhihu/client.js';

describe('official Zhihu adapter', () => {
  it('canonicalizes answer links without converting large IDs to numbers', () => {
    expect(canonicalZhihuUrl('https://www.zhihu.com/question/42/answer/2079528466408654123?utm_source=x'))
      .toBe('https://www.zhihu.com/answer/2079528466408654123');
  });
  it.each(['https://evil.test/answer/1', 'https://www.zhihu.com.evil.test/answer/1', 'https://a@www.zhihu.com/answer/1', 'file:///answer/1'])('rejects unsupported destination %s', url => {
    expect(() => canonicalZhihuUrl(url)).toThrow();
  });
  it('preserves summary and selected-comment semantics and does not invent author identity', async () => {
    const transport = (async () => new Response(JSON.stringify({ Code: 0, Data: { Items: [{ Title: 'fixture', Url: 'https://zhuanlan.zhihu.com/p/123', ContentText: '摘要', AuthorName: '同名用户', EditTime: 1779678078, CommentInfoList: [{ Content: '部分评论' }] }] } }))) as typeof fetch;
    const [item] = await officialSearch('test-key', 'query', transport);
    expect(item?.upstream_updated_at).toBe(new Date(1779678078000).toISOString());
    expect(item).not.toHaveProperty('published_at');
    expect(item).toMatchObject({ material_level: 'api_summary', author_url: null, comments_coverage: 'selected', comments: ['部分评论'] });
  });
  it('carries the official engagement counts instead of dropping them', async () => {
    const transport = (async () => new Response(JSON.stringify({ Code: 0, Data: { Items: [{ Title: 'fixture', Url: 'https://zhuanlan.zhihu.com/p/123', ContentText: '摘要', AuthorName: '同名用户', EditTime: 1779678078, VoteUpCount: 18, CommentCount: 3, RankingScore: 1.3879999, CommentInfoList: [] }] } }))) as typeof fetch;
    const [item] = await officialSearch('test-key', 'query', transport);
    expect(item).toMatchObject({ vote_up_count: 18, comment_count: 3, ranking_score: 1.3879999 });
  });
  it('reports absent or unusable engagement counts as null rather than inventing them', async () => {
    const transport = (async () => new Response(JSON.stringify({ Code: 0, Data: { Items: [{ Title: 'fixture', Url: 'https://zhuanlan.zhihu.com/p/9', ContentText: '摘要', VoteUpCount: -1, CommentInfoList: [] }] } }))) as typeof fetch;
    const [item] = await officialSearch('test-key', 'query', transport);
    expect(item).toMatchObject({ vote_up_count: null, comment_count: null, ranking_score: null });
  });
});
