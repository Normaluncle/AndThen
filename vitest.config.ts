import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Integration tests share one Postgres instance; run files serially.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    reporters: ['default'],
  },
});
