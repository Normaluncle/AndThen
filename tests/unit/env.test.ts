import { describe, expect, it } from 'vitest';
import { isLlmConfigured, loadEnv } from '../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
} satisfies NodeJS.ProcessEnv;

describe('environment schema', () => {
  it('requires DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('applies safe defaults', () => {
    const env = loadEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8080);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.SESSION_TTL_SECONDS).toBe(2592000);
    expect(env.JOB_LEASE_SECONDS).toBe(60);
  });

  it('coerces numeric strings and rejects out-of-range values', () => {
    const env = loadEnv({ ...base, PORT: '9000', DB_POOL_MAX: '3' });
    expect(env.PORT).toBe(9000);
    expect(env.DB_POOL_MAX).toBe(3);
    expect(() => loadEnv({ ...base, PORT: '70000' })).toThrow();
    expect(() => loadEnv({ ...base, NODE_ENV: 'staging' })).toThrow();
  });

  it('reports whether the LLM provider is configured', () => {
    const off = loadEnv({ ...base });
    expect(isLlmConfigured(off)).toBe(false);
    const on = loadEnv({
      ...base,
      LLM_BASE_URL: 'https://example.invalid/v1',
      LLM_MODEL: 'some-model',
    });
    expect(isLlmConfigured(on)).toBe(true);
  });
});
