/**
 * AndThen (然后呢？) — physical data model.
 *
 * This file is the single source of truth for the Drizzle schema. SQL migrations
 * under ./migrations are generated from it via `pnpm db:generate` and applied by
 * `pnpm db:migrate`.
 *
 * Coverage map (PRD §15.1) — every logical entity has a physical table:
 *   users                        -> users
 *   sources                      -> sources
 *   source_snapshots             -> source_snapshots
 *   consents                     -> consents
 *   author_verifications         -> author_verifications
 *   interests                    -> interests
 *   followup_cases               -> followup_cases
 *   invitations                  -> invitations
 *   interview_sessions/messages  -> interview_sessions, interview_messages
 *   followup_versions            -> followup_versions
 *   notifications                -> notifications
 *   ai_runs / research_events    -> ai_runs, research_events
 *   deletion_jobs / audit_logs   -> deletion_jobs, audit_logs
 * Foundation-only tables (not in PRD, required by this backend):
 *   sessions, login_tokens, jobs, outbox, idempotency_keys, worker_heartbeats
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export interface AuthorMemoryRecord {
  name: string;
  description: string;
  content: string;
  sourceId: string;
  snapshotId: string;
  contentHash: string;
  preference: boolean;
  evidenceText: string;
  evidenceRef?: string;
  confirmedVersionId?: string;
}

export const authorMemories = pgTable('author_memories', {
  userId: uuid('user_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  generation: uuid('generation').notNull().defaultRandom(),
  status: text('status').notNull().default('empty'),
  records: jsonb('records').$type<AuthorMemoryRecord[]>().notNull().default([]),
  inputHash: text('input_hash'),
  errorCode: text('error_code'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

export const userRoleEnum = pgEnum('user_role', ['reader', 'author', 'researcher', 'admin']);

export const loginTokenPurposeEnum = pgEnum('login_token_purpose', [
  'bootstrap',
  'invitation',
  'author_binding',
]);

export const sourceTypeEnum = pgEnum('source_type', [
  'official_search',
  'author_paste',
  'researcher_import',
  'third_party_link',
]);

export const permissionStatusEnum = pgEnum('permission_status', [
  'pending',
  'private_only',
  'public_approved',
  'revoked',
  'rejected',
]);

/** PRD FR-02: only `exact_excerpt` may ever be shown as a verbatim quote. */
export const materialLevelEnum = pgEnum('material_level', [
  'exact_excerpt',
  'api_summary',
  'author_recollection',
  'ai_summary',
]);

export const consentPurposeEnum = pgEnum('consent_purpose', [
  /** Agreeing to a first-party anonymous reader session identifier (FR-04). */
  'reader_session',
  'private_interview',
  'external_model_processing',
  'demo_public_display',
  'video_display',
  'experience_index',
  'model_training',
]);

export const consentStatusEnum = pgEnum('consent_status', ['granted', 'revoked', 'expired']);

export const verificationMethodEnum = pgEnum('verification_method', ['oauth', 'manual']);
export const verificationStatusEnum = pgEnum('verification_status', ['pending', 'verified', 'rejected']);

/** PRD §13.1 business state machine. Execution state lives in `jobs.status`. */
export const caseStatusEnum = pgEnum('case_status', [
  'candidate',
  'hold',
  'eligible',
  'invite_recorded',
  'accepted',
  'declined',
  'expired',
  'interviewing',
  'paused',
  'draft',
  'stopped',
  'confirmed',
  'published',
  'withdrawn',
  'excluded',
]);

export const launchTypeEnum = pgEnum('launch_type', [
  'reader_initiated',
  'author_initiated',
  'pilot_preauthorized',
]);

export const invitationChannelEnum = pgEnum('invitation_channel', ['manual', 'email', 'other']);

/** PRD §13.1: "no reply" is NOT a decline; keep the distinction explicit. */
export const invitationResultEnum = pgEnum('invitation_result', [
  'pending',
  'no_response_in_window',
  'replied',
  'accepted',
  'declined',
]);

export const interviewModeEnum = pgEnum('interview_mode', ['ai', 'manual']);
export const interviewSessionStatusEnum = pgEnum('interview_session_status', [
  'active',
  'paused',
  'finished',
  'stopped',
]);
export const interviewMessageRoleEnum = pgEnum('interview_message_role', ['ai', 'author', 'system']);
export const generatedByEnum = pgEnum('generated_by', ['ai', 'manual', 'fallback_form']);

export const followupVersionStatusEnum = pgEnum('followup_version_status', [
  'draft',
  'confirmed',
  'published',
  'withdrawn',
  'superseded',
]);

export const notificationStatusEnum = pgEnum('notification_status', ['unread', 'read', 'withdrawn']);

export const aiTaskEnum = pgEnum('ai_task', [
  'ai_a_extract',
  'ai_b_interview',
  'ai_c_draft',
  'ai_d_val',
]);

/** Shared by `jobs.status` and `ai_runs.status` (PRD §13.2 execution states). */
export const executionStatusEnum = pgEnum('execution_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const outboxStatusEnum = pgEnum('outbox_status', [
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled',
]);

export const actorTypeEnum = pgEnum('actor_type', ['user', 'system', 'ai']);
export const deletionScopeEnum = pgEnum('deletion_scope', ['user', 'source', 'case', 'followup', 'interview']);

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Server-authoritative role. Clients can never self-report this. */
    role: userRoleEnum('role').notNull().default('reader'),
    /** Research cohort, maintained server-side only (PRD §16.2). */
    cohort: text('cohort').notNull().default('unassigned'),
    displayName: text('display_name'),
    email: text('email'),
    /** Opaque reference to a bound external account; never a credential. */
    externalAccountRef: text('external_account_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email).where(sql`${t.email} is not null`),
    index('users_role_idx').on(t.role),
    index('users_cohort_idx').on(t.cohort),
  ],
);

/**
 * Server-side sessions. Only the SHA-256 hash of the opaque bearer token is
 * stored; the raw token exists only in the client's hands.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    /** First 8 chars of the token, for human debugging only. Not a lookup key. */
    tokenPrefix: text('token_prefix').notNull(),
    cohort: text('cohort').notNull().default('unassigned'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_active_idx').on(t.expiresAt).where(sql`${t.revokedAt} is null`),
  ],
);

/**
 * One-time tokens minted by the bootstrap CLI / invitation flow. Exchanged for
 * a session via POST /api/auth/sessions. Stored hashed, single-use, expiring.
 */
export const loginTokens = pgTable(
  'login_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    purpose: loginTokenPurposeEnum('purpose').notNull().default('bootstrap'),
    /** Optional case binding for invitation tokens (locates a case, grants nothing). */
    caseId: uuid('case_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('login_tokens_token_hash_uq').on(t.tokenHash),
    index('login_tokens_user_idx').on(t.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Sources & evidence (FR-01..FR-03)                                           */
/* -------------------------------------------------------------------------- */

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: sourceTypeEnum('source_type').notNull(),
    originalUrl: text('original_url'),
    originalAccountRef: text('original_account_ref'),
    title: text('title'),
    permissionStatus: permissionStatusEnum('permission_status').notNull().default('pending'),
    /** test_fixture | real_authorized | team_material — keeps demo data isolated. */
    provenance: text('provenance').notNull().default('test_fixture'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sources_permission_idx').on(t.permissionStatus),
    index('sources_provenance_idx').on(t.provenance),
  ],
);

/** Immutable snapshots. `published_at` (source) and `acquired_at` are distinct. */
export const sourceSnapshots = pgTable(
  'source_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    materialLevel: materialLevelEnum('material_level').notNull(),
    /** Full body when the license allows storing it. */
    body: text('body'),
    /** Exact excerpt only meaningful when materialLevel = exact_excerpt. */
    excerpt: text('excerpt'),
    excerptLocation: text('excerpt_location'),
    contentHash: text('content_hash').notNull(),
    /** When the source was originally published (may be null = unknown). */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** When the source itself was last updated upstream (may be null = unknown). */
    upstreamUpdatedAt: timestamp('upstream_updated_at', { withTimezone: true }),
    /** When we acquired this snapshot. Never conflate with publishedAt. */
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('source_snapshots_source_version_uq').on(t.sourceId, t.version),
    index('source_snapshots_source_idx').on(t.sourceId),
  ],
);

/** Per-purpose consent (PRD §15.2: authorization is never derived from login). */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
    purpose: consentPurposeEnum('purpose').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: consentStatusEnum('status').notNull().default('granted'),
    version: text('version').notNull().default('v1'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('consents_user_source_purpose_version_uq').on(
      t.userId,
      t.sourceId,
      t.purpose,
      t.version,
    ),
    index('consents_source_idx').on(t.sourceId),
  ],
);

export const authorVerifications = pgTable(
  'author_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    method: verificationMethodEnum('method').notNull(),
    status: verificationStatusEnum('status').notNull().default('pending'),
    /** Reference to controlled evidence (never the evidence body itself). */
    evidenceRef: text('evidence_ref'),
    verifierUserId: uuid('verifier_user_id').references(() => users.id, { onDelete: 'set null' }),
    scope: text('scope'),
    notes: text('notes'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('author_verifications_source_idx').on(t.sourceId),
    index('author_verifications_user_idx').on(t.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Reader interest (FR-04..FR-06)                                              */
/* -------------------------------------------------------------------------- */

export const interests = pgTable(
  'interests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Demo account id or first-party random session key. Never a fingerprint. */
    readerKey: text('reader_key').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    active: boolean('active').notNull().default(true),
    cohort: text('cohort').notNull().default('unassigned'),
    triggeredBy: text('triggered_by').notNull().default('natural'),
    reasonChoice: text('reason_choice'),
    reasonText: text('reason_text'),
    reasonTag: text('reason_tag'),
    /** Team/demo/pressure-test rows are excluded from research metrics. */
    excluded: boolean('excluded').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('interests_reader_source_uq').on(t.readerKey, t.sourceId),
    index('interests_source_active_idx').on(t.sourceId, t.active),
  ],
);

/* -------------------------------------------------------------------------- */
/* Follow-up cases & invitations (FR-07..FR-11)                                */
/* -------------------------------------------------------------------------- */

export const followupCases = pgTable(
  'followup_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: caseStatusEnum('status').notNull().default('candidate'),
    launchType: launchTypeEnum('launch_type').notNull().default('reader_initiated'),
    /** Once declined / do-not-contact, automatic re-invitation is blocked. */
    declineFlag: boolean('decline_flag').notNull().default(false),
    doNotContact: boolean('do_not_contact').notNull().default(false),
    reviewerRequired: boolean('reviewer_required').notNull().default(false),
    /**
     * Currently published followup_versions.id. Deliberately a plain uuid (no
     * DB-level FK) to avoid a circular FK with followup_versions.case_id;
     * enforced by the publish transaction and asserted in tests.
     */
    publishedVersionId: uuid('published_version_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('followup_cases_source_idx').on(t.sourceId),
    index('followup_cases_author_idx').on(t.authorUserId),
    index('followup_cases_status_idx').on(t.status),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => followupCases.id, { onDelete: 'cascade' }),
    channel: invitationChannelEnum('channel').notNull().default('manual'),
    /** Human who actually sent it. Records a send, never a read receipt. */
    sentByUserId: uuid('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    observationDeadline: timestamp('observation_deadline', { withTimezone: true }),
    result: invitationResultEnum('result').notNull().default('pending'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    consentVersion: text('consent_version'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invitations_case_idx').on(t.caseId),
    index('invitations_result_idx').on(t.result),
  ],
);

/* -------------------------------------------------------------------------- */
/* Interviews (FR-12..FR-16)                                                   */
/* -------------------------------------------------------------------------- */

export const interviewSessions = pgTable(
  'interview_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => followupCases.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: interviewModeEnum('mode').notNull().default('ai'),
    snapshotId: uuid('snapshot_id').references(() => sourceSnapshots.id, { onDelete: 'set null' }),
    revision: integer('revision').notNull().default(1),
    status: interviewSessionStatusEnum('status').notNull().default('active'),
    /** Default 5 main questions; clarifications count against the budget. */
    budgetMainQuestions: integer('budget_main_questions').notNull().default(5),
    questionsAsked: integer('questions_asked').notNull().default(0),
    stopReason: text('stop_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('interview_sessions_case_idx').on(t.caseId),
    index('interview_sessions_owner_idx').on(t.ownerUserId),
    // At most one live session per case.
    uniqueIndex('interview_sessions_case_active_uq')
      .on(t.caseId)
      .where(sql`${t.status} in ('active','paused')`),
  ],
);

export const interviewMessages = pgTable(
  'interview_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => interviewSessions.id, { onDelete: 'cascade' }),
    role: interviewMessageRoleEnum('role').notNull(),
    sequence: integer('sequence').notNull(),
    question: text('question'),
    purpose: text('purpose'),
    basisRefs: jsonb('basis_refs').$type<string[]>().notNull().default([]),
    authorMessage: text('author_message'),
    visibility: text('visibility').notNull().default('private'),
    skipped: boolean('skipped').notNull().default(false),
    stopReason: text('stop_reason'),
    generatedBy: generatedByEnum('generated_by').notNull().default('manual'),
    /** Client-supplied idempotency key; unique per session when present. */
    clientMessageId: text('client_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('interview_messages_session_seq_uq').on(t.sessionId, t.sequence),
    uniqueIndex('interview_messages_client_id_uq')
      .on(t.sessionId, t.clientMessageId)
      .where(sql`${t.clientMessageId} is not null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Drafts / versions (FR-17..FR-20)                                            */
/* -------------------------------------------------------------------------- */

export const followupVersions = pgTable(
  'followup_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => followupCases.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: followupVersionStatusEnum('status').notNull().default('draft'),
    snapshotId: uuid('snapshot_id').references(() => sourceSnapshots.id, { onDelete: 'set null' }),
    interviewId: uuid('interview_id').references(() => interviewSessions.id, { onDelete: 'set null' }),
    /** statements[]: { id, text, kind, evidence_refs[], visibility } */
    statements: jsonb('statements').$type<unknown[]>().notNull().default([]),
    unresolvedItems: jsonb('unresolved_items').$type<unknown[]>().notNull().default([]),
    authorEdits: jsonb('author_edits').$type<unknown[]>().notNull().default([]),
    authorConfirmations: jsonb('author_confirmations').$type<unknown[]>().notNull().default([]),
    contentHash: text('content_hash').notNull(),
    aiAssisted: boolean('ai_assisted').notNull().default(false),
    privatePurgedAt: timestamp('private_purged_at', { withTimezone: true }),
    contentPurgedAt: timestamp('content_purged_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('followup_versions_case_version_uq').on(t.caseId, t.version),
    index('followup_versions_case_status_idx').on(t.caseId, t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Reader notifications (FR-06, FR-19)                                         */
/* -------------------------------------------------------------------------- */

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    readerKey: text('reader_key').notNull(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => followupCases.id, { onDelete: 'cascade' }),
    followupVersionId: uuid('followup_version_id')
      .notNull()
      .references(() => followupVersions.id, { onDelete: 'cascade' }),
    status: notificationStatusEnum('status').notNull().default('unread'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    // One notification per (reader, published version) — no duplicate fan-out.
    uniqueIndex('notifications_reader_version_uq').on(t.readerKey, t.followupVersionId),
    index('notifications_reader_status_idx').on(t.readerKey, t.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* AI runs / research / audit / deletion                                       */
/* -------------------------------------------------------------------------- */

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    task: aiTaskEnum('task').notNull(),
    status: executionStatusEnum('status').notNull().default('queued'),
    jobId: uuid('job_id'),
    caseId: uuid('case_id').references(() => followupCases.id, { onDelete: 'set null' }),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    interviewSessionId: uuid('interview_session_id').references(() => interviewSessions.id, {
      onDelete: 'set null',
    }),
    modelId: text('model_id'),
    promptVersion: text('prompt_version'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    requestId: text('request_id'),
    errorCode: text('error_code'),
    output: jsonb('output').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('ai_runs_task_status_idx').on(t.task, t.status),
    index('ai_runs_case_idx').on(t.caseId),
  ],
);

export const researchEvents = pgTable(
  'research_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    cohort: text('cohort').notNull().default('unassigned'),
    readerKey: text('reader_key'),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    caseId: uuid('case_id').references(() => followupCases.id, { onDelete: 'set null' }),
    followupVersionId: uuid('followup_version_id').references(() => followupVersions.id, {
      onDelete: 'set null',
    }),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('research_events_type_idx').on(t.eventType),
    index('research_events_cohort_idx').on(t.cohort),
    index('research_events_occurred_idx').on(t.occurredAt),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorType: actorTypeEnum('actor_type').notNull().default('user'),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id'),
    caseId: uuid('case_id').references(() => followupCases.id, { onDelete: 'set null' }),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_subject_idx').on(t.subjectType, t.subjectId),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);

export const deletionJobs = pgTable(
  'deletion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: deletionScopeEnum('scope').notNull(),
    subjectId: text('subject_id').notNull(),
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: executionStatusEnum('status').notNull().default('queued'),
    reason: text('reason'),
    /** Per-step progress: [{ step, status, at }] */
    steps: jsonb('steps').$type<unknown[]>().notNull().default([]),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('deletion_jobs_status_idx').on(t.status)],
);

/* -------------------------------------------------------------------------- */
/* Infrastructure: job queue, outbox, idempotency, heartbeats                   */
/* -------------------------------------------------------------------------- */

/**
 * Durable job queue.
 *
 * Concurrency contract:
 *  - claim: short transaction, `FOR UPDATE SKIP LOCKED`, sets status=running,
 *    lease_owner, lease_expires_at, attempts+1, fencing_token+1.
 *  - completion: `UPDATE ... WHERE id=$1 AND fencing_token=$2 AND status='running'`.
 *    A stale worker (whose lease expired and was reclaimed) matches 0 rows and
 *    its result is rejected.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    status: executionStatusEnum('status').notNull().default('queued'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    priority: integer('priority').notNull().default(0),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    fencingToken: bigint('fencing_token', { mode: 'number' }).notNull().default(0),
    /**
     * Serialization key. A partial unique index keeps at most one active job
     * per key (e.g. `interview:<sessionId>:generate`), so the same interview
     * cannot run two generations at once.
     */
    dedupeKey: text('dedupe_key'),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.runAt, t.priority),
    index('jobs_lease_idx').on(t.status, t.leaseExpiresAt),
    uniqueIndex('jobs_dedupe_active_uq')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} in ('queued','running')`),
  ],
);

/**
 * Transactional outbox. `recipients` is frozen at enqueue time so a later
 * interest cancellation cannot retroactively alter who receives an update.
 * `(topic, dedupe_key)` is unique: retrying a publish never double-notifies.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic: text('topic').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** Frozen recipient snapshot: [{ readerKey, cohort }] */
    recipients: jsonb('recipients').$type<unknown[]>().notNull().default([]),
    status: outboxStatusEnum('status').notNull().default('pending'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    fencingToken: bigint('fencing_token', { mode: 'number' }).notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('outbox_topic_dedupe_uq').on(t.topic, t.dedupeKey),
    index('outbox_claim_idx').on(t.status, t.availableAt),
  ],
);

/** Idempotency ledger for write endpoints (PRD §16.1). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('idempotency_scope_key_uq').on(t.scope, t.key)],
);

/** Liveness/observability for workers. */
export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  kind: text('kind').notNull().default('worker'),
  version: text('version'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
});

/* -------------------------------------------------------------------------- */
/* Inferred row types (shared across modules)                                  */
/* -------------------------------------------------------------------------- */

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type LoginTokenRow = typeof loginTokens.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;
export type SourceSnapshotRow = typeof sourceSnapshots.$inferSelect;
export type ConsentRow = typeof consents.$inferSelect;
export type AuthorVerificationRow = typeof authorVerifications.$inferSelect;
export type InterestRow = typeof interests.$inferSelect;
export type FollowupCaseRow = typeof followupCases.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type InterviewSessionRow = typeof interviewSessions.$inferSelect;
export type InterviewMessageRow = typeof interviewMessages.$inferSelect;
export type FollowupVersionRow = typeof followupVersions.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type AiRunRow = typeof aiRuns.$inferSelect;
export type ResearchEventRow = typeof researchEvents.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type DeletionJobRow = typeof deletionJobs.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type OutboxRow = typeof outbox.$inferSelect;
export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type WorkerHeartbeatRow = typeof workerHeartbeats.$inferSelect;

export interface ZhihuComment {
  id: string;
  text: string;
  created_at_seconds: string;
  likes: string;
  author_url: string | null;
  root_id: string | null;
  reply_id: string | null;
}
/** One-way official comment cache, never interview evidence or a write-back queue. */
export const zhihuCommentSyncs = pgTable('zhihu_comment_syncs', {
  sourceId: uuid('source_id').primaryKey().references(() => sources.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(1),
  offset: text('offset').notNull().default('0'),
  items: jsonb('items').$type<ZhihuComment[]>().notNull().default([]),
  isEnd: boolean('is_end').notNull().default(false),
  stoppedReason: text('stopped_reason'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface OfficialCandidate {
  url: string; title: string; text: string; author_name: string;
  author_avatar: string | null; author_url: null;
  material_level: 'api_summary'; comments: string[]; comments_coverage: 'selected';
}
export const discoveryCandidates = pgTable('discovery_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull().unique(),
  data: jsonb('data').$type<OfficialCandidate>().notNull(),
  sourceId: uuid('source_id').references(()=>sources.id,{onDelete:'cascade'}),
  snapshotId: uuid('snapshot_id').references(()=>sourceSnapshots.id,{onDelete:'set null'}),
  updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});

/** Local discovery audit. Never confers source processing or publication consent. */
export const discoveryRuns = pgTable('discovery_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  slot: text('slot').notNull().unique(),
  query: text('query').notNull(),
  status: text('status').notNull(),
  counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
  errorCode: text('error_code'),
  startedAt: timestamp('started_at', {withTimezone:true}).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', {withTimezone:true}),
});
export const discoverySelections = pgTable('discovery_selections', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull().unique(),
  runId: uuid('run_id').notNull().references(()=>discoveryRuns.id),
  candidateId: uuid('candidate_id').references(()=>discoveryCandidates.id,{onDelete:'cascade'}),
  data: jsonb('data').$type<OfficialCandidate>().notNull(),
  decision: text('decision').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
/** Post-scoped preparation is not an author profile and has no nickname identity. */
export const sourcePreparations = pgTable('source_preparations', {
  sourceId: uuid('source_id').primaryKey().references(()=>sources.id,{onDelete:'cascade'}),
  snapshotId: uuid('snapshot_id').notNull().references(()=>sourceSnapshots.id,{onDelete:'cascade'}),
  generation: uuid('generation').notNull().defaultRandom(),
  status: text('status').notNull().default('pending'),
  records: jsonb('records').$type<AuthorMemoryRecord[]>().notNull().default([]),
  updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});

/** OAuth binding attempts contain hashes only, never codes or provider tokens. */
export const zhihuOAuthAttempts = pgTable('zhihu_oauth_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  stateHash: text('state_hash').notNull().unique(),
  browserHash: text('browser_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  completedUserId: uuid('completed_user_id').references(() => users.id, { onDelete: 'cascade' }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
}, t => [index('zhihu_oauth_attempts_expiry_idx').on(t.expiresAt)]);

export const zhihuAccounts = pgTable('zhihu_accounts', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  uid: text('uid').notNull().unique(),
  displayName: text('display_name'),
  tokenCiphertext: text('token_ciphertext'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  syncConsentAt: timestamp('sync_consent_at', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
});

export const storyReactions = pgTable('story_reactions', {
 id: uuid('id').primaryKey().defaultRandom(),
 sourceId: uuid('source_id').notNull().references(()=>sources.id,{onDelete:'cascade'}),
 userId: uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
 liked: boolean('liked').notNull().default(false),
 saved: boolean('saved').notNull().default(false),
 updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('story_reactions_source_user_uq').on(t.sourceId,t.userId)]);
export const siteComments = pgTable('site_comments', {
  replyTo: uuid('reply_to'),
 id: uuid('id').primaryKey().defaultRandom(),
 sourceId: uuid('source_id').notNull().references(()=>sources.id,{onDelete:'cascade'}),
 userId: uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
 clientMessageId: uuid('client_message_id').notNull(),
 body: text('body').notNull(),
 createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('site_comments_message_uq').on(t.userId,t.clientMessageId),index('site_comments_source_idx').on(t.sourceId,t.createdAt)]);
export const siteReports = pgTable('site_reports', {
 id: uuid('id').primaryKey().defaultRandom(),
 sourceId: uuid('source_id').notNull().references(()=>sources.id,{onDelete:'cascade'}),
 userId: uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
 clientMessageId: uuid('client_message_id').notNull(),
 reason: text('reason').notNull(),
 createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('site_reports_message_uq').on(t.userId,t.clientMessageId)]);

export const siteFeedback = pgTable('site_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientMessageId: uuid('client_message_id').notNull(),
  category: text('category').notNull(),
  body: text('body').notNull(),
  page: text('page').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('site_feedback_message_uq').on(table.clientMessageId)]);

export const coverCatalog = pgTable('cover_catalog', {
 id:text('id').primaryKey(),category:text('category').notNull(),tags:jsonb('tags').$type<string[]>().notNull(),
 alt:text('alt').notNull(),sourceUrl:text('source_url'),imageUrl:text('image_url'),status:text('status').notNull().default('pending_asset'),
});

export const storyReads = pgTable('story_reads', {
 userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
 sourceId:uuid('source_id').notNull().references(()=>sources.id,{onDelete:'cascade'}),
 readAt:timestamp('read_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('story_reads_user_source_uq').on(t.userId,t.sourceId)]);

export const schema = {
  storyReads,
  coverCatalog,
  storyReactions, siteComments, siteReports, siteFeedback,
  zhihuAccounts,
  zhihuOAuthAttempts,
  users,
  sessions,
  loginTokens,
  sources,
  sourceSnapshots,
  consents,
  authorVerifications,
  interests,
  followupCases,
  invitations,
  interviewSessions,
  interviewMessages,
  followupVersions,
  notifications,
  aiRuns,
  researchEvents,
  auditLogs,
  deletionJobs,
  jobs,
  outbox,
  idempotencyKeys,
  workerHeartbeats,
  zhihuCommentSyncs,
  discoveryCandidates,
  sourcePreparations,
};
