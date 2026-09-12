import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LOG_PRETTY: booleanish.default('false'),

  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:8080'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),

  WORKER_ID: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(1000),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),

  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).default(60 * 60 * 24 * 30),
  LOGIN_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),

  MIGRATIONS_DIR: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parse and validate process.env. Throws with a readable list of problems so a
 * misconfigured deployment fails at boot instead of at first request.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

/** True when the OpenAI-compatible provider is fully configured. */
export function isLlmConfigured(env: Env): boolean {
  return Boolean(env.LLM_BASE_URL && env.LLM_MODEL);
}

/**
 * Locate the Drizzle migrations folder across dev (src), built (dist) and
 * container layouts. Overridable with MIGRATIONS_DIR.
 */
export function resolveMigrationsDir(env: Env = getEnv()): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), 'src/db/migrations'),
    path.resolve(process.cwd(), 'dist/db/migrations'),
    path.resolve(here, '..', 'db', 'migrations'),
    path.resolve(here, '..', '..', 'src', 'db', 'migrations'),
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
  }
  throw new Error(
    `Could not locate Drizzle migrations (looked in: ${candidates.join(', ')}). ` +
      'Set MIGRATIONS_DIR explicitly.',
  );
}
