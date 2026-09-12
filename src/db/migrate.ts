/**
 * Single migration command: `pnpm db:migrate`
 *
 * Applies every pending SQL migration in src/db/migrations, tracked by
 * drizzle-orm's `__drizzle_migrations` journal table. Safe to run repeatedly
 * and safe to run concurrently with an advisory lock (drizzle's migrator
 * already wraps each migration in a transaction).
 */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getEnv, resolveMigrationsDir } from '../config/env.js';
import { createDatabase, createPool, type Database } from './client.js';
import { createCliLogger } from '../shared/logger.js';

export interface MigrationResult {
  migrationsFolder: string;
  appliedAt: Date;
}

export async function runMigrations(db: Database, migrationsFolder: string): Promise<MigrationResult> {
  await migrate(db, { migrationsFolder });
  return { migrationsFolder, appliedAt: new Date() };
}

async function main(): Promise<void> {
  const env = getEnv();
  const logger = createCliLogger(env, { base: { service: 'andthen-migrate', env: env.NODE_ENV } });
  const migrationsFolder = resolveMigrationsDir(env);

  logger.info({ migrationsFolder }, 'applying database migrations');
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: 1,
    applicationName: 'andthen-migrate',
  });
  const db = createDatabase(pool);
  try {
    const result = await runMigrations(db, migrationsFolder);
    logger.info({ migrationsFolder: result.migrationsFolder }, 'database migrations complete');
  } finally {
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main().catch((err: unknown) => {
    // Deliberately not using the structured logger here: if env parsing failed
    // the logger may not exist, and a migration failure must be loud.
    console.error('[db:migrate] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
