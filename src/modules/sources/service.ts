import {siteCounts} from '../community/counts.js';
import {sourcePresentation} from './presentation.js';
import type {Presentation} from './presentation-schema.js';
/**
 * Sources module service (PRD §7, FR-01..FR-06, FR-10, FR-12 partial).
 *
 * Responsibilities:
 *  - idempotent source import + immutable snapshots;
 *  - material-level enforcement (`exact_excerpt` is the only quotable level);
 *  - per-purpose consent grant/revoke, with revocation taking effect
 *    immediately (public display stops, in-flight AI work is cancelled);
 *  - manual author verification where weak evidence never auto-passes;
 *  - the public story projection (only licensed, non-withdrawn material);
 *  - reader interest (dedupe by unique key) and the caller's following list.
 *
 * Nothing here calls an external platform API. A URL is registered, never
 * fetched.
 */
import { and, desc, eq, inArray, isNull, exists, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import {
  auditLogs,
  authorVerifications,
  consents,
  followupCases,
  followupVersions,
  interests,
  notifications,
  researchEvents,
  sourceSnapshots,
  sources,
  users,
} from '../../db/schema.js';
import type {
  AuthorVerificationRow,
  ConsentRow,
  SourceRow,
  SourceSnapshotRow,
} from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { invalidateAuthorMemory } from '../memory/service.js';
import { invalidatePreparation } from '../memory/preparation.js';
import { sha256 } from '../identity/tokens.js';
import type { AuthContext, ModuleContext } from '../../shared/types.js';
import {
  isExcludedCohort,
  isPubliclyVisible,
  isSourceAuthor,
  isVerifiedAuthor,
  resolveSourceAccess,
  type ConsentPurpose,
} from './access.js';

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

export type SourceType = SourceRow['sourceType'];
export type MaterialLevel = SourceSnapshotRow['materialLevel'];
export type PermissionStatus = SourceRow['permissionStatus'];
export type Provenance = string;

export interface ImportSourceInput {
  sourceType: SourceType;
  originalUrl: string | null;
  originalAccountRef: string | null;
  title: string | null;
  materialLevel: MaterialLevel;
  body: string | null;
  excerpt: string | null;
  excerptLocation: string | null;
  publishedAt: Date | null;
  upstreamUpdatedAt: Date | null;
  notes: string | null;
  provenance: Provenance;
}

export interface ImportSourceResult {
  source: SourceRow;
  snapshot: SourceSnapshotRow;
  /** True when an identical snapshot already existed (no new version created). */
  deduped: boolean;
}

/**
 * Default permission status by provenance of the material (PRD FR-01/FR-03).
 * Nothing is public until an author consent + verification flips it.
 */
export function defaultPermissionStatus(sourceType: SourceType): PermissionStatus {
  switch (sourceType) {
    case 'author_paste':
    case 'researcher_import':
      return 'private_only';
    case 'official_search':
    case 'third_party_link':
      return 'pending';
  }
}

/** Which roles may register which source types (PRD FR-01, §5.1). */
export function assertImportAllowed(auth: AuthContext, sourceType: SourceType): void {
  const allowed: Record<AuthContext['role'], SourceType[]> = {
    admin: ['official_search', 'author_paste', 'researcher_import', 'third_party_link'],
    researcher: ['official_search', 'researcher_import', 'third_party_link'],
    author: ['author_paste', 'third_party_link'],
    reader: ['third_party_link'],
  };
  if (!allowed[auth.role].includes(sourceType)) {
    throw AppError.forbidden(`Role ${auth.role} may not register a ${sourceType} source`);
  }
}

export function assertProvenanceAllowed(auth: AuthContext, provenance: Provenance): void {
  // Truthfulness guard: only accountable research/ops roles may mark material
  // as real and authorized. Everyone else is test_fixture / team_material.
  if (provenance === 'real_authorized' && auth.role !== 'researcher' && auth.role !== 'admin') {
    throw AppError.forbidden('Only research/ops roles may mark a source as real_authorized');
  }
}

/** Stable content hash for snapshot dedupe. Never includes credentials. */
export function snapshotContentHash(input: {
  materialLevel: MaterialLevel;
  body: string | null;
  excerpt: string | null;
  excerptLocation: string | null;
}): string {
  return sha256(
    [input.materialLevel, input.body ?? '', input.excerpt ?? '', input.excerptLocation ?? ''].join(
      '\u0000',
    ),
  );
}

function validateMaterial(input: ImportSourceInput): void {
  if (input.materialLevel === 'exact_excerpt') {
    if (!input.excerpt || input.excerpt.trim().length === 0) {
      throw AppError.sourceIncomplete('An exact_excerpt snapshot requires the excerpt text');
    }
    return;
  }
  // A summary/ recollection must never masquerade as a verbatim quote.
  if (input.excerpt && input.excerpt.trim().length > 0) {
    throw AppError.validation(
      'excerpt is only valid when material_level is exact_excerpt; use body for summaries',
    );
  }
}

function naturalSourceKey(input: ImportSourceInput): string {
  const identity = input.originalUrl
    ? `url:${input.originalUrl}`
    : `acct:${input.originalAccountRef ?? ''}|title:${input.title ?? ''}`;
  return `${input.sourceType}|${identity}`;
}

async function findExistingSource(
  db: Executor,
  input: ImportSourceInput,
): Promise<SourceRow | undefined> {
  const conditions = [eq(sources.sourceType, input.sourceType)];
  if (input.originalUrl) {
    conditions.push(eq(sources.originalUrl, input.originalUrl));
  } else {
    conditions.push(
      input.originalAccountRef
        ? eq(sources.originalAccountRef, input.originalAccountRef)
        : isNull(sources.originalAccountRef),
      input.title ? eq(sources.title, input.title) : isNull(sources.title),
    );
  }
  const rows = await db
    .select()
    .from(sources)
    .where(and(...conditions))
    .limit(1);
  return rows[0];
}

/**
 * Idempotent import. A repeated submission of the same material returns the
 * existing source + snapshot and never creates a second public sample
 * (PRD FR-01 acceptance). Concurrency is serialized with a transaction-scoped
 * advisory lock on the natural key, so two simultaneous identical imports
 * cannot both insert.
 */
export async function importSource(
  ctx: ModuleContext,
  auth: AuthContext,
  input: ImportSourceInput,
): Promise<ImportSourceResult> {
  assertImportAllowed(auth, input.sourceType);
  assertProvenanceAllowed(auth, input.provenance);
  validateMaterial(input);

  const now = ctx.now();
  const contentHash = snapshotContentHash(input);
  const lockKey = naturalSourceKey(input);

  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

    let source = await findExistingSource(tx, input);
    if (source) {
      const [locked] = await tx.select().from(sources).where(eq(sources.id, source.id)).for('update');
      if (!locked || locked.deletedAt || ['revoked', 'rejected'].includes(locked.permissionStatus)) throw AppError.withdrawn('Source is unavailable');
      source = locked;
    }
    if (!source) {
      const inserted = await tx
        .insert(sources)
        .values({
          sourceType: input.sourceType,
          originalUrl: input.originalUrl,
          originalAccountRef: input.originalAccountRef,
          title: input.title,
          permissionStatus: defaultPermissionStatus(input.sourceType),
          provenance: input.provenance,
          notes: input.notes,
          createdByUserId: auth.userId,
        })
        .returning();
      source = inserted[0];
      if (!source) throw AppError.internal('Failed to create source');
    }

    const existingSnapshot = await tx
      .select()
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.sourceId, source.id),
          eq(sourceSnapshots.contentHash, contentHash),
        ),
      )
      .limit(1);
    if (existingSnapshot[0]) {
      return { source, snapshot: existingSnapshot[0], deduped: true };
    }

    // Only the internal official adapter may refresh official material on
    // behalf of a reader. HTTP import schemas cannot supply official_api.
    const trustedOfficial = input.provenance === 'official_api' && source.provenance === 'official_api';
    if (!trustedOfficial) {
      const access = await resolveSourceAccess(tx, source, auth);
      const verifiedOwners = await tx.select({ id: authorVerifications.id }).from(authorVerifications)
        .where(and(eq(authorVerifications.sourceId, source.id), eq(authorVerifications.status, 'verified'))).limit(1);
      if (!access.isAdmin && !access.isVerifiedAuthor && !access.isAssignedResearcher
        && !(access.isImporter && verifiedOwners.length === 0)) throw AppError.forbidden('Only the responsible owner may replace source material');
    }

    const maxRow = await tx
      .select({ max: sql<number>`coalesce(max(${sourceSnapshots.version}), 0)::int` })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.sourceId, source.id));
    const nextVersion = (maxRow[0]?.max ?? 0) + 1;

    const insertedSnapshot = await tx
      .insert(sourceSnapshots)
      .values({
        sourceId: source.id,
        version: nextVersion,
        materialLevel: input.materialLevel,
        body: input.body,
        excerpt: input.excerpt,
        excerptLocation: input.excerptLocation,
        contentHash,
        publishedAt: input.publishedAt,
        upstreamUpdatedAt: input.upstreamUpdatedAt,
        acquiredAt: now,
        createdByUserId: auth.userId,
      })
      .returning();
    const snapshot = insertedSnapshot[0];
    if (!snapshot) throw AppError.internal('Failed to create source snapshot');
    await invalidatePreparation(ctx, tx, source.id);
    const owners = await tx.select().from(authorVerifications).where(and(eq(authorVerifications.sourceId, source.id), eq(authorVerifications.status, 'verified')));
    for (const owner of owners) await invalidateAuthorMemory(ctx, tx, owner.userId);

    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'source.imported',
      subjectType: 'source',
      subjectId: source.id,
      properties: { source_type: input.sourceType, material_level: input.materialLevel },
    });

    return { source, snapshot, deduped: false };
  });
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

export async function findSourceById(
  db: Executor,
  sourceId: string,
): Promise<SourceRow | undefined> {
  const rows = await db.select().from(sources).where(and(eq(sources.id, sourceId), isNull(sources.deletedAt))).limit(1);
  return rows[0];
}

/** Loads a source the caller is allowed to read, or throws not_found. */
export async function requireReadableSource(
  db: Executor,
  auth: AuthContext,
  sourceId: string,
): Promise<SourceRow> {
  const source = await findSourceById(db, sourceId);
  if (!source) throw AppError.notFound('Source not found');
  const access = await resolveSourceAccess(db, source, auth);
  // A uniform not_found avoids leaking the existence of another user's source.
  if (!access.isAdmin && !access.isImporter && !access.isAuthor && !access.isAssignedResearcher) {
    throw AppError.notFound('Source not found');
  }
  return source;
}

export async function listSourceSnapshots(
  db: Executor,
  sourceId: string,
): Promise<SourceSnapshotRow[]> {
  return db
    .select()
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.sourceId, sourceId))
    .orderBy(desc(sourceSnapshots.version));
}

export async function latestSnapshot(
  db: Executor,
  sourceId: string,
): Promise<SourceSnapshotRow | undefined> {
  const rows = await db
    .select()
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.sourceId, sourceId))
    .orderBy(desc(sourceSnapshots.version))
    .limit(1);
  return rows[0];
}

/* -------------------------------------------------------------------------- */
/* Consents                                                                    */
/* -------------------------------------------------------------------------- */

export interface GrantConsentResult {
  consent: ConsentRow;
  sourcePermissionStatus: PermissionStatus;
}

/**
 * Grant a per-purpose consent. Only the source's author may consent for it —
 * a researcher or admin can never sign on the author's behalf (PRD §5.1/§5.3).
 * `demo_public_display` only flips the source to `public_approved` when the
 * author is verified; an unverified author can use the material privately but
 * cannot publish it.
 */
export async function grantConsent(
  ctx: ModuleContext,
  auth: AuthContext,
  sourceId: string,
  purpose: ConsentPurpose,
  version: string,
  requestedExpiry?: Date,
): Promise<GrantConsentResult> {
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).for('update');
  const source = await findSourceById(tx, sourceId);
  if (!source) throw AppError.notFound('Source not found');

  const access = await resolveSourceAccess(tx, source, auth);
  if (!access.isAuthor) {
    throw AppError.forbidden('Only the source author may grant a consent for it');
  }

  const now = ctx.now();
  if (requestedExpiry && requestedExpiry <= now) throw AppError.validation('Consent expiry must be in the future');
  const publicDeadline = new Date(now.getTime() + 90 * 86400000);
  const expiresAt = purpose === 'demo_public_display'
    ? new Date(Math.min(requestedExpiry?.getTime() ?? publicDeadline.getTime(), publicDeadline.getTime()))
    : requestedExpiry ?? null;
  const [existing] = await tx.select().from(consents).where(and(eq(consents.sourceId, sourceId), eq(consents.userId, auth.userId), eq(consents.purpose, purpose), eq(consents.version, version)));
  if (existing) {
    if (existing.status !== 'granted' || (existing.expiresAt && existing.expiresAt <= now) || (purpose === 'demo_public_display' && !existing.expiresAt && existing.grantedAt.getTime() + 90 * 86400000 <= now.getTime())) throw AppError.conflict('Renew consent with a new version');
    const replayExpiry = requestedExpiry ? (purpose === 'demo_public_display' ? Math.min(requestedExpiry.getTime(), existing.grantedAt.getTime() + 90 * 86400000) : requestedExpiry.getTime()) : undefined;
    if (replayExpiry !== undefined && existing.expiresAt?.getTime() !== replayExpiry) throw AppError.conflict('Changing consent expiry requires a new version');
    return { consent: existing, sourcePermissionStatus: source.permissionStatus };
  }
  await tx.update(consents).set({ status: 'expired' }).where(and(eq(consents.sourceId, sourceId), eq(consents.userId, auth.userId), eq(consents.purpose, purpose), eq(consents.status, 'granted')));
  const rows = await tx
    .insert(consents)
    .values({
      userId: auth.userId,
      sourceId,
      purpose,
      status: 'granted',
      version,
      grantedAt: now,
      expiresAt,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [consents.userId, consents.sourceId, consents.purpose, consents.version],
      set: { status: 'granted', grantedAt: now, revokedAt: null, expiresAt },
    })
    .returning();
  const consent = rows[0];
  if (!consent) throw AppError.internal('Failed to record consent');

  let sourcePermissionStatus = source.permissionStatus;
  if (purpose === 'private_interview' && source.permissionStatus === 'pending' && await isVerifiedAuthor(tx,source.id,auth.userId)) {
    await tx.update(sources).set({permissionStatus:'private_only',updatedAt:now}).where(eq(sources.id,sourceId));
    sourcePermissionStatus='private_only';
  }
  if (purpose === 'demo_public_display' && access.isVerifiedAuthor) {
    const updated = await tx
      .update(sources)
      .set({ permissionStatus: 'public_approved', updatedAt: now })
      .where(eq(sources.id, sourceId))
      .returning({ permissionStatus: sources.permissionStatus });
    sourcePermissionStatus = updated[0]?.permissionStatus ?? 'public_approved';
  }

  await writeAudit(tx, {
    actorUserId: auth.userId,
    action: 'consent.granted',
    subjectType: 'source',
    subjectId: sourceId,
    properties: { purpose, version, source_permission_status: sourcePermissionStatus },
  });

  return { consent, sourcePermissionStatus };
  });
}

export interface RevokeConsentResult {
  consent: ConsentRow;
  sourcePermissionStatus: PermissionStatus;
  cancelledJobs: number;
}

/**
 * Revoke a per-purpose consent. Revocation is not a field update: it
 * immediately invalidates public display and cancels any in-flight AI job that
 * referenced this source (whose result then cannot be committed). Content
 * deletion itself is the publish module's job (PRD §19.2, task constraint).
 */
export async function revokeConsent(
  ctx: ModuleContext,
  auth: AuthContext,
  sourceId: string,
  purpose: ConsentPurpose,
): Promise<RevokeConsentResult> {
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).for('update');
  const source = await findSourceById(tx, sourceId);
  if (!source) throw AppError.notFound('Source not found');

  const access = await resolveSourceAccess(tx, source, auth);
  // The author may revoke their own consent; an admin may revoke for incident
  // response. A researcher can never sign (or unsign) on the author's behalf.
  if (!access.isAuthor && !access.isAdmin) {
    throw AppError.forbidden('Only the source author or an admin may revoke a consent');
  }

  const now = ctx.now();
  const revoked = await tx
    .update(consents)
    .set({ status: 'revoked', revokedAt: now })
    .where(
      and(
        eq(consents.sourceId, sourceId),
        eq(consents.purpose, purpose),
        eq(consents.status, 'granted'),
      ),
    )
    .returning();
  let consent = revoked[0];
  if (!consent) {
    // Idempotent: revoking an already-revoked consent returns the existing row.
    const existing = await tx
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.sourceId, sourceId),
          eq(consents.purpose, purpose),
          eq(consents.status, 'revoked'),
        ),
      )
      .limit(1);
    consent = existing[0];
    if (!consent) throw AppError.conflict('No active consent for this purpose');
  }

  let sourcePermissionStatus = source.permissionStatus;
  if (purpose === 'demo_public_display') {
    const updated = await tx
      .update(sources)
      .set({ permissionStatus: 'revoked', updatedAt: now })
      .where(eq(sources.id, sourceId))
      .returning({ permissionStatus: sources.permissionStatus });
    sourcePermissionStatus = updated[0]?.permissionStatus ?? 'revoked';
  }

  let cancelledJobs = 0;
  if (['demo_public_display', 'external_model_processing', 'private_interview'].includes(purpose)) await invalidatePreparation(ctx, tx, sourceId);
  if (purpose === 'external_model_processing' || purpose === 'private_interview') {
    for (const userId of new Set(revoked.map(c => c.userId))) await invalidateAuthorMemory(ctx, tx, userId);
    // Cancel queued/running jobs that carry this source. A running job's
    // `complete()` requires status='running', so its late result is rejected.
    const cancelled = await tx.execute(sql`
      update jobs
      set status = 'cancelled',
          lease_owner = null,
          lease_expires_at = null,
          finished_at = now(),
          updated_at = now()
      where status in ('queued', 'running')
        and payload->>'source_id' = ${sourceId}
      returning id
    `);
    cancelledJobs = (cancelled.rows as unknown[]).length;
    await tx.execute(sql`update interview_sessions set mode='manual', revision=revision+1, stop_reason=${purpose === 'private_interview' ? 'private_consent_revoked' : 'model_consent_revoked'}, updated_at=now()
      where case_id in (select id from followup_cases where source_id=${sourceId}) and status in ('active','paused')`);
    await tx.execute(sql`update ai_runs set status='cancelled', finished_at=now(), output=null where source_id=${sourceId} and status in ('queued','running')`);
  }

  await writeAudit(tx, {
    actorUserId: auth.userId,
    action: 'consent.revoked',
    subjectType: 'source',
    subjectId: sourceId,
    properties: { purpose, cancelled_jobs: cancelledJobs, source_permission_status: sourcePermissionStatus },
  });
  await writeResearchEvent(tx, {
    eventType: 'consent_revoked',
    cohort: auth.cohort,
    sourceId,
    properties: { purpose, excluded: isExcludedCohort(auth.cohort) },
  });

  return { consent, sourcePermissionStatus, cancelledJobs };
  });
}

export async function listConsents(db: Executor, sourceId: string): Promise<ConsentRow[]> {
  return db
    .select()
    .from(consents)
    .where(eq(consents.sourceId, sourceId))
    .orderBy(desc(consents.createdAt));
}

/* -------------------------------------------------------------------------- */
/* Author verification                                                         */
/* -------------------------------------------------------------------------- */

export interface RecordVerificationInput {
  subjectUserId: string;
  method: 'oauth' | 'manual';
  evidenceRef: string | null;
  scope: string | null;
  notes: string | null;
  approve: boolean;
}

/**
 * Record a manual/OAuth author verification. Two hard rules (PRD §5.2, FR-10):
 *  - a login or an invitation token is never evidence: `evidence_ref` is
 *    required before a link may be marked verified;
 *  - weak evidence never auto-passes: the default status is `pending`, and a
 *    researcher may not approve a `manual` record (only an admin may, and only
 *    with a controlled evidence reference).
 */
export async function recordAuthorVerification(
  ctx: ModuleContext,
  auth: AuthContext,
  sourceId: string,
  input: RecordVerificationInput,
): Promise<AuthorVerificationRow> {
  return ctx.db.transaction(async tx => {
  await tx.select({id:sources.id}).from(sources).where(eq(sources.id,sourceId)).for('update');
  const source = await findSourceById(tx, sourceId);
  if (!source) throw AppError.notFound('Source not found');

  if (auth.role !== 'researcher' && auth.role !== 'admin') {
    throw AppError.forbidden('Only research/ops roles may record an author verification');
  }
  if (input.subjectUserId === auth.userId) {
    throw AppError.forbidden('You cannot verify your own authorship from your own session');
  }
  if (input.approve && !input.evidenceRef) {
    throw AppError.sourceIncomplete(
      'A verified author link requires a controlled evidence reference',
    );
  }
  if (input.approve && input.method === 'manual' && auth.role !== 'admin') {
    throw AppError.forbidden('A researcher cannot approve weak (manual) evidence; an admin must');
  }

  const subjectExists = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.subjectUserId))
    .limit(1);
  if (subjectExists.length === 0) throw AppError.notFound('Subject user not found');

  if (input.approve) {
    const conflicting = await tx
      .select({ userId: authorVerifications.userId })
      .from(authorVerifications)
      .where(
        and(
          eq(authorVerifications.sourceId, sourceId),
          eq(authorVerifications.status, 'verified'),
        ),
      )
      .limit(1);
    const bound = conflicting[0];
    if (bound && bound.userId !== input.subjectUserId) {
      throw AppError.conflict('This source is already verified to a different user');
    }
  }

  const now = ctx.now();
  const inserted = await tx
    .insert(authorVerifications)
    .values({
      userId: input.subjectUserId,
      sourceId,
      method: input.method,
      status: input.approve ? 'verified' : 'pending',
      evidenceRef: input.evidenceRef,
      verifierUserId: auth.userId,
      scope: input.scope,
      notes: input.notes,
      verifiedAt: input.approve ? now : null,
    })
    .returning();
  const verification = inserted[0];
  if (!verification) throw AppError.internal('Failed to record author verification');

  if (input.approve) {
    // Binding follows verification: an open case adopts the verified author.
    await tx
      .update(followupCases)
      .set({ authorUserId: input.subjectUserId, updatedAt: now })
      .where(
        and(
          eq(followupCases.sourceId, sourceId),
          isNull(followupCases.authorUserId),
          inArray(followupCases.status, [
            'candidate',
            'hold',
            'eligible',
            'invite_recorded',
            'accepted',
          ]),
        ),
      );
  }

  await writeAudit(tx, {
    actorUserId: auth.userId,
    action: input.approve ? 'author_verification.verified' : 'author_verification.recorded',
    subjectType: 'source',
    subjectId: sourceId,
    properties: {
      method: input.method,
      status: verification.status,
      // The evidence body is never stored or logged — only its controlled ref.
      has_evidence_ref: Boolean(input.evidenceRef),
    },
  });

  return verification;
  });
}

export async function listAuthorVerifications(
  db: Executor,
  sourceId: string,
): Promise<AuthorVerificationRow[]> {
  return db
    .select()
    .from(authorVerifications)
    .where(eq(authorVerifications.sourceId, sourceId))
    .orderBy(desc(authorVerifications.createdAt));
}

/* -------------------------------------------------------------------------- */
/* Public story projection                                                     */
/* -------------------------------------------------------------------------- */

export interface PublicStatement {
  id: string;
  text: string;
  kind: string;
  section?: 'then' | 'later' | 'reflection';
  question?: string;
}

export interface PublicFollowup {
  version_id: string;
  statements: PublicStatement[];
  confirmed_at: string | null;
  published_at: string | null;
  ai_assisted: boolean;
  attribution: 'author_reported';
}

export interface PublicStory extends Presentation {
  site_counts:number[];
  source_id: string;
  title: string | null;
  source_type: SourceType;
  original_url: string | null;
  material_level: MaterialLevel;
  text: string | null;
  excerpt_location: string | null;
  published_at: string | null;
  upstream_updated_at: string | null;
  acquired_at: string | null;
  provenance: string;
  published_followup: PublicFollowup | null;
  withdrawn: boolean;
}

function projectStatements(raw: unknown[]): PublicStatement[] {
  const out: PublicStatement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    // Only explicitly public items are projected. Everything else stays private.
    if (record.visibility !== 'public') continue;
    const id = typeof record.id === 'string' ? record.id : null;
    const text = typeof record.text === 'string' ? record.text : null;
    const kind = typeof record.kind === 'string' ? record.kind : null;
    if (!id || !text || !kind) continue;
    const section = record.section;
    out.push({ id, text, kind, ...(typeof record.question === 'string' ? {question:record.question} : {}), ...(section === 'then' || section === 'later' || section === 'reflection' ? { section } : {}) });
  }
  return out;
}

interface PublishedFollowupRow {
  version: typeof followupVersions.$inferSelect;
  caseStatus: (typeof followupCases.$inferSelect)['status'];
}

async function loadPublishedFollowup(
  db: Executor,
  sourceId: string,
): Promise<PublishedFollowupRow | undefined> {
  const rows = await db
    .select({ version: followupVersions, caseStatus: followupCases.status })
    .from(followupCases)
    .innerJoin(followupVersions, eq(followupVersions.id, followupCases.publishedVersionId))
    .where(and(eq(followupCases.sourceId, sourceId), eq(followupCases.status, 'published')))
    .limit(1);
  return rows[0];
}

/** The most recent withdrawn published version id for this source, if any. */
async function findWithdrawnFollowupVersion(
  db: Executor,
  sourceId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: followupVersions.id })
    .from(followupVersions)
    .innerJoin(followupCases, eq(followupCases.id, followupVersions.caseId))
    .where(and(eq(followupCases.sourceId, sourceId), eq(followupVersions.status, 'withdrawn')))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function buildPublicStory(
  db: Executor,
  source: SourceRow,
): Promise<PublicStory> {
  const snapshot = await latestSnapshot(db, source.id);
  const published = await loadPublishedFollowup(db, source.id);
  const withdrawnVersion = await findWithdrawnFollowupVersion(db, source.id);
  const withdrawn = !published && withdrawnVersion !== null;

  let publishedFollowup: PublicFollowup | null = null;
  if (published && published.version.status === 'published') {
    publishedFollowup = {
      version_id: published.version.id,
      statements: projectStatements(published.version.statements),
      confirmed_at: published.version.confirmedAt?.toISOString() ?? null,
      published_at: published.version.publishedAt?.toISOString() ?? null,
      ai_assisted: published.version.aiAssisted,
      attribution: 'author_reported',
    };
  }

  const isExact = snapshot?.materialLevel === 'exact_excerpt';
  return {
    ...await sourcePresentation(db,source.id,source.title,snapshot),
    site_counts:await siteCounts(db,source.id),
    source_id: source.id,
    title: source.title,
    source_type: source.sourceType,
    original_url: source.originalUrl,
    material_level: snapshot?.materialLevel ?? 'api_summary',
    // Only an exact_excerpt may be rendered as a verbatim quote.
    text: isExact ? (snapshot?.excerpt ?? null) : (snapshot?.body ?? null),
    excerpt_location: isExact ? (snapshot?.excerptLocation ?? null) : null,
    published_at: snapshot?.publishedAt?.toISOString() ?? null,
    upstream_updated_at: snapshot?.upstreamUpdatedAt?.toISOString() ?? null,
    acquired_at: snapshot?.acquiredAt?.toISOString() ?? null,
    provenance: source.provenance,
    published_followup: publishedFollowup,
    withdrawn,
  };
}

export interface StoryListPage {
  items: PublicStory[];
  total: number;
}

export async function listPublicStories(
  db: Executor,
  limit: number,
  offset: number,
  search: {q?:string;from?:string;to?:string;sort?:string} = {},
): Promise<StoryListPage> {
  // A revoked public-display consent removes the source from the public list
  // immediately, even before the publish module updates `permission_status`.
  const revokedConsent = db
    .select({ one: sql`1` })
    .from(consents)
    .where(
      and(
        eq(consents.sourceId, sources.id),
        eq(consents.purpose, 'demo_public_display'),
        eq(consents.status, 'granted'),
        sql`((${consents.expiresAt} is null and ${consents.grantedAt} > now() - interval '90 days') or ${consents.expiresAt} > now())`,
      ),
    );
  const publishedDate=sql`(select ss.published_at from source_snapshots ss where ss.source_id=${sources.id} order by ss.version desc limit 1)`;
  const searchable=sql`coalesce(${sources.title},'') || ' ' || coalesce((select coalesce(ss.excerpt,ss.body,'') from source_snapshots ss where ss.source_id=${sources.id} order by ss.version desc limit 1),'')`;
  const where = and(
    search.q ? sql`position(lower(${search.q}) in lower(${searchable})) > 0` : undefined,
    search.from ? sql`${publishedDate} >= ${search.from}::date` : undefined,
    search.to ? sql`${publishedDate} < ${search.to}::date + interval '1 day'` : undefined,
    eq(sources.permissionStatus, 'public_approved'),
    exists(revokedConsent),
    isNull(sources.deletedAt),
  );

  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sources)
    .where(where);
  const rows = await db
    .select()
    .from(sources)
    .where(where)
    .orderBy(search.sort==='oldest'?sql`${publishedDate} asc nulls last`:search.sort==='newest'?sql`${publishedDate} desc nulls last`:desc(sources.createdAt),sources.id)
    .limit(limit)
    .offset(offset);

  const items: PublicStory[] = [];
  for (const source of rows) {
    items.push(await buildPublicStory(db, source));
  }
  return { items, total: totalRows[0]?.count ?? 0 };
}

/** Public story by source id, or throws not_found when it is not licensed. */
export async function requirePublicStory(db: Executor, sourceId: string): Promise<PublicStory> {
  const source = await findSourceById(db, sourceId);
  if (!source) throw AppError.notFound('Story not found');
  if (!(await isPubliclyVisible(db, source))) throw AppError.notFound('Story not found');
  return buildPublicStory(db, source);
}

/* -------------------------------------------------------------------------- */
/* Reader interest                                                             */
/* -------------------------------------------------------------------------- */

export interface SetInterestResult {
  sourceId: string;
  active: boolean;
  updatedAt: Date;
}

/**
 * Idempotent follow/unfollow. `interests_reader_source_uq` guarantees exactly
 * one row per (reader_key, source_id), so concurrent clicks or retries cannot
 * create a second interest; a cancelled interest can be restored.
 */
export async function setInterest(
  ctx: ModuleContext,
  auth: AuthContext,
  sourceId: string,
  active: boolean,
): Promise<SetInterestResult> {
  return ctx.db.transaction(async tx => {
  await tx.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).for('update');
  const [actor] = await tx.select().from(users).where(eq(users.id, auth.userId)).for('share');
  if (!actor || actor.disabledAt) throw AppError.unauthorized('Account unavailable');
  const source = await findSourceById(tx, sourceId);
  if (!source || !(await isPubliclyVisible(tx, source))) {
    throw AppError.notFound('Story not found');
  }

  const now = ctx.now();
  const isAuthor = await isSourceAuthor(tx, source, auth.userId);
  // Test fixtures and excluded cohorts never enter research metrics, and an
  // author following their own source is not organic demand (PRD FR-05).
  const excluded =
    isExcludedCohort(auth.cohort) || isAuthor || source.provenance === 'test_fixture';

  const rows = await tx
    .insert(interests)
    .values({
      readerKey: auth.userId,
      sourceId,
      active,
      cohort: auth.cohort,
      triggeredBy: 'natural',
      excluded,
      cancelledAt: active ? null : now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [interests.readerKey, interests.sourceId],
      set: {
        active,
        cohort: auth.cohort,
        excluded,
        cancelledAt: active ? null : now,
        updatedAt: now,
      },
    })
    .returning({ updatedAt: interests.updatedAt });

  await writeResearchEvent(tx, {
    eventType: 'interest_changed',
    cohort: auth.cohort,
    readerKey: auth.userId,
    sourceId,
    properties: { active, triggered_by: 'natural', excluded },
  });

  return { sourceId, active, updatedAt: rows[0]?.updatedAt ?? now };
  });
}

export interface FollowingItem extends Partial<Presentation> {
  site_counts?:number[];
  text: string | null;
  source_id: string;
  available: boolean;
  followed_at: string;
  title: string | null;
  source_type: SourceType | null;
  original_url: string | null;
  material_level: MaterialLevel | null;
  published_at: string | null;
  update: FollowingUpdate | null;
}

export interface FollowingUpdate {
  version_id: string | null;
  status: 'published' | 'withdrawn';
  published_at: string | null;
  has_unread: boolean;
}

/**
 * The caller's own following list. Only public information is returned: no
 * rejection state, no private interview, no other reader's identity. A source
 * that is no longer public is reported as unavailable without its content.
 */
export async function listFollowing(
  db: Executor,
  auth: AuthContext,
  limit: number,
  offset: number,
): Promise<{ items: FollowingItem[]; total: number }> {
  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(interests)
    .where(and(eq(interests.readerKey, auth.userId), eq(interests.active, true)));

  const rows = await db
    .select({ interest: interests, source: sources })
    .from(interests)
    .innerJoin(sources, eq(sources.id, interests.sourceId))
    .where(and(eq(interests.readerKey, auth.userId), eq(interests.active, true)))
    .orderBy(desc(interests.updatedAt))
    .limit(limit)
    .offset(offset);

  const items: FollowingItem[] = [];
  for (const { interest, source } of rows) {
    const visible = await isPubliclyVisible(db, source);
    if (!visible) {
      items.push({
        source_id: source.id,
        available: false,
        text:null,
        followed_at: interest.updatedAt.toISOString(),
        title: null,
        source_type: null,
        original_url: null,
        material_level: null,
        published_at: null,
        update: null,
      });
      continue;
    }

    const snapshot = await latestSnapshot(db, source.id);
    const published = await loadPublishedFollowup(db, source.id);
    let update: FollowingUpdate | null = null;
    if (published && published.version.status === 'published') {
      const unread = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.readerKey, auth.userId),
            eq(notifications.followupVersionId, published.version.id),
            eq(notifications.status, 'unread'),
          ),
        )
        .limit(1);
      update = {
        version_id: published.version.id,
        status: 'published',
        published_at: published.version.publishedAt?.toISOString() ?? null,
        has_unread: unread.length > 0,
      };
    } else {
      const withdrawnVersionId = await findWithdrawnFollowupVersion(db, source.id);
      if (withdrawnVersionId) {
        update = {
          version_id: withdrawnVersionId,
          status: 'withdrawn',
          published_at: null,
          has_unread: false,
        };
      }
    }

    items.push({
      source_id: source.id,
      available: true,
      ...await sourcePresentation(db,source.id,source.title,snapshot),
    site_counts:await siteCounts(db,source.id),
      text:snapshot?.excerpt||snapshot?.body||null,
      followed_at: interest.updatedAt.toISOString(),
      title: source.title,
      source_type: source.sourceType,
      original_url: source.originalUrl,
      material_level: snapshot?.materialLevel ?? null,
      published_at: snapshot?.publishedAt?.toISOString() ?? null,
      update,
    });
  }

  return { items, total: totalRows[0]?.count ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* Audit / research events                                                     */
/* -------------------------------------------------------------------------- */

export interface AuditInput {
  actorUserId: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  properties?: Record<string, unknown>;
}

/** Audit rows never carry source bodies, excerpts or credentials. */
export async function writeAudit(db: Executor, input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    actorType: 'user',
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    properties: input.properties ?? {},
  });
}

export async function writeResearchEvent(
  db: Executor,
  input: {
    eventType: string;
    cohort: string;
    readerKey?: string | null;
    sourceId?: string | null;
    caseId?: string | null;
    properties?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(researchEvents).values({
    eventType: input.eventType,
    cohort: input.cohort,
    readerKey: input.readerKey ?? null,
    sourceId: input.sourceId ?? null,
    caseId: input.caseId ?? null,
    properties: input.properties ?? {},
  });
}

/** Exposed for tests/ops: whether a verified author link exists. */
export { isVerifiedAuthor };
