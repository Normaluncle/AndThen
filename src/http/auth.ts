import type { preHandlerHookHandler } from 'fastify';
import type { Database } from '../db/client.js';
import { resolveSession } from '../modules/identity/service.js';
import type { AppInstance, AuthContext } from '../shared/types.js';
import { AppError } from './errors.js';
import type { Env } from '../config/env.js';
import { assertWebRequest, cookieToken } from './session-cookie.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    /** Resolves the bearer token or throws 401. */
    authenticate: preHandlerHookHandler;
    /** Must run after `authenticate`. Throws 403 unless the role matches. */
    requireRole: (...roles: AuthContext['role'][]) => preHandlerHookHandler;
  }
}

export function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Installs the authentication middleware. The token is an opaque random string;
 * only its hash is stored server-side, and the role comes from the users table —
 * never from the request.
 */
export function registerAuth(app: AppInstance, db: Database, env: Env): void {
  app.decorateRequest('auth', null);
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.auth || request.url.startsWith('/api/auth/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.addHook('onRequest', async request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        (request.headers['x-andthen-web'] !== undefined || (!request.headers.authorization && cookieToken(request, env)))) {
      assertWebRequest(request, env);
    }
  });

  app.decorate('authenticate', async (request) => {
    const token = request.headers.authorization ? parseBearerToken(request.headers.authorization) : cookieToken(request, env);
    if (!token) throw AppError.unauthorized('Missing bearer token');

    const resolved = await resolveSession(db, token);
    if (!resolved) throw AppError.unauthorized('Invalid or expired session');

    request.auth = {
      userId: resolved.user.id,
      role: resolved.user.role,
      cohort: resolved.user.cohort,
      sessionId: resolved.session.id,
      expiresAt: resolved.session.expiresAt,
    };
  });

  app.decorate('requireRole', (...roles: AuthContext['role'][]): preHandlerHookHandler => {
    return async (request) => {
      if (!request.auth) throw AppError.unauthorized();
      if (!roles.includes(request.auth.role)) throw AppError.forbidden();
    };
  });
}

/** Reads the authenticated context, asserting the auth hook has run. */
export function requireAuthContext(request: { auth: AuthContext | null }): AuthContext {
  if (!request.auth) throw AppError.unauthorized();
  return request.auth;
}
