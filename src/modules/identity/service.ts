import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database, Executor } from '../../db/client.js';
import { loginTokens, sessions, users } from '../../db/schema.js';
import type { LoginTokenRow, SessionRow, UserRow } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { generateOpaqueToken, hashToken } from './tokens.js';

export type UserRole = UserRow['role'];

export interface IssuedToken {
  /** Raw secret — return to the caller once, never log or persist. */
  token: string;
  tokenPrefix: string;
  expiresAt: Date;
}

export interface AuthenticatedSession {
  user: UserRow;
  session: SessionRow;
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

export interface CreateUserInput {
  role?: UserRole;
  cohort?: string;
  displayName?: string | null;
  email?: string | null;
  externalAccountRef?: string | null;
}

export async function createUser(db: Executor, input: CreateUserInput = {}): Promise<UserRow> {
  const rows = await db
    .insert(users)
    .values({
      role: input.role ?? 'reader',
      cohort: input.cohort ?? 'unassigned',
      displayName: input.displayName ?? null,
      email: input.email ?? null,
      externalAccountRef: input.externalAccountRef ?? null,
    })
    .returning();
  const user = rows[0];
  if (!user) throw AppError.internal('Failed to create user');
  return user;
}

export async function findUserById(db: Executor, id: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function findUserByEmail(db: Executor, email: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

/* -------------------------------------------------------------------------- */
/* Login tokens (single-use, hashed)                                           */
/* -------------------------------------------------------------------------- */

export interface IssueLoginTokenInput {
  userId: string;
  purpose?: LoginTokenRow['purpose'];
  ttlSeconds: number;
  createdByUserId?: string | null;
  caseId?: string | null;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export async function issueLoginToken(
  db: Executor,
  input: IssueLoginTokenInput,
): Promise<IssuedToken & { id: string }> {
  const { token, tokenHash, tokenPrefix } = generateOpaqueToken();
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);

  const rows = await db
    .insert(loginTokens)
    .values({
      userId: input.userId,
      tokenHash,
      tokenPrefix,
      purpose: input.purpose ?? 'bootstrap',
      caseId: input.caseId ?? null,
      metadata: input.metadata ?? {},
      createdByUserId: input.createdByUserId ?? null,
      expiresAt,
    })
    .returning({ id: loginTokens.id });
  const row = rows[0];
  if (!row) throw AppError.internal('Failed to issue login token');
  return { id: row.id, token, tokenPrefix, expiresAt };
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateSessionInput {
  userId: string;
  ttlSeconds: number;
  userAgent?: string | null;
  cohort?: string;
  now?: Date;
}

export async function createSession(
  db: Executor,
  input: CreateSessionInput,
): Promise<IssuedToken & { id: string; userId: string }> {
  const { token, tokenHash, tokenPrefix } = generateOpaqueToken();
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);

  const rows = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash,
      tokenPrefix,
      cohort: input.cohort ?? 'unassigned',
      userAgent: input.userAgent ?? null,
      expiresAt,
    })
    .returning({ id: sessions.id });
  const row = rows[0];
  if (!row) throw AppError.internal('Failed to create session');
  return { id: row.id, userId: input.userId, token, tokenPrefix, expiresAt };
}

/**
 * Exchange a single-use login token for a session. Runs in one transaction so
 * a token can never be redeemed twice under concurrency (`FOR UPDATE`).
 */
export async function exchangeLoginToken(
  db: Database,
  rawLoginToken: string,
  options: { ttlSeconds: number; userAgent?: string | null; now?: Date } = { ttlSeconds: 0 },
): Promise<{ user: UserRow; session: IssuedToken & { id: string } }> {
  const now = options.now ?? new Date();
  const tokenHash = hashToken(rawLoginToken);

  return db.transaction(async (tx) => {
    const tokenRows = await tx
      .select()
      .from(loginTokens)
      .where(eq(loginTokens.tokenHash, tokenHash))
      .limit(1)
      .for('update');
    const loginToken = tokenRows[0];
    if (!loginToken) throw AppError.unauthorized('Invalid login token');
    if (loginToken.usedAt) throw AppError.unauthorized('Login token has already been used');
    if (loginToken.expiresAt.getTime() <= now.getTime()) {
      throw AppError.unauthorized('Login token has expired');
    }

    await tx
      .update(loginTokens)
      .set({ usedAt: now })
      .where(eq(loginTokens.id, loginToken.id));

    const userRows = await tx.select().from(users).where(eq(users.id, loginToken.userId)).limit(1);
    const user = userRows[0];
    if (!user) throw AppError.unauthorized('Login token owner no longer exists');
    if (user.disabledAt) throw AppError.forbidden('Account is disabled');

    const session = await createSession(tx, {
      userId: user.id,
      ttlSeconds: options.ttlSeconds,
      userAgent: options.userAgent ?? null,
      cohort: user.cohort,
      now,
    });

    return { user, session: { id: session.id, token: session.token, tokenPrefix: session.tokenPrefix, expiresAt: session.expiresAt } };
  });
}

/**
 * Resolve a bearer token to an authenticated session. Returns null for any
 * unknown / revoked / expired token — the caller maps that to 401.
 */
export async function resolveSession(
  db: Database,
  rawToken: string,
  options: { touch?: boolean; now?: Date } = {},
): Promise<AuthenticatedSession | null> {
  const now = options.now ?? new Date();
  const tokenHash = hashToken(rawToken);

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);

  const found = rows[0];
  if (!found) return null;

  if (options.touch !== false) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, found.session.id));
  }

  return { user: found.user, session: found.session };
}

export async function revokeSession(db: Executor, sessionId: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/** Revoke every live session for a user (e.g. after a credential incident). */
export async function revokeAllSessions(db: Executor, userId: string, now = new Date()): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}
