import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createDatabase, createPool } from '../src/db/client.js';

// Construct the actual route registry without listening or starting a worker.
const env = loadEnv({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://andthen:andthen@127.0.0.1:55432/andthen', LOG_LEVEL: 'silent' });
const pool = createPool({ connectionString: env.DATABASE_URL });
const { app } = await buildApp({ env, db: createDatabase(pool) });
try {
  const response = await app.inject({ method: 'GET', url: '/openapi.json' });
  if (response.statusCode !== 200) throw new Error('OpenAPI generation failed');
  const document = response.json();
  if (!document.paths?.['/api/me/notifications'] || !document.paths?.['/api/admin/research-export']) throw new Error('Core routes missing');
  const target = resolve('docs/openapi.json');
  await writeFile(target, JSON.stringify(document, null, 2) + '\n');
  console.log(`Exported ${Object.keys(document.paths).length} paths to ${target}`);
} finally {
  await app.close();
  await pool.end();
}
