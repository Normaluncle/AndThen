import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { sessions, users } from '../../src/db/schema.js';
import { success } from '../../src/http/errors.js';
import { createUser, issueLoginToken } from '../../src/modules/identity/service.js';
import { hashToken } from '../../src/modules/identity/tokens.js';
import { createLogger } from '../../src/shared/logger.js';
import type { AppInstance } from '../../src/shared/types.js';
import { createTestContext, truncateAll, type TestContext } from '../helpers/testdb.js';

describe('identity: authentication, session lifecycle and isolation', () => {
  let ctx: TestContext;
  let app: AppInstance;

  beforeAll(async () => {
    ctx = await createTestContext();
    const built = await buildApp({
      env: ctx.env,
      db: ctx.db,
      logger: createLogger(ctx.env),
      enableDocs: false,
    });
    app = built.app;

    // Test-only probe routes: exercise the auth middleware + role gate contract
    // that later modules rely on.
    app.get(
      '/api/_test/admin-only',
      { preHandler: [app.authenticate, app.requireRole('admin')] },
      async (request) => success(request.id, { ok: true }),
    );
    app.get(
      '/api/_test/whoami',
      { preHandler: [app.authenticate] },
      async (request) => success(request.id, { user_id: request.auth?.userId ?? null }),
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await ctx.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.db);
  });

  async function seedSession(role: 'reader' | 'author' | 'researcher' | 'admin', cohort = 'team') {
    const user = await createUser(ctx.db, { role, cohort });
    const loginToken = await issueLoginToken(ctx.db, { userId: user.id, ttlSeconds: 3600 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions',
      payload: { login_token: loginToken.token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { session_token: string; user: { id: string; role: string } } };
    return { user, loginToken, sessionToken: body.data.session_token, body };
  }

  it('rejects requests without a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.status).toBe('error');
    expect(body.error_code).toBe('unauthorized');
    expect(body.request_id).toBe(res.headers['x-request-id']);
  });

  it('rejects unknown, malformed and revoked tokens', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(missing.statusCode).toBe(401);

    const garbage = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer not-a-real-token-value' },
    });
    expect(garbage.statusCode).toBe(401);

    const notBearer = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Basic abc' },
    });
    expect(notBearer.statusCode).toBe(401);
  });

  it('exchanges a single-use login token for a session, exactly once', async () => {
    const user = await createUser(ctx.db, { role: 'reader', cohort: 'external' });
    const loginToken = await issueLoginToken(ctx.db, { userId: user.id, ttlSeconds: 3600 });

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions',
      payload: { login_token: loginToken.token },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json() as {
      status: string;
      data: { session_token: string; expires_at: string; user: { id: string; role: string } };
    };
    expect(body.status).toBe('ok');
    expect(body.data.user.id).toBe(user.id);
    expect(body.data.user.role).toBe('reader');
    expect(body.data.session_token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Replay is refused.
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions',
      payload: { login_token: loginToken.token },
    });
    expect(second.statusCode).toBe(401);
    expect(second.json().error_code).toBe('unauthorized');

    // The raw token is never stored; only its SHA-256 hash.
    const stored = await ctx.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toBe(hashToken(body.data.session_token));
    expect(stored[0]!.tokenHash).not.toBe(body.data.session_token);
    expect(stored[0]!.tokenPrefix).toBe(body.data.session_token.slice(0, 8));
  });

  it('returns the caller identity and revokes on logout', async () => {
    const { user, sessionToken } = await seedSession('reader');

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.id).toBe(user.id);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json().data.revoked).toBe(true);

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('refuses an expired session', async () => {
    const { sessionToken } = await seedSession('reader');
    await ctx.db.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import('drizzle-orm')).sql`update sessions set expires_at = now() - interval '1 hour'`,
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('does not let a test account self-report a role in the request body', async () => {
    const user = await createUser(ctx.db, { role: 'reader', cohort: 'external' });
    const loginToken = await issueLoginToken(ctx.db, { userId: user.id, ttlSeconds: 3600 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions',
      payload: { login_token: loginToken.token, role: 'admin', cohort: 'team' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe('validation_error');

    // The row is untouched and still a reader.
    const stored = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(stored[0]!.role).toBe('reader');
    expect(stored[0]!.cohort).toBe('external');
  });

  it('derives authorization from the database, not from the token or client', async () => {
    const { user, sessionToken } = await seedSession('reader');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/_test/admin-only',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error_code).toBe('forbidden');

    // Promote server-side: the same session token immediately gains access.
    await ctx.db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/_test/admin-only',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.ok).toBe(true);

    // And demote again: access is withdrawn without touching the token.
    await ctx.db.update(users).set({ role: 'reader' }).where(eq(users.id, user.id));
    const deniedAgain = await app.inject({
      method: 'GET',
      url: '/api/_test/admin-only',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(deniedAgain.statusCode).toBe(403);
  });

  it('isolates identities: one session cannot act as another', async () => {
    const alice = await seedSession('reader', 'external');
    const bob = await seedSession('author', 'external');

    const whoAlice = await app.inject({
      method: 'GET',
      url: '/api/_test/whoami',
      headers: { authorization: `Bearer ${alice.sessionToken}` },
    });
    const whoBob = await app.inject({
      method: 'GET',
      url: '/api/_test/whoami',
      headers: { authorization: `Bearer ${bob.sessionToken}` },
    });
    expect(whoAlice.json().data.user_id).toBe(alice.user.id);
    expect(whoBob.json().data.user_id).toBe(bob.user.id);
    expect(whoAlice.json().data.user_id).not.toBe(whoBob.json().data.user_id);

    // Alice logging out must not revoke Bob.
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${alice.sessionToken}` },
    });
    const bobStill = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${bob.sessionToken}` },
    });
    expect(bobStill.statusCode).toBe(200);
  });

  it('never echoes a token hash or the raw token in a response body', async () => {
    const { sessionToken } = await seedSession('reader');
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const text = me.body;
    expect(text).not.toContain(sessionToken);
    expect(text).not.toContain(hashToken(sessionToken));
  });

  it('accepts a bodyless POST (logout needs no request body)', async () => {
    const { sessionToken } = await seedSession('reader');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.revoked).toBe(true);
  });

  it('classifies framework client errors as client errors, never as 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'a=1',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error_code).toBe('unsupported_media_type');
    expect(res.json().status).toBe('error');
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error_code).toBe('not_found');
    expect(res.json().request_id).toBe(res.headers['x-request-id']);
  });
});
