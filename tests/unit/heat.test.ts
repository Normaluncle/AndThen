import { describe, expect, it } from 'vitest';
import { authorizedReadWeight, storyHeat, visitWeight } from '../../src/modules/community/heat.js';

describe('story heat', () => {
  it('rewards unique clicks, dwell, recency and repeat visits', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const fresh = visitWeight({ dwellMs: 0, returning: false, ageDays: 0 });
    const longStay = visitWeight({ dwellMs: 120000, returning: false, ageDays: 0 });
    const stale = visitWeight({ dwellMs: 0, returning: false, ageDays: 14 });
    const repeat = visitWeight({ dwellMs: 0, returning: true, ageDays: 0 });
    expect(longStay).toBeGreaterThan(fresh);
    expect(stale).toBeCloseTo(fresh / 2, 5);
    expect(repeat).toBe(fresh + 3);
    expect(authorizedReadWeight(0)).toBe(6);
    const score = storyHeat({
      now,
      visits: [
        { visitorKey: 'a', dwellMs: 60000, createdAt: now },
        { visitorKey: 'a', dwellMs: 10000, createdAt: now },
        { visitorKey: 'b', dwellMs: 0, createdAt: new Date('2026-08-31T00:00:00Z') },
      ],
      authorizedReads: [{ createdAt: now }],
    });
    expect(score).toBeGreaterThan(10);
  });
});
