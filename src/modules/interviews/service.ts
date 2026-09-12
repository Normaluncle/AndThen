import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../../db/client.js';
import { followupCases, interviewSessions, interviewMessages, sources, sourceSnapshots } from '../../db/schema.js';
import type { AuthContext, ModuleContext } from '../../shared/types.js';
import { AppError } from '../../http/errors.js';
import { hasActiveConsent, isVerifiedAuthor } from '../sources/access.js';
import { createLlmClient } from '../../ai/client.js';
import { AI_JOB_KINDS, interviewGenerateDedupeKey } from '../../ai/tasks.js';

export const messageInput = z.object({
  message: z.string().trim().min(1).max(8000).optional(),
  skip: z.boolean().default(false),
  visibility: z.enum(['private', 'public']).default('private'),
  client_message_id: z.string().min(1).max(128),
  expected_version: z.number().int().positive(),
}).strict().refine(x => x.skip ? !x.message : !!x.message, 'Supply either a message or skip');

/** Lock order is source -> case -> interview for every user mutation. */
export async function lockCase(db: Executor, caseId: string) {
  const [initial] = await db.select().from(followupCases).where(eq(followupCases.id, caseId));
  if (!initial) throw AppError.notFound('Case not found');
  const [source] = await db.select().from(sources).where(eq(sources.id, initial.sourceId)).for('update');
  if (!source || source.deletedAt) throw AppError.withdrawn();
  const [caseRow] = await db.select().from(followupCases).where(eq(followupCases.id, caseId)).for('update');
  if (!caseRow) throw AppError.notFound();
  return { source, caseRow };
}

export async function requireCaseAuthor(db: Executor, caseId: string, auth: AuthContext) {
  const state = await lockCase(db, caseId);
  if (state.caseRow.authorUserId !== auth.userId) throw AppError.forbidden();
  if (!await isVerifiedAuthor(db, state.source.id, auth.userId)) throw AppError.authorUnverified();
  return state;
}

export async function getInterview(db: Executor, id: string, auth: AuthContext) {
  const [session] = await db.select().from(interviewSessions).where(eq(interviewSessions.id, id));
  if (!session) throw AppError.notFound();
  if (session.ownerUserId !== auth.userId) throw AppError.forbidden();
  const [ownerSource] = await db.select({ deletedAt: sources.deletedAt }).from(followupCases).innerJoin(sources, eq(sources.id, followupCases.sourceId)).where(eq(followupCases.id, session.caseId));
  if (!ownerSource || ownerSource.deletedAt) throw AppError.withdrawn();
  const messages = await db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, id)).orderBy(asc(interviewMessages.sequence));
  return { session, messages };
}

export async function enqueueNext(ctx: ModuleContext, db: Executor, session: typeof interviewSessions.$inferSelect, sourceId: string) {
  if (session.mode !== 'ai' || session.questionsAsked >= Math.min(session.budgetMainQuestions, 5)) return null;
  const { job } = await ctx.jobs.enqueue({
    kind: AI_JOB_KINDS.interviewNext, maxAttempts: 1,
    dedupeKey: `${interviewGenerateDedupeKey(session.id)}:${session.revision}`,
    payload: { source_id: sourceId, case_id: session.caseId, session_id: session.id, owner_user_id: session.ownerUserId, revision: session.revision },
  }, db);
  return job.id;
}

export async function startInterview(ctx: ModuleContext, auth: AuthContext, caseId: string, mode: 'ai' | 'manual') {
  return ctx.db.transaction(async tx => {
    const { source, caseRow } = await requireCaseAuthor(tx, caseId, auth);
    if (!['accepted', 'interviewing', 'paused'].includes(caseRow.status)) throw AppError.conflict('Accept the case before interviewing');
    if (!await hasActiveConsent(tx, source.id, 'private_interview', auth.userId)) throw AppError.consentRequired();
    const [existing] = await tx.select().from(interviewSessions).where(and(eq(interviewSessions.caseId, caseId), sql`${interviewSessions.status} in ('active','paused')`));
    if (existing) return { session: existing, job_id: null, deduped: true };
    const [snapshot] = await tx.select().from(sourceSnapshots).where(eq(sourceSnapshots.sourceId, source.id)).orderBy(desc(sourceSnapshots.version)).limit(1);
    if (!snapshot) throw AppError.sourceIncomplete();
    const configured = createLlmClient(ctx.env, ctx.logger).configured;
    const permitted = await hasActiveConsent(tx, source.id, 'external_model_processing', auth.userId);
    const effectiveMode = mode === 'ai' && configured && permitted ? 'ai' : 'manual';
    const [session] = await tx.insert(interviewSessions).values({ caseId, ownerUserId: auth.userId, mode: effectiveMode, snapshotId: snapshot.id }).returning();
    if (!session) throw AppError.internal();
    await tx.update(followupCases).set({ status: 'interviewing', updatedAt: ctx.now() }).where(eq(followupCases.id, caseId));
    return { session, job_id: await enqueueNext(ctx, tx, session, source.id), deduped: false,
      fallback_reason: effectiveMode !== mode ? (configured ? 'consent_required' : 'model_unconfigured') : null };
  });
}

export async function saveMessage(ctx: ModuleContext, auth: AuthContext, id: string, input: z.infer<typeof messageInput>) {
  return ctx.db.transaction(async tx => {
    const initial = await getInterview(tx, id, auth);
    const { source } = await requireCaseAuthor(tx, initial.session.caseId, auth);
    const [session] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, id)).for('update');
    if (!session) throw AppError.notFound();
    const [duplicate] = await tx.select().from(interviewMessages).where(and(eq(interviewMessages.sessionId, id), eq(interviewMessages.clientMessageId, input.client_message_id)));
    if (duplicate) {
      if (duplicate.authorMessage !== (input.message ?? null) || duplicate.skipped !== input.skip || duplicate.visibility !== input.visibility) throw AppError.conflict('Idempotency key reused with different content');
      return { message: duplicate, session, job_id: null, deduped: true };
    }
    if (session.status !== 'active' || session.revision !== input.expected_version) throw AppError.conflict('Interview state or version changed');
    if (!await hasActiveConsent(tx, source.id, 'private_interview', auth.userId)) throw AppError.consentRequired();
    const [last] = await tx.select().from(interviewMessages).where(eq(interviewMessages.sessionId, id)).orderBy(desc(interviewMessages.sequence)).limit(1);
    if (session.mode === 'ai' && (!last || last.role !== 'ai')) throw AppError.conflict('Wait for the current question');
    const [message] = await tx.insert(interviewMessages).values({ sessionId: id, role: 'author', sequence: (last?.sequence ?? 0) + 1,
      authorMessage: input.message ?? null, skipped: input.skip, visibility: input.visibility, clientMessageId: input.client_message_id }).returning();
    const [updated] = await tx.update(interviewSessions).set({ revision: session.revision + 1, updatedAt: ctx.now() }).where(eq(interviewSessions.id, id)).returning();
    return { message, session: updated!, job_id: await enqueueNext(ctx, tx, updated!, source.id), deduped: false };
  });
}

export async function transitionInterview(ctx: ModuleContext, auth: AuthContext, id: string, action: 'pause' | 'resume' | 'finish', expectedVersion: number) {
  return ctx.db.transaction(async tx => {
    const initial = await getInterview(tx, id, auth);
    const { source } = await requireCaseAuthor(tx, initial.session.caseId, auth);
    const [session] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, id)).for('update');
    if (!session || session.revision !== expectedVersion) throw AppError.conflict('Interview version changed');
    if (action === 'resume' ? session.status !== 'paused' : !['active', 'paused'].includes(session.status)) throw AppError.conflict('Invalid interview transition');
    if (action === 'resume' && !await hasActiveConsent(tx, source.id, 'private_interview', auth.userId)) throw AppError.consentRequired();
    // Source lock serializes cancellation against model writeback. The handler also checks revision.
    await tx.execute(sql`update jobs set status='cancelled', finished_at=now(), lease_owner=null, lease_expires_at=null where status in ('queued','running') and payload->>'session_id'=${id}`);
    const status = action === 'pause' ? 'paused' : action === 'finish' ? 'finished' : 'active';
    const [updated] = await tx.update(interviewSessions).set({ status, revision: session.revision + 1, finishedAt: action === 'finish' ? ctx.now() : null, updatedAt: ctx.now() }).where(eq(interviewSessions.id, id)).returning();
    await tx.update(followupCases).set({ status: action === 'pause' ? 'paused' : action === 'finish' ? 'draft' : 'interviewing', updatedAt: ctx.now() }).where(eq(followupCases.id, session.caseId));
    let jobId: string | null = null;
    if (action === 'resume') {
      const [last] = await tx.select().from(interviewMessages).where(eq(interviewMessages.sessionId, id)).orderBy(desc(interviewMessages.sequence)).limit(1);
      if (!last || last.role === 'author') jobId = await enqueueNext(ctx, tx, updated!, source.id);
    }
    return { session: updated!, job_id: jobId };
  });
}
