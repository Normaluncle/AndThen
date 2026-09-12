import { defineConfig } from 'vitest/config';

/**
 * Integration tests require a real Postgres instance reachable via
 * TEST_DATABASE_URL / DATABASE_URL (default 127.0.0.1:55432).
 * Start one with: pnpm docker:testdb:up
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    reporters: ['default'],
  },
});
