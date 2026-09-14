import { describe, expect, it } from 'vitest';
import { playgroundResetAllowed, DEMO_ACCOUNTS, FIXTURE_STORIES } from '../../src/modules/identity/playground.js';

describe('playground reset gate', () => {
  it('allows guests and local demo fixtures and refuses everyone else', () => {
    expect(playgroundResetAllowed(undefined)).toBe(true);
    expect(playgroundResetAllowed(null)).toBe(true);
    expect(playgroundResetAllowed('local_demo_fixture')).toBe(true);
    expect(playgroundResetAllowed('anonymous_reader')).toBe(false);
    expect(playgroundResetAllowed('team')).toBe(false);
  });

  it('keeps demo identities and stories as labeled fixtures', () => {
    expect(DEMO_ACCOUNTS.map((item) => item.path)).toEqual(['reader', 'author', 'admin']);
    expect(FIXTURE_STORIES.every((item) => item.title.includes('【演示】'))).toBe(true);
  });
});
