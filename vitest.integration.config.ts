import { defineConfig } from 'vitest/config';

/**
 * Database-backed tests. They need a real Postgres reachable via
 * TEST_DATABASE_URL / DATABASE_URL (default 127.0.0.1:55432).
 * Start one with: pnpm docker:testdb:up
 *
 * Each test file creates its own isolated database, so this suite is safe to
 * run alongside another agent's run as long as TEST_DB_PREFIX differs.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/integration/**/*.test.ts',
      'tests/business/**/*.test.ts',
      'tests/ai/**/*.test.ts',
      'tests/publishing/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    reporters: ['default'],
  },
});
