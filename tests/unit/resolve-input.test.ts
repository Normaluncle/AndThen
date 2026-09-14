import { describe, expect, it } from 'vitest';
import { resolveImportInput } from '../../src/modules/zhihu/resolve-input.js';
import type { OfficialCandidate } from '../../src/db/schema.js';

function candidate(overrides: Partial<OfficialCandidate> = {}): OfficialCandidate {
  return {
    url: 'https://www.zhihu.com/answer/987654321',
    title: '辞职去做自己真正喜欢的事情，值得吗？',
    text: '官方摘要：我在大厂工作五年后辞职。',
    author_name: '林下的风',
    author_avatar: null,
    upstream_updated_at: '2026-05-25T06:21:18.000Z',
    author_url: null,
    material_level: 'api_summary',
    comments: [],
    comments_coverage: 'selected',
    ...overrides,
  };
}

describe('resolveImportInput keeps official time honest', () => {
  it('stores the official edit time as upstream_updated_at and never as published_at', () => {
    const input = resolveImportInput('https://www.zhihu.com/answer/987654321', candidate());
    expect(input.upstreamUpdatedAt?.toISOString()).toBe('2026-05-25T06:21:18.000Z');
    expect(input.publishedAt).toBeNull();
    expect(input.sourceType).toBe('third_party_link');
    expect(input.provenance).toBe('official_api');
  });

  it('leaves both timestamps null when the official payload has no edit time', () => {
    const input = resolveImportInput('https://www.zhihu.com/answer/1', candidate({ upstream_updated_at: null }));
    expect(input.upstreamUpdatedAt).toBeNull();
    expect(input.publishedAt).toBeNull();
  });

  it('registers the link without content when the official search found no exact match', () => {
    const input = resolveImportInput('https://www.zhihu.com/answer/1', undefined);
    expect(input.title).toBeNull();
    expect(input.body).toBeNull();
    expect(input.upstreamUpdatedAt).toBeNull();
    expect(input.publishedAt).toBeNull();
  });
});
