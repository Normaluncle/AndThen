import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../config/env.js';
import { AppError } from './errors.js';

export function sessionCookieName(env: Env): string {
  return env.PUBLIC_BASE_URL.startsWith('https:') ? '__Host-andthen_session' : 'andthen_session';
}
export function cookieToken(request: FastifyRequest, env: Env): string | null {
  const prefix = sessionCookieName(env) + '=';
  const values = (request.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(prefix));
  return values.length === 1 ? values[0]!.slice(prefix.length) : null;
}
// A custom header cannot be submitted by a cross-origin form. No credentialed
// CORS is enabled; Origin is additionally checked against the configured site.
export function assertWebRequest(request: FastifyRequest, env: Env): void {
  if (request.headers['x-andthen-web'] !== '1') throw AppError.forbidden('Browser request header required');
  const origin = request.headers.origin;
  const base = new URL(env.PUBLIC_BASE_URL);
  let allowed = origin === base.origin;
  if (origin && env.NODE_ENV !== 'production') {
    try { const u = new URL(origin); allowed ||= u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname) && ['localhost', '127.0.0.1'].includes(base.hostname); } catch { /* rejected below */ }
  }
  if ((origin && !allowed) || request.headers['sec-fetch-site'] === 'cross-site') throw AppError.forbidden('Cross-origin browser request rejected');
}
export function setSessionCookie(reply: FastifyReply, env: Env, token: string, ttl = env.SESSION_TTL_SECONDS): void {
  const secure = env.PUBLIC_BASE_URL.startsWith('https:') ? '; Secure' : '';
  reply.header('Cache-Control', 'no-store');
  reply.header('Set-Cookie', `${sessionCookieName(env)}=${token}; Max-Age=${ttl}; Path=/; HttpOnly${secure}; SameSite=Lax`);
}
export function issueWebCookie(request: FastifyRequest, reply: FastifyReply, env: Env, token: string, ttl?: number): void {
  if (request.headers['x-andthen-web'] === '1') setSessionCookie(reply, env, token, ttl);
}
