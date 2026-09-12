import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { schema } from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

/** A Drizzle transaction handle, interchangeable with `Database` for queries. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Anything that can run queries: the pool-backed db or an open transaction. */
export type Executor = Database | Transaction;

export interface PoolOptions {
  connectionString: string;
  max?: number;
  applicationName?: string;
  /** Statement/idle timeouts in ms; undefined keeps pg defaults. */
  statementTimeoutMs?: number;
}

export function createPool(options: PoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'andthen',
    ...(options.statementTimeoutMs !== undefined
      ? { statement_timeout: options.statementTimeoutMs }
      : {}),
  });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

/** Convenience for scripts/tests that want pool + db + teardown together. */
export async function connect(options: PoolOptions): Promise<{
  pool: pg.Pool;
  db: Database;
  close: () => Promise<void>;
}> {
  const pool = createPool(options);
  const db = createDatabase(pool);
  return { pool, db, close: async () => pool.end() };
}

export { pg };
