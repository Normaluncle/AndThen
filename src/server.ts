import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { createDatabase, createPool } from './db/client.js';
import { createLogger } from './shared/logger.js';

async function main(): Promise<void> {
  const env = getEnv();
  const logger = createLogger(env);

  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    applicationName: 'andthen-api',
  });
  const db = createDatabase(pool);

  const { app } = await buildApp({ env, db, logger });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down api');
    try {
      await app.close();
    } finally {
      await pool.end();
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, 'api listening');
}

main().catch((err: unknown) => {
  console.error('[server] failed to start:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
