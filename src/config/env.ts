import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Unit/integration suites must never inherit real provider credentials.
if (process.env.NODE_ENV !== 'test') loadDotenv({ path: ['.env.local', '.env'], quiet: true });

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
  ZHIHU_ACCESS_SECRET: z.string().optional(),
  ZHIHU_APP_ID: z.string().optional(),
  ZHIHU_APP_KEY: z.string().optional(),
  MEMORY_SERVICE_URL: z.string().url().optional(),
  MEMORY_SERVICE_TOKEN: z.string().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  LLM_MAX_INPUT_BYTES: z.coerce.number().int().min(1024).max(1000000).default(131072),
  LLM_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).max(1000000).default(131072),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(16384).default(4096),
  LLM_MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(16).default(2),
  LLM_DAILY_JOB_LIMIT: z.coerce.number().int().min(0).max(100000).default(1000),

  WORKER_ID: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  WORKER_HEALTH_MAX_AGE_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
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

/**
 * How the LLM credential should be interpreted.
 *
 * - `unconfigured`          no base URL or model. AI stays disabled; the manual
 *                           (human) path is unaffected and nothing is fabricated.
 * - `key_present`           remote provider with a key.
 * - `anonymous_local`       loopback/private provider that legitimately needs no
 *                           key (ollama, llama.cpp, vLLM on the same host).
 * - `key_missing_for_remote` a non-local base URL with no key: almost certainly a
 *                           misconfiguration, so it is logged loudly at boot
 *                           rather than failing silently at first call.
 */
export type LlmKeyPolicy =
  | 'unconfigured'
  | 'key_present'
  | 'anonymous_local'
  | 'key_missing_for_remote';

const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'host.docker.internal',
  'gateway.docker.internal',
]);

/** True for loopback, RFC1918, link-local, `.local`/`.internal` and bare hosts. */
export function isLocalLlmHost(rawUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (LOCAL_HOSTNAMES.has(hostname)) return true;
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
  // A single-label host (no dot) is an in-cluster/service name.
  if (!hostname.includes('.')) return true;

  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function llmKeyPolicy(env: Env): LlmKeyPolicy {
  if (!env.LLM_BASE_URL || !env.LLM_MODEL) return 'unconfigured';
  if (env.LLM_API_KEY) return 'key_present';
  return isLocalLlmHost(env.LLM_BASE_URL) ? 'anonymous_local' : 'key_missing_for_remote';
}

/**
 * True when an OpenAI-compatible provider is usable.
 *
 * A key is NOT required: anonymous local providers (ollama/llama.cpp/vLLM) are
 * supported, which is why this only checks the base URL and model. With nothing
 * configured it returns false and AI handlers must stay disabled — the manual
 * path keeps working and no output is invented.
 */
export function isLlmConfigured(env: Env): boolean {
  return llmKeyPolicy(env) !== 'unconfigured';
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
