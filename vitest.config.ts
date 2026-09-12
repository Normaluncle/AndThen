import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Every test directory a module may add is listed explicitly, so a new
    // suite cannot be silently skipped by `pnpm test`.
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/business/**/*.test.ts',
      'tests/ai/**/*.test.ts',
      'tests/publishing/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each test file owns a freshly created database, but the files still share
    // one Postgres instance; run them serially to keep DDL contention out of the
    // results. Parallel *agents* are isolated by TEST_DB_PREFIX instead.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    reporters: ['default'],
  },
});
