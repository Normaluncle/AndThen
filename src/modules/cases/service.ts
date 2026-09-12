/**
 * Cases module service (PRD §9, §10, §13; FR-07..FR-11).
 *
 * Owns the follow-up case lifecycle that this worktree is responsible for:
 * creation, reading, human invitation *records* (never an actual send) and the
 * author's accept/decline/do-not-contact decision. Interview sessions, drafts
 * and publishing are other modules.
 *
 * Safety rules encoded here:
 *  - an invitation is a record of a human send; the system never contacts
 *    anyone and never re-invites after a decline;
 *  - one case per source; a declined case can never be silently re-opened;
 *  - only the bound author may decide, and only the assigned researcher (or an
 *    admin) may see or invite on a case.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { followupCases, invitations, sources } from '../../db/schema.js';
import type { FollowupCaseRow, InvitationRow, SourceRow } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import type { AuthContext, ModuleContext } from '../../shared/types.js';
import { resolveSourceAccess, isVerifiedAuthor } from '../sources/access.js';
import { writeAudit, writeResearchEvent } from '../sources/service.js';

export type CaseStatus = FollowupCaseRow['status'];
export type LaunchType = FollowupCaseRow['launchType'];
export type Decision = 'accept' | 'decline' | 'do_not_contact';

export interface CreateCaseInput {
  sourceId: string;
  launchType: LaunchType;
}

export interface CreateCaseResult {
  followupCase: FollowupCaseRow;
  deduped: boolean;
}

/** Statuses a decision may act on (PRD §13.1). */
const DECIDABLE_STATUSES: ReadonlySet<CaseStatus> = new Set([
  'candidate',
  'hold',
  'eligible',
  'invite_recorded',
  'accepted',
  'expired',
  'stopped',
]);

/** Statuses an invitation may be recorded from (PRD §13.1: hold does not invite). */
const INVITABLE_STATUSES: ReadonlySet<CaseStatus> = new Set(['candidate', 'eligible']);

/**
 * A source is authorized enough to open a workable case once it is private or
 * public. `pending` (an unreviewed third-party link / search candidate) and
 * `revoked`/`rejected` material are not — the case stays on hold (PRD FR-07
 * gate 1, FR-01: a third-party link does not directly start an invitation).
 */
function isSourceAuthorizedForCase(permissionStatus: SourceRow['permissionStatus']): boolean {
  return permissionStatus === 'private_only' || permissionStatus === 'public_approved';
}

async function requireSource(db: Executor, sourceId: string): Promise<SourceRow> {
  const rows = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  const source = rows[0];
  if (!source) throw AppError.notFound('Source not found');
  return source;
}

/**
 * Create the single case for a source. Authors may only create a case for a
 * source they author; research/ops may register a controlled subject. The
 * source row is locked so concurrent creates cannot both insert.
 */
export async function createCase(
  ctx: ModuleContext,
  auth: AuthContext,
  input: CreateCaseInput,
): Promise<CreateCaseResult> {
  if (auth.role === 'reader') throw AppError.forbidden('Readers cannot create a case');

  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    // Serialize per source without a schema change.
    await tx.execute(sql`select id from sources where id = ${input.sourceId} for update`);
    const source = await requireSource(tx, input.sourceId);

    if (auth.role === 'author') {
      const access = await resolveSourceAccess(tx, source, auth);
      if (!access.isAuthor) {
        throw AppError.forbidden('You may only open a case for a source you author');
      }
    }

    const existing = await tx
      .select()
      .from(followupCases)
      .where(eq(followupCases.sourceId, input.sourceId))
      .orderBy(desc(followupCases.createdAt))
      .limit(1);
    const current = existing[0];
    if (current) {
      // A declined / do-not-contact case is never automatically re-opened.
      if (current.declineFlag || current.doNotContact) {
        throw AppError.conflict('This case was declined and will not be re-opened automatically');
      }
      const canSee =
        auth.role === 'admin' ||
        current.createdByUserId === auth.userId ||
        current.authorUserId === auth.userId;
      if (!canSee) {
        throw AppError.conflict('A case already exists for this source');
      }
      return { followupCase: current, deduped: true };
    }

    const access = await resolveSourceAccess(tx, source, auth);
    const authorUserId = access.isAuthor ? auth.userId : null;

    const inserted = await tx
      .insert(followupCases)
      .values({
        sourceId: input.sourceId,
        authorUserId,
        // Insufficient authorization keeps the case on hold rather than
        // eligible for contact (PRD FR-07 gate 1).
        status: isSourceAuthorizedForCase(source.permissionStatus) ? 'candidate' : 'hold',
        launchType: input.launchType,
        createdByUserId: auth.userId,
      })
      .returning();
    const followupCase = inserted[0];
    if (!followupCase) throw AppError.internal('Failed to create case');

    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'case.created',
      subjectType: 'case',
      subjectId: followupCase.id,
      properties: { source_id: input.sourceId, launch_type: input.launchType },
    });
    await writeResearchEvent(tx, {
      eventType: 'case_created',
      cohort: auth.cohort,
      sourceId: input.sourceId,
      caseId: followupCase.id,
      properties: { launch_type: input.launchType },
    });

    return { followupCase, deduped: false };
  });
}

export interface CaseAccess {
  isAssignedResearcher: boolean;
  isAdmin: boolean;
  isBoundAuthor: boolean;
}

function caseAccess(followupCase: FollowupCaseRow, auth: AuthContext): CaseAccess {
  return {
    isAssignedResearcher:
      followupCase.createdByUserId === auth.userId || followupCase.authorUserId === auth.userId,
    isAdmin: auth.role === 'admin',
    isBoundAuthor: followupCase.authorUserId === auth.userId,
  };
}

/** Loads a case the caller may read, or throws not_found (no existence leak). */
export async function requireReadableCase(
  db: Executor,
  auth: AuthContext,
  caseId: string,
): Promise<FollowupCaseRow> {
  const rows = await db.select().from(followupCases).where(eq(followupCases.id, caseId)).limit(1);
  const followupCase = rows[0];
  if (!followupCase) throw AppError.notFound('Case not found');
  const access = caseAccess(followupCase, auth);
  if (!access.isAdmin && !access.isAssignedResearcher) throw AppError.notFound('Case not found');
  return followupCase;
}

export interface CaseInvitationSummary {
  id: string;
  channel: InvitationRow['channel'];
  sent_at: string;
  observation_deadline: string | null;
  result: InvitationRow['result'];
}

export interface CaseDetail {
  followupCase: FollowupCaseRow;
  source: {
    id: string;
    title: string | null;
    source_type: SourceRow['sourceType'];
    permission_status: SourceRow['permissionStatus'];
    provenance: string;
  };
  author_bound: boolean;
  author_verified: boolean;
  invitations: CaseInvitationSummary[];
}

export async function getCaseDetail(
  db: Executor,
  auth: AuthContext,
  caseId: string,
): Promise<CaseDetail> {
  const followupCase = await requireReadableCase(db, auth, caseId);
  const source = await requireSource(db, followupCase.sourceId);
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.caseId, caseId))
    .orderBy(desc(invitations.sentAt));

  const authorVerified = followupCase.authorUserId
    ? await isVerifiedAuthor(db, followupCase.sourceId, followupCase.authorUserId)
    : false;

  return {
    followupCase,
    source: {
      id: source.id,
      title: source.title,
      source_type: source.sourceType,
      permission_status: source.permissionStatus,
      provenance: source.provenance,
    },
    author_bound: followupCase.authorUserId !== null,
    author_verified: authorVerified,
    invitations: rows.map((i) => ({
      id: i.id,
      channel: i.channel,
      sent_at: i.sentAt.toISOString(),
      observation_deadline: i.observationDeadline?.toISOString() ?? null,
      result: i.result,
    })),
  };
}

export interface RecordInvitationInput {
  channel: InvitationRow['channel'];
  sentAt: Date | null;
  observationDeadline: Date | null;
  consentVersion: string | null;
  notes: string | null;
}

export interface RecordInvitationResult {
  invitation: InvitationRow;
  caseStatus: CaseStatus;
  deduped: boolean;
}

/**
 * Record that a human sent one invitation. This endpoint never sends anything
 * itself. At most one invitation exists per case (one per author, PRD FR-09),
 * and a declined / do-not-contact case can never receive another.
 */
export async function recordInvitation(
  ctx: ModuleContext,
  auth: AuthContext,
  caseId: string,
  input: RecordInvitationInput,
): Promise<RecordInvitationResult> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select id from followup_cases where id = ${caseId} for update`);
    const rows = await tx.select().from(followupCases).where(eq(followupCases.id, caseId)).limit(1);
    const followupCase = rows[0];
    if (!followupCase) throw AppError.notFound('Case not found');

    const access = caseAccess(followupCase, auth);
    // Only the responsible researcher (or an admin) may record an invitation.
    if (!access.isAdmin && followupCase.createdByUserId !== auth.userId) {
      throw AppError.notFound('Case not found');
    }

    if (followupCase.declineFlag || followupCase.doNotContact) {
      throw AppError.conflict('The author declined contact; no further invitation may be recorded');
    }
    if (followupCase.status === 'withdrawn' || followupCase.status === 'excluded') {
      throw AppError.conflict('This case is closed to further invitations');
    }

    const existing = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.caseId, caseId))
      .orderBy(desc(invitations.sentAt))
      .limit(1);
    if (existing[0]) {
      // Idempotent: a repeat submission records nothing new.
      return { invitation: existing[0], caseStatus: followupCase.status, deduped: true };
    }

    if (!INVITABLE_STATUSES.has(followupCase.status)) {
      throw AppError.conflict(
        `A case in status ${followupCase.status} is not open to an invitation`,
      );
    }
    const source = await requireSource(tx, followupCase.sourceId);
    if (!isSourceAuthorizedForCase(source.permissionStatus)) {
      throw AppError.conflict(
        'Source authorization is insufficient to invite; the case stays on hold',
      );
    }

    const inserted = await tx
      .insert(invitations)
      .values({
        caseId,
        channel: input.channel,
        sentByUserId: auth.userId,
        sentAt: input.sentAt ?? now,
        observationDeadline: input.observationDeadline,
        result: 'pending',
        consentVersion: input.consentVersion,
        notes: input.notes,
      })
      .returning();
    const invitation = inserted[0];
    if (!invitation) throw AppError.internal('Failed to record invitation');

    let caseStatus: CaseStatus = followupCase.status;
    if (['candidate', 'eligible'].includes(followupCase.status)) {
      const updated = await tx
        .update(followupCases)
        .set({ status: 'invite_recorded', updatedAt: now })
        .where(eq(followupCases.id, caseId))
        .returning({ status: followupCases.status });
      caseStatus = updated[0]?.status ?? 'invite_recorded';
    }

    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'invitation.recorded',
      subjectType: 'case',
      subjectId: caseId,
      properties: { channel: input.channel, case_status: caseStatus },
    });
    await writeResearchEvent(tx, {
      eventType: 'invitation_recorded',
      cohort: auth.cohort,
      caseId,
      properties: { channel: input.channel, result: 'pending' },
    });

    return { invitation, caseStatus, deduped: false };
  });
}

export interface DecisionResult {
  followupCase: FollowupCaseRow;
  decision: Decision;
}

/**
 * The bound author's decision. Only `request.auth.userId === authorUserId` may
 * act — a forwarded invitation link or another session cannot decide for them.
 * Accepting is not a publishing consent; it only moves the case forward.
 */
export async function recordDecision(
  ctx: ModuleContext,
  auth: AuthContext,
  caseId: string,
  decision: Decision,
): Promise<DecisionResult> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select id from followup_cases where id = ${caseId} for update`);
    const rows = await tx.select().from(followupCases).where(eq(followupCases.id, caseId)).limit(1);
    const followupCase = rows[0];
    if (!followupCase) throw AppError.notFound('Case not found');

    if (followupCase.authorUserId !== auth.userId) {
      // Uniform not_found: an unrelated user cannot probe case state.
      throw AppError.notFound('Case not found');
    }

    if (decision === 'accept') {
      if (followupCase.declineFlag || followupCase.doNotContact) {
        throw AppError.conflict('This case was declined and cannot be re-opened automatically');
      }
      if (!DECIDABLE_STATUSES.has(followupCase.status)) {
        throw AppError.conflict(`Cannot accept a case in status ${followupCase.status}`);
      }
    } else if (followupCase.status === 'published' || followupCase.status === 'withdrawn') {
      throw AppError.conflict('A published or withdrawn case cannot be declined here');
    }

    const status: CaseStatus = decision === 'accept' ? 'accepted' : 'declined';
    const declineFlag = decision !== 'accept';
    const doNotContact = decision === 'do_not_contact';

    const updated = await tx
      .update(followupCases)
      .set({
        status,
        declineFlag: followupCase.declineFlag || declineFlag,
        doNotContact: followupCase.doNotContact || doNotContact,
        updatedAt: now,
      })
      .where(eq(followupCases.id, caseId))
      .returning();
    const result = updated[0];
    if (!result) throw AppError.internal('Failed to record decision');

    if (declineFlag) {
      await tx
        .update(invitations)
        .set({ result: 'declined' })
        .where(and(eq(invitations.caseId, caseId), eq(invitations.result, 'pending')));
    } else {
      await tx
        .update(invitations)
        .set({ result: 'accepted' })
        .where(and(eq(invitations.caseId, caseId), eq(invitations.result, 'pending')));
    }

    await writeAudit(tx, {
      actorUserId: auth.userId,
      action: 'case.decision',
      subjectType: 'case',
      subjectId: caseId,
      properties: { decision, status },
    });
    await writeResearchEvent(tx, {
      eventType: decision === 'accept' ? 'accepted' : 'contact_declined',
      cohort: auth.cohort,
      caseId,
      properties: { decision, do_not_contact: doNotContact },
    });

    return { followupCase: result, decision };
  });
}
