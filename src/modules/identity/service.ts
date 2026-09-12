import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database, Executor } from '../../db/client.js';
import { consents, loginTokens, sessions, users } from '../../db/schema.js';
import type { ConsentRow, LoginTokenRow, SessionRow, UserRow } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { writeAuditLog } from '../../shared/audit.js';
import { generateOpaqueToken, hashToken } from './tokens.js';

export type UserRole = UserRow['role'];

/**
 * Only these token purposes may be exchanged for a session.
 *
 * `invitation` is deliberately excluded: an invitation link locates a case and
 * nothing more (PRD FR-11 — "邀请链接本身不建立作者权限"). Treating it as a
 * credential would let anyone who receives a forwarded link act as the author.
 */
export const EXCHANGEABLE_LOGIN_TOKEN_PURPOSES: readonly LoginTokenRow['purpose'][] = [
  'bootstrap',
  'author_binding',
];

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
    // Purpose is checked BEFORE consuming the token so a rejected exchange does
    // not burn an invitation that is still needed to locate its case.
    if (!EXCHANGEABLE_LOGIN_TOKEN_PURPOSES.includes(loginToken.purpose)) {
      throw AppError.forbidden(
        `Login token purpose "${loginToken.purpose}" cannot establish a session`,
      );
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

/* -------------------------------------------------------------------------- */
/* Anonymous reader sessions (FR-04)                                           */
/* -------------------------------------------------------------------------- */

/** Server-assigned cohort for first-party anonymous readers. Never client-set. */
export const ANONYMOUS_READER_COHORT = 'anonymous_reader';

export interface CreateReaderSessionInput {
  /** Version string of the consent text the reader accepted. */
  consentVersion: string;
  ttlSeconds: number;
  userAgent?: string | null;
  now?: Date;
}

export interface ReaderSessionResult {
  user: UserRow;
  session: IssuedToken & { id: string };
  consent: ConsentRow;
}

/**
 * Establish a first-party anonymous reader session.
 *
 * The role (`reader`) and cohort (`anonymous_reader`) are assigned here, on the
 * server. A caller cannot influence either — this is the anonymous counterpart
 * of the strict session-exchange body.
 *
 * A fresh reader identity is created per call: the session token is the only
 * thing that ties the reader to their interests, and clearing it loses the
 * binding (PRD FR-04 explains this to the reader rather than using device
 * fingerprinting).
 */
export async function createReaderSession(
  db: Database,
  input: CreateReaderSessionInput,
): Promise<ReaderSessionResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const user = await createUser(tx, { role: 'reader', cohort: ANONYMOUS_READER_COHORT });

    const consentRows = await tx
      .insert(consents)
      .values({
        userId: user.id,
        sourceId: null,
        purpose: 'reader_session',
        status: 'granted',
        version: input.consentVersion,
        grantedAt: now,
      })
      .returning();
    const consent = consentRows[0];
    if (!consent) throw AppError.internal('Failed to record reader consent');

    const session = await createSession(tx, {
      userId: user.id,
      ttlSeconds: input.ttlSeconds,
      userAgent: input.userAgent ?? null,
      cohort: user.cohort,
      now,
    });

    return {
      user,
      session: {
        id: session.id,
        token: session.token,
        tokenPrefix: session.tokenPrefix,
        expiresAt: session.expiresAt,
      },
      consent,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Admin-managed accounts                                                      */
/* -------------------------------------------------------------------------- */

export interface CreateManagedUserInput {
  actorUserId: string;
  role: Extract<UserRole, 'author' | 'researcher'>;
  displayName?: string | null;
  email?: string | null;
  cohort?: string;
  ttlSeconds: number;
  now?: Date;
}

export interface ManagedUserResult {
  user: UserRow;
  token: IssuedToken & { id: string };
}

/**
 * Admin-only account creation, returning a one-time login credential.
 *
 * This deliberately does NOT create an `author_verifications` row. Creating an
 * account is not evidence that the person owns any particular historical
 * source (PRD §5.1, FR-10); the caller must not present the result as
 * author-verified. Binding a verified author to a source is a separate,
 * evidence-backed step.
 */
export async function createManagedUser(
  db: Database,
  input: CreateManagedUserInput,
): Promise<ManagedUserResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const user = await createUser(tx, {
      role: input.role,
      cohort: input.cohort ?? 'team',
      displayName: input.displayName ?? null,
      email: input.email ?? null,
    });

    const token = await issueLoginToken(tx, {
      userId: user.id,
      purpose: 'bootstrap',
      ttlSeconds: input.ttlSeconds,
      createdByUserId: input.actorUserId,
      metadata: { created_by: 'admin-api' },
      now,
    });

    await writeAuditLog(tx, {
      actorUserId: input.actorUserId,
      actorType: 'user',
      action: 'admin.user_created',
      subjectType: 'user',
      subjectId: user.id,
      properties: { role: user.role, cohort: user.cohort, author_verified: false },
    });

    return { user, token };
  });
}
