/**
 * Server-side authorization helpers shared by the `sources` and `cases`
 * modules.
 *
 * Rules encoded here (PRD §5, §7, FR-10):
 *  - Ownership is never taken from a request body. It is derived from the
 *    database and `request.auth.userId`.
 *  - A source is "authored" by a user only when that user self-imported it as
 *    `author_paste`, or holds a `verified` `author_verifications` row for it.
 *  - A researcher may access a source only if they are the one responsible for
 *    it (importer or creator of a case on it) — never every source.
 *  - Consent is separate from login: it lives in `consents`, per purpose.
 */
import { and, eq, or, isNull, gt } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { authorVerifications, consents, followupCases } from '../../db/schema.js';
import type { ConsentRow, SourceRow } from '../../db/schema.js';
import type { AuthContext } from '../../shared/types.js';

export type ConsentPurpose = ConsentRow['purpose'];

/**
 * Cohorts whose activity must never enter research metrics (PRD FR-05,
 * T05/T20). Server-maintained: a client can never self-assign a cohort.
 */
export const EXCLUDED_COHORTS: ReadonlySet<string> = new Set([
  'team',
  'test',
  'demo',
  'internal',
  'fixture',
  'test_fixture',
  'unassigned',
  'pressure_test',
]);

export function isExcludedCohort(cohort: string): boolean {
  return EXCLUDED_COHORTS.has(cohort);
}

/** A verified author link for (source, user). */
export async function isVerifiedAuthor(
  db: Executor,
  sourceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: authorVerifications.id })
    .from(authorVerifications)
    .where(
      and(
        eq(authorVerifications.sourceId, sourceId),
        eq(authorVerifications.userId, userId),
        eq(authorVerifications.status, 'verified'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * True when the user is the source's author: a self-imported `author_paste`
 * (they bound only themselves at import time) or a verified author link.
 */
export async function isSourceAuthor(
  db: Executor,
  source: SourceRow,
  userId: string,
): Promise<boolean> {
  if (source.sourceType === 'author_paste' && source.createdByUserId === userId) return true;
  return isVerifiedAuthor(db, source.id, userId);
}

/** A researcher "owns" a source when they imported it or created a case for it. */
export async function isAssignedResearcher(
  db: Executor,
  sourceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: followupCases.id })
    .from(followupCases)
    .where(and(eq(followupCases.sourceId, sourceId), eq(followupCases.createdByUserId, userId)))
    .limit(1);
  return rows.length > 0;
}

export interface SourceAccess {
  isAdmin: boolean;
  isImporter: boolean;
  isAuthor: boolean;
  isVerifiedAuthor: boolean;
  isAssignedResearcher: boolean;
}

export async function resolveSourceAccess(
  db: Executor,
  source: SourceRow,
  auth: AuthContext,
): Promise<SourceAccess> {
  const isImporter = source.createdByUserId === auth.userId;
  const verified = await isVerifiedAuthor(db, source.id, auth.userId);
  const isAuthor = (source.sourceType === 'author_paste' && isImporter) || verified;
  const assignedResearcher =
    auth.role === 'researcher' && (await isAssignedResearcher(db, source.id, auth.userId));
  return {
    isAdmin: auth.role === 'admin',
    isImporter,
    isAuthor,
    isVerifiedAuthor: verified,
    isAssignedResearcher: assignedResearcher,
  };
}

/** Any of owner/importer/author/assigned-researcher/admin may read a private source. */
export function canReadSource(access: SourceAccess): boolean {
  return (
    access.isAdmin ||
    access.isImporter ||
    access.isAuthor ||
    access.isAssignedResearcher
  );
}

/** An active (granted) consent row for (source, purpose). */
export async function hasActiveConsent(
  db: Executor,
  sourceId: string,
  purpose: ConsentPurpose,
  userId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.sourceId, sourceId),
        eq(consents.purpose, purpose),
        eq(consents.status, 'granted'),
        or(isNull(consents.expiresAt), gt(consents.expiresAt, new Date())),
        userId ? eq(consents.userId, userId) : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** A revoked consent row for (source, purpose) hard-blocks public display. */
export async function hasRevokedConsent(
  db: Executor,
  sourceId: string,
  purpose: ConsentPurpose,
): Promise<boolean> {
  const rows = await db
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.sourceId, sourceId),
        eq(consents.purpose, purpose),
        eq(consents.status, 'revoked'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * A source is publicly visible only when its own permission status is
 * `public_approved` AND no `demo_public_display` consent has been revoked.
 * The second check makes a revocation effective immediately, without waiting
 * for the publish module to touch `permission_status`.
 */
export async function isPubliclyVisible(db: Executor, source: SourceRow): Promise<boolean> {
  if (source.deletedAt || source.permissionStatus !== 'public_approved') return false;
  return hasActiveConsent(db, source.id, 'demo_public_display');
}
