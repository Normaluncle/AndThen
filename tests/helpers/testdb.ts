import { sql } from 'drizzle-orm';
import { loadEnv, resolveMigrationsDir, type Env } from '../../src/config/env.js';
import { createDatabase, createPool, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

/** Integration target: the compose test DB on 127.0.0.1 by default. */
export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://andthen:andthen@127.0.0.1:55432/andthen'
  );
}

export function makeTestEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl(),
    ...overrides,
  });
}

export interface TestContext {
  db: Database;
  pool: ReturnType<typeof createPool>;
  env: Env;
  url: string;
  close: () => Promise<void>;
}

/** Connect to the test database and bring the schema up to date. */
export async function createTestContext(): Promise<TestContext> {
  const url = testDatabaseUrl();
  const env = makeTestEnv();
  const pool = createPool({ connectionString: url, max: 5, applicationName: 'andthen-test' });
  const db = createDatabase(pool);
  await runMigrations(db, resolveMigrationsDir(env));
  return { db, pool, env, url, close: async () => pool.end() };
}

/** Remove all rows so each test starts from a known state. */
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
