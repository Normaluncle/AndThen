import { destination, pino, type DestinationStream, type LoggerOptions } from 'pino';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env.js';

/**
 * The project's canonical logger type. Fastify's plugin encapsulation types its
 * child instances with `FastifyBaseLogger`, so we standardise on that everywhere
 * rather than fighting the generic in every helper signature.
 */
export type Logger = FastifyBaseLogger;

/**
 * Redaction paths. Nothing that can authenticate a request may reach a log
 * sink: bearer tokens, login tokens, cookies, provider keys, token hashes.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'headers.authorization',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'loginToken',
  'login_token',
  'sessionToken',
  'session_token',
  'tokenHash',
  'token_hash',
  'password',
  'secret',
  'receipt_secret',
  '*.receipt_secret',
  'req.body.receipt_secret',
  'request.body.receipt_secret',
  'apiKey',
  'api_key',
  'llmApiKey',
  'LLM_API_KEY',
  '*.token',
  '*.tokenHash',
  '*.password',
  '*.apiKey',
];

export function buildLoggerOptions(env: Env): LoggerOptions {
  const base: LoggerOptions = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'andthen', env: env.NODE_ENV },
    serializers: { req: (req: { method?: string; url?: string; hostname?: string }) => ({
      method: req.method, url: req.url?.split('?')[0], hostname: req.hostname,
    }) },
  };

  if (env.NODE_ENV === 'development' && env.LOG_PRETTY) {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
    };
  }
  return base;
}

export function createLogger(
  env: Env,
  overrides: Partial<LoggerOptions> = {},
  stream?: DestinationStream,
): Logger {
  const options = { ...buildLoggerOptions(env), ...overrides };
  if (stream) {
    // A transport and an explicit destination are mutually exclusive.
    delete options.transport;
    return pino(options, stream) as unknown as Logger;
  }
  return pino(options) as unknown as Logger;
}

/**
 * CLI helper. Structured logs go to stderr so stdout carries only the command's
 * actual output (e.g. `bootstrap:admin --json`), keeping it machine-readable and
 * keeping credentials out of any captured stdout stream.
 */
export function createCliLogger(env: Env, overrides: Partial<LoggerOptions> = {}): Logger {
  return createLogger(env, overrides, destination(2));
}
