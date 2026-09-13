import { issueWebCookie, setSessionCookie } from '../../http/session-cookie.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { registerLocalDemoRoutes } from './local-demo.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { AppError, success } from '../../http/errors.js';
import type { AppInstance, ModuleContext } from '../../shared/types.js';
import {
  createManagedUser,
  createReaderSession,
  exchangeLoginToken,
  findUserById,
  revokeSession,
} from './service.js';

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['reader', 'author', 'researcher', 'admin']),
  cohort: z.string(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
});

const issuedSessionSchema = z.object({
  session_token: z.string(),
  token_prefix: z.string(),
  expires_at: z.string(),
  user: publicUserSchema,
});

const meSchema = z.object({
  user: publicUserSchema,
  session: z.object({
    id: z.string().uuid(),
    cohort: z.string(),
    expires_at: z.string(),
  }),
});

function serializeUser(user: {
  id: string;
  role: 'reader' | 'author' | 'researcher' | 'admin';
  cohort: string;
  displayName: string | null;
  email: string | null;
}) {
  return {
    id: user.id,
    role: user.role,
    cohort: user.cohort,
    display_name: user.displayName,
    email: user.email,
  };
}

/**
 * Identity routes.
 *
 *   POST /api/auth/sessions  exchange a one-time login token for a session
 *   POST /api/auth/readers   establish an anonymous reader session (consent required)
 *   GET  /api/auth/me        current identity (compatibility alias of GET /api/me)
 *   GET  /api/me             current identity (PRD §16 naming)
 *   POST /api/auth/logout    revoke the current session
 *   POST /api/admin/users    admin-only: create an author/researcher + credential
 *
 * Role and cohort are always resolved server-side. `POST /api/auth/readers`
 * assigns `reader` / `anonymous_reader` and accepts no role input; the exchange
 * and admin bodies are `.strict()`, so an unexpected `role` is a 400 rather than
 * something silently trusted.
 */
export async function registerIdentityRoutes(app: AppInstance, ctx: ModuleContext): Promise<void> {
  await registerLocalDemoRoutes(app, ctx);
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/auth/sessions',
    {
      schema: {
        tags: ['identity'],
        summary: 'Exchange a single-use login token for a session',
        body: z.object({ login_token: z.string().min(16).max(512) }).strict(),
        response: {
          200: envelopeSchema(issuedSessionSchema),
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const { login_token } = request.body;
      const { user, session } = await exchangeLoginToken(ctx.db, login_token, {
        ttlSeconds: ctx.env.SESSION_TTL_SECONDS,
        userAgent: request.headers['user-agent'] ?? null,
      });
      ctx.logger.info({ userId: user.id, sessionId: session.id }, 'session established');
      issueWebCookie(request, reply, ctx.env, session.token);
      return success(request.id, {
        session_token: session.token,
        token_prefix: session.tokenPrefix,
        expires_at: session.expiresAt.toISOString(),
        user: serializeUser(user),
      });
    },
  );

  r.post(
    '/auth/readers',
    {
      schema: {
        tags: ['identity'],
        summary: 'Establish an anonymous reader session after explicit consent',
        body: z
          .object({
            consent: z
              .object({
                accepted: z.literal(true),
                version: z.string().min(1).max(64),
              })
              .strict(),
          })
          .strict(),
        response: { 200: envelopeSchema(issuedSessionSchema), 400: errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const { user, session } = await createReaderSession(ctx.db, {
        consentVersion: request.body.consent.version,
        ttlSeconds: ctx.env.SESSION_TTL_SECONDS,
        userAgent: request.headers['user-agent'] ?? null,
      });
      ctx.logger.info(
        { userId: user.id, sessionId: session.id, cohort: user.cohort },
        'anonymous reader session established',
      );
      issueWebCookie(request, reply, ctx.env, session.token);
      return success(request.id, {
        session_token: session.token,
        token_prefix: session.tokenPrefix,
        expires_at: session.expiresAt.toISOString(),
        user: serializeUser(user),
      });
    },
  );

  const meHandler = async (request: { id: string; auth: ReturnType<typeof requireAuthContext> | null }) => {
    const auth = requireAuthContext(request);
    const user = await findUserById(ctx.db, auth.userId);
    if (!user) throw AppError.unauthorized('Session user no longer exists');
    return success(request.id, {
      user: serializeUser(user),
      session: {
        id: auth.sessionId,
        cohort: auth.cohort,
        expires_at: auth.expiresAt.toISOString(),
      },
    });
  };

  const meRouteOptions = {
    preHandler: [app.authenticate],
    schema: {
      tags: ['identity'],
      summary: 'Current identity and session',
      security: [{ bearerAuth: [] }],
      response: { 200: envelopeSchema(meSchema), 401: errorEnvelopeSchema },
    },
  };

  r.get('/me', meRouteOptions, meHandler);
  r.get('/auth/me', meRouteOptions, meHandler);

  r.post(
    '/auth/logout',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['identity'],
        summary: 'Revoke the current session',
        security: [{ bearerAuth: [] }],
        response: {
          200: envelopeSchema(z.object({ revoked: z.boolean() })),
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = requireAuthContext(request);
      const revoked = await revokeSession(ctx.db, auth.sessionId);
      ctx.logger.info({ userId: auth.userId, sessionId: auth.sessionId }, 'session revoked');
      setSessionCookie(reply, ctx.env, '', 0);
      return success(request.id, { revoked });
    },
  );

  r.post(
    '/admin/users',
    {
      preHandler: [app.authenticate, app.requireRole('admin')],
      schema: {
        tags: ['identity', 'admin'],
        summary: 'Create an author or researcher account and return a one-time credential',
        description:
          'Admin only. Creating an account is NOT author verification: no ' +
          'author_verifications row is written, and `author_verified` is always false.',
        security: [{ bearerAuth: [] }],
        body: z
          .object({
            role: z.enum(['author', 'researcher']),
            display_name: z.string().min(1).max(200).optional(),
            email: z.string().email().max(320).optional(),
            cohort: z.string().min(1).max(64).optional(),
          })
          .strict(),
        response: {
          200: envelopeSchema(
            z.object({
              user: publicUserSchema,
              login_token: z.string(),
              token_prefix: z.string(),
              expires_at: z.string(),
              author_verified: z.literal(false),
            }),
          ),
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const auth = requireAuthContext(request);
      const { role, display_name, email, cohort } = request.body;

      const { user, token } = await createManagedUser(ctx.db, {
        actorUserId: auth.userId,
        role,
        displayName: display_name ?? null,
        email: email ?? null,
        ...(cohort !== undefined ? { cohort } : {}),
        ttlSeconds: ctx.env.LOGIN_TOKEN_TTL_SECONDS,
      });

      // Only non-secret facts reach the log; the credential is returned once.
      ctx.logger.info(
        { actorUserId: auth.userId, userId: user.id, role: user.role, cohort: user.cohort },
        'admin created account',
      );

      return success(request.id, {
        user: serializeUser(user),
        login_token: token.token,
        token_prefix: token.tokenPrefix,
        expires_at: token.expiresAt.toISOString(),
        author_verified: false as const,
      });
    },
  );
}
