import { sql } from 'drizzle-orm';
import { loadEnv, resolveMigrationsDir, type Env } from '../../src/config/env.js';
import { createDatabase, createPool, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

/**
 * Integration test isolation.
 *
 * Each test FILE gets its own freshly created database (`<prefix>_<name>`),
 * migrated from empty and dropped on teardown. Nothing is shared, so parallel
 * agents or parallel test files can never truncate each other's data — the
 * previous shared-TRUNCATE approach could wipe another suite mid-run.
 *
 * Connection resolution, in order:
 *   1. `TEST_DATABASE_URL`  (preferred; the compose test DB on 127.0.0.1:55432)
 *   2. `DATABASE_URL`       (local dev fallback)
 *   3. the compose default
 *
 * These are TEST-ONLY entry points. The helper refuses to run with
 * `NODE_ENV=production`, and it only ever creates/drops databases whose name
 * starts with the test prefix, so a real database is never touched.
 */

/** Prefix for per-file databases. Override to namespace parallel agent runs. */
export const TEST_DB_PREFIX = (process.env.TEST_DB_PREFIX ?? 'andthen_test')
  .toLowerCase()
  .replace(/[^a-z0-9_]/g, '_');

const DB_NAME_PATTERN = /^[a-z0-9_]+$/;

export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://andthen:andthen@127.0.0.1:55432/andthen'
  );
}

/** Alias kept for readability at call sites that treat this as the base DB. */
export const baseTestDatabaseUrl = testDatabaseUrl;

export function makeTestEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl(),
    ...overrides,
  });
}

function assertTestOnly(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to create an isolated test database with NODE_ENV=production');
  }
  if (TEST_DB_PREFIX.length < 4 || !DB_NAME_PATTERN.test(TEST_DB_PREFIX)) {
    throw new Error(`TEST_DB_PREFIX must be at least 4 chars of [a-z0-9_], got "${TEST_DB_PREFIX}"`);
  }
}

/** Deterministic, filesystem-safe database name for a test file's namespace. */
export function isolatedDatabaseName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) throw new Error('createTestContext(name) requires a non-empty name');
  const databaseName = `${TEST_DB_PREFIX}_${slug}`;
  if (!DB_NAME_PATTERN.test(databaseName)) {
    throw new Error(`Unsafe test database name "${databaseName}"`);
  }
  return databaseName;
}

export interface TestContext {
  db: Database;
  pool: ReturnType<typeof createPool>;
  env: Env;
  url: string;
  /** The isolated database backing this test file. */
  databaseName: string;
  /** Closes the pool and drops the isolated database. Idempotent. */
  close: () => Promise<void>;
}

async function withAdminPool<T>(fn: (pool: ReturnType<typeof createPool>) => Promise<T>): Promise<T> {
  const pool = createPool({
    connectionString: testDatabaseUrl(),
    max: 1,
    applicationName: 'andthen-test-admin',
  });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Create (or recreate) an isolated database for one test file, migrate it, and
 * return a context bound to it.
 *
 * @param name unique namespace for this test file, e.g. `createTestContext('auth')`
 */
export async function createTestContext(name: string): Promise<TestContext> {
  assertTestOnly();

  const databaseName = isolatedDatabaseName(name);
  const url = withDatabaseName(testDatabaseUrl(), databaseName);

  await withAdminPool(async (pool) => {
    await pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await pool.query(`CREATE DATABASE "${databaseName}"`);
  });

  const env = makeTestEnv({ DATABASE_URL: url });
  const pool = createPool({
    connectionString: url,
    max: 5,
    applicationName: `andthen-test-${databaseName}`,
  });
  const db = createDatabase(pool);
  await runMigrations(db, resolveMigrationsDir(env));

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await pool.end();
    try {
      await withAdminPool(async (adminPool) => {
        await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      });
    } catch {
      // A leftover test database is harmless; never fail the suite over cleanup.
    }
  };

  return { db, pool, env, url, databaseName, close };
}

/** Remove all rows in this file's database (useful between tests in one file). */
export async function truncateAll(db: Database): Promise<void> {
  const result = await db.execute(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = (result.rows as Array<{ tablename: string }>).map((r) => r.tablename);
  if (names.length === 0) return;
  const list = names.map((n) => `"${n}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

/** Replace the database name in a Postgres URL (for create/drop database tests). */
export function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}
