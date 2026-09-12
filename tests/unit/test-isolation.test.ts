import { describe, expect, it } from 'vitest';
import {
  TEST_DB_PREFIX,
  createTestContext,
  isolatedDatabaseName,
} from '../helpers/testdb.js';

describe('test database isolation', () => {
  it('derives a safe, deterministic database name per test file', () => {
    expect(isolatedDatabaseName('auth')).toBe(`${TEST_DB_PREFIX}_auth`);
    expect(isolatedDatabaseName('Auth')).toBe(`${TEST_DB_PREFIX}_auth`);
    expect(isolatedDatabaseName('migrations fresh')).toBe(`${TEST_DB_PREFIX}_migrations_fresh`);
    expect(isolatedDatabaseName('jobs/queue')).toBe(`${TEST_DB_PREFIX}_jobs_queue`);
    expect(isolatedDatabaseName('a-b-c')).toBe(`${TEST_DB_PREFIX}_a_b_c`);
    expect(isolatedDatabaseName('  spaced  ')).toBe(`${TEST_DB_PREFIX}_spaced`);
  });

  it('never produces a name outside the test prefix', () => {
    for (const name of ['auth', 'sources', 'publishing', 'ai']) {
      expect(isolatedDatabaseName(name).startsWith(`${TEST_DB_PREFIX}_`)).toBe(true);
    }
  });

  it('rejects an empty namespace instead of creating an unprefixed database', () => {
    expect(() => isolatedDatabaseName('')).toThrow(/non-empty/);
    expect(() => isolatedDatabaseName('///')).toThrow(/non-empty/);
  });

  it('uses a prefix that is itself safe for DDL', () => {
    expect(TEST_DB_PREFIX).toMatch(/^[a-z0-9_]+$/);
    expect(TEST_DB_PREFIX.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses to create an isolated database when NODE_ENV is production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(createTestContext('guard')).rejects.toThrow(/production/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
