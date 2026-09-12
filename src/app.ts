import helmet from '@fastify/helmet';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Env } from './config/env.js';
import type { Database } from './db/client.js';
import { registerAuth } from './http/auth.js';
import { envelopeSchema } from './http/envelope.js';
import { AppError, clientErrorCodeForStatus, failure, isAppError, success } from './http/errors.js';
import { registerOpenApi } from './http/openapi.js';
import { generateRequestId, registerRequestId } from './http/request-id.js';
import { JobQueue } from './jobs/queue.js';
import { modules } from './modules/index.js';
import { createLogger, type Logger } from './shared/logger.js';
import type { AppInstance, ModuleContext } from './shared/types.js';

export interface BuildAppOptions {
  env: Env;
  db: Database;
  logger?: Logger;
  /** Injectable clock (tests). */
  now?: () => Date;
  /** Skip OpenAPI/docs registration (faster unit tests). */
  enableDocs?: boolean;
}

export interface BuiltApp {
  app: AppInstance;
  ctx: ModuleContext;
}

/**
 * Build the HTTP application. Route registration is fully driven by the module
 * registry — app.ts contains no business routes.
 *
 * Ordering note: `setErrorHandler` / `setNotFoundHandler` are installed BEFORE
 * any `app.register(...)` call. Encapsulated child contexts capture the parent's
 * error handler when they are created, so installing it later would leave
 * plugin routes using Fastify's default (non-enveloped) error output.
 */
export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const { env, db } = options;
  const logger = options.logger ?? createLogger(env);

  const app = Fastify({
    loggerInstance: logger,
    genReqId: generateRequestId,
    trustProxy: false,
    bodyLimit: 1024 * 1024,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  /* ---- Error handling (must precede plugin registration) ---- */

  app.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(failure(request.id, 'not_found', `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const requestId = request.id;

    if (error.validation) {
      logger.warn({ requestId, validation: error.validation }, 'request validation failed');
      reply.status(400).send(
        failure(requestId, 'validation_error', 'Request validation failed', {
          issues: error.validation.map((v) => ({
            path: v.instancePath || v.params?.missingProperty || '',
            message: v.message ?? 'invalid',
          })),
        }),
      );
      return;
    }

    if (isAppError(error)) {
      const level = error.status >= 500 ? 'error' : 'warn';
      logger[level]({ requestId, code: error.code, err: error.message }, 'request failed');
      reply.status(error.status).send(failure(requestId, error.code, error.message, error.details));
      return;
    }

    // Framework-raised client errors (unsupported media type, payload too
    // large, ...) must never be reported as a server failure.
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const code = clientErrorCodeForStatus(status);
      logger.warn({ requestId, status, code, err: error.message }, 'client error');
      reply.status(status).send(failure(requestId, code, error.message));
      return;
    }

    // Unknown error: log the detail server-side, return nothing revealing.
    logger.error({ requestId, err: error }, 'unhandled error');
    reply.status(500).send(failure(requestId, 'internal_error', 'Internal error'));
  });

  /* ---- Cross-cutting plugins ---- */

  await app.register(helmet, {
    // The docs UI needs inline scripts; everything else keeps default headers.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  if (options.enableDocs !== false) {
    await registerOpenApi(app);
  }

  registerRequestId(app);
  registerAuth(app, db);

  const ctx: ModuleContext = {
    db,
    env,
    logger,
    jobs: new JobQueue(db),
    now: options.now ?? (() => new Date()),
  };

  /* ---- System routes (health/readiness are infrastructure, not business) ---- */

  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/healthz',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness probe',
        response: {
          200: envelopeSchema(z.object({ status: z.literal('ok'), time: z.string() })),
        },
      },
    },
    async (request) =>
      success(request.id, { status: 'ok' as const, time: new Date().toISOString() }),
  );

  r.get(
    '/readyz',
    {
      schema: {
        tags: ['system'],
        summary: 'Readiness probe (checks the database)',
        response: {
          200: envelopeSchema(z.object({ status: z.literal('ready'), database: z.literal('ok') })),
          503: z.object({
            request_id: z.string(),
            status: z.literal('error'),
            error_code: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      try {
        await db.execute(sql`select 1`);
        return success(request.id, { status: 'ready' as const, database: 'ok' as const });
      } catch {
        return reply
          .status(503)
          .send(failure(request.id, 'service_unavailable', 'Database is not reachable'));
      }
    },
  );

  /* ---- Business modules ---- */

  await app.register(
    async (instance) => {
      for (const module of modules) {
        if (!module.registerRoutes) continue;
        await module.registerRoutes(instance, ctx);
      }
    },
    { prefix: '/api' },
  );

  return { app, ctx };
}

export { AppError, success };
