import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { success } from '../../http/errors.js';
import type { AppInstance, ModuleContext } from '../../shared/types.js';
import { AppError } from '../../http/errors.js';
import { requireAuthContext } from '../../http/auth.js';
import { exchangeLoginToken, findUserById, revokeSession } from './service.js';

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['reader', 'author', 'researcher', 'admin']),
  cohort: z.string(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
});

const sessionSchema = z.object({
  session_token: z.string(),
  token_prefix: z.string(),
  expires_at: z.string(),
  user: publicUserSchema,
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
 * POST /api/auth/sessions  — exchange a single-use login token for a session
 *                            (establish + exchange; the login token is minted by
 *                            the bootstrap CLI or an invitation flow).
 * GET  /api/auth/me        — the caller's own identity and session metadata.
 * POST /api/auth/logout    — revoke the current session.
 *
 * Roles are read from the users table only. A `role` field in the request body
 * is stripped by the zod schema and can never influence authorization.
 */
export async function registerIdentityRoutes(app: AppInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/auth/sessions',
    {
      schema: {
        tags: ['identity'],
        summary: 'Exchange a single-use login token for a session',
        body: z.object({ login_token: z.string().min(16).max(512) }).strict(),
        response: { 200: envelopeSchema(sessionSchema), 401: errorEnvelopeSchema },
      },
    },
    async (request) => {
      const { login_token } = request.body;
      const { user, session } = await exchangeLoginToken(ctx.db, login_token, {
        ttlSeconds: ctx.env.SESSION_TTL_SECONDS,
        userAgent: request.headers['user-agent'] ?? null,
      });
      ctx.logger.info({ userId: user.id, sessionId: session.id }, 'session established');
      return success(request.id, {
        session_token: session.token,
        token_prefix: session.tokenPrefix,
        expires_at: session.expiresAt.toISOString(),
        user: serializeUser(user),
      });
    },
  );

  r.get(
    '/auth/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['identity'],
        summary: 'Current identity and session',
        security: [{ bearerAuth: [] }],
        response: {
          200: envelopeSchema(
            z.object({
              user: publicUserSchema,
              session: z.object({
                id: z.string().uuid(),
                cohort: z.string(),
                expires_at: z.string(),
              }),
            }),
          ),
          401: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
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
    },
  );

  r.post(
    '/auth/logout',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['identity'],
        summary: 'Revoke the current session',
        security: [{ bearerAuth: [] }],
        response: { 200: envelopeSchema(z.object({ revoked: z.boolean() })), 401: errorEnvelopeSchema },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const revoked = await revokeSession(ctx.db, auth.sessionId);
      ctx.logger.info({ userId: auth.userId, sessionId: auth.sessionId }, 'session revoked');
      return success(request.id, { revoked });
    },
  );
}
