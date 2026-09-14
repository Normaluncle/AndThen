import { describe, expect, it } from 'vitest';
import { engagementFields, upstreamHeat } from '../../src/modules/zhihu/heat.js';

describe('upstream heat', () => {
  it('combines the official counts, weighting a comment above a like', () => {
    expect(upstreamHeat({ vote_up_count: 18, comment_count: 3 })).toBe(24);
    expect(upstreamHeat({ vote_up_count: 18, comment_count: 0 })).toBe(18);
    expect(upstreamHeat({ vote_up_count: 0, comment_count: 3 })).toBe(6);
    expect(upstreamHeat({ vote_up_count: 0, comment_count: 0 })).toBe(0);
  });

  it('returns null when the provider returned no counts, never a fabricated zero', () => {
    expect(upstreamHeat({})).toBeNull();
    expect(upstreamHeat({ vote_up_count: null, comment_count: null })).toBeNull();
    expect(upstreamHeat({ vote_up_count: undefined, comment_count: undefined })).toBeNull();
  });

  it('ignores unusable values instead of trusting them', () => {
    expect(upstreamHeat({ vote_up_count: -5, comment_count: 2 })).toBe(4);
    expect(upstreamHeat({ vote_up_count: Number.NaN, comment_count: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('exposes the raw counts alongside the heat, and keeps ranking separate', () => {
    const fields = engagementFields({ vote_up_count: 18, comment_count: 3, ranking_score: 1.39 });
    expect(fields).toEqual({ vote_up_count: 18, comment_count: 3, ranking_score: 1.39, heat: 24 });
    // RankingScore is the official result ordering, not popularity.
    expect(engagementFields({ ranking_score: 9.9 }).heat).toBeNull();
    expect(engagementFields({}).heat).toBeNull();
  });
});
