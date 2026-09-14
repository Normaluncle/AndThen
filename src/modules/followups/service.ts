import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../../db/client.js';
import { auditLogs, jobs, aiRuns, followupCases, followupVersions, interviewSessions, interviewMessages, sourceSnapshots, sources, interests, outbox, notifications } from '../../db/schema.js';
import type { ModuleContext, AuthContext } from '../../shared/types.js';
import { AppError } from '../../http/errors.js';
import { lockCase, requireCaseAuthor } from '../interviews/service.js';
import { draftStatementSchema } from '../../ai/tasks.js';
import { contentHash, validateStatements, type Evidence, type Statement } from '../../ai/evidence.js';
import { hasActiveConsent, isPubliclyVisible } from '../sources/access.js';
import { privateExpired, publicStatements, requirePrivateFresh } from './retention.js';
import { attachInterviewQuestions } from './questions.js';

export async function getDraft(db: Executor, id: string, auth: AuthContext) {
  const [initial] = await db.select().from(followupVersions).where(eq(followupVersions.id, id));
  if (!initial) throw AppError.notFound();
  const [caseRow] = await db.select().from(followupCases).where(eq(followupCases.id, initial.caseId));
  if (!caseRow || caseRow.authorUserId !== auth.userId) throw AppError.forbidden();
  const [source] = await db.select({ deletedAt: sources.deletedAt }).from(sources).where(eq(sources.id, caseRow.sourceId)).for('update');
  if (!source || source.deletedAt) throw AppError.withdrawn();
  const [draft] = await db.select().from(followupVersions).where(eq(followupVersions.id, id));
  if (!draft) throw AppError.notFound();
  if (draft.contentPurgedAt) throw AppError.withdrawn('Private content has been purged');
  if (privateExpired(draft.updatedAt) || draft.privatePurgedAt) {
    if (draft.status !== 'published') throw AppError.withdrawn('Private content retention period expired');
    return { ...draft, statements: publicStatements(draft.statements), authorEdits: [], unresolvedItems: [], authorConfirmations: [], privateContentExpired: true };
  }
  return draft;
}

export async function draftEvidence(db: Executor, draft: typeof followupVersions.$inferSelect): Promise<Evidence[]> {
  const evidence: Evidence[] = [];
  if (draft.snapshotId) {
    const [snapshot] = await db.select().from(sourceSnapshots).where(eq(sourceSnapshots.id, draft.snapshotId));
    if (snapshot) evidence.push({ id: `snapshot:${snapshot.id}`, text: snapshot.body ?? snapshot.excerpt ?? '', visibility: 'public' });
  }
  if (draft.interviewId) {
    const [session] = await db.select().from(interviewSessions).where(eq(interviewSessions.id, draft.interviewId));
    const messages = session && !privateExpired(session.updatedAt) ? await db.select().from(interviewMessages).where(eq(interviewMessages.sessionId, draft.interviewId)) : [];
    for (const message of messages) if (message.role === 'author' && !message.skipped && message.authorMessage) {
      evidence.push({ id: `message:${message.id}`, text: message.authorMessage, visibility: message.visibility === 'public' ? 'public' : 'private' });
    }
  }
  for (const edit of draft.authorEdits) {
    const parsed = z.object({ id: z.string(), text: z.string(), visibility: z.enum(['private', 'public']) }).safeParse(edit);
    if (parsed.success) evidence.push(parsed.data);
  }
  return evidence;
}

export async function readDraftEvidence(ctx: ModuleContext, auth: AuthContext, id: string) {
  return ctx.db.transaction(async tx => {
    const draft = await getDraft(tx,id,auth);
    if ('privateContentExpired' in draft && draft.privateContentExpired) throw AppError.withdrawn('Private evidence retention period expired');
    const refs = new Set(z.array(draftStatementSchema).parse(draft.statements).flatMap(statement=>statement.evidence_refs));
    const evidence = (await draftEvidence(tx,draft)).filter(item=>refs.has(item.id));
    const [snapshot] = draft.snapshotId ? await tx.select({level:sourceSnapshots.materialLevel}).from(sourceSnapshots).where(eq(sourceSnapshots.id,draft.snapshotId)) : [];
    return {
      draft_id:draft.id, content_hash:draft.contentHash,
      items:evidence.map(item=>({...item,
        source_kind:item.id.startsWith('snapshot:')?'original' as const:item.id.startsWith('message:')?'interview' as const:'author_edit' as const,
        material_level:item.id.startsWith('snapshot:')?snapshot?.level??null:null,
      })),
      missing_refs:[...refs].filter(ref=>!evidence.some(item=>item.id===ref)),
    };
  });
}

export async function createManualDraft(ctx: ModuleContext, auth: AuthContext, interviewId: string) {
  return ctx.db.transaction(async tx => {
    const [initial] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, interviewId));
    if (!initial) throw AppError.notFound();
    await requireCaseAuthor(tx, initial.caseId, auth);
    const [session] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, interviewId));
    if (!session) throw AppError.notFound();
    requirePrivateFresh(session.updatedAt, ctx.now());
    if (session.status !== 'finished') throw AppError.conflict('Finish the interview first');
    const [existing] = await tx.select().from(followupVersions).where(eq(followupVersions.interviewId, interviewId)).orderBy(desc(followupVersions.version)).limit(1);
    if (existing) return getDraft(tx, existing.id, auth);
    const messages = await tx.select().from(interviewMessages).where(eq(interviewMessages.sessionId, interviewId)).orderBy(asc(interviewMessages.sequence));
    const statements: Statement[] = attachInterviewQuestions(messages.filter(m => m.role === 'author' && m.authorMessage && !m.skipped).map(m => ({ id: m.id, text: m.authorMessage!, kind: 'author_report', evidence_refs: [`message:${m.id}`], visibility: m.visibility === 'public' ? 'public' : 'private' })),messages);
    if (!statements.length) throw AppError.sourceIncomplete('No author answers to draft');
    const [latest] = await tx.select().from(followupVersions).where(eq(followupVersions.caseId, session.caseId)).orderBy(desc(followupVersions.version)).limit(1);
    const [draft] = await tx.insert(followupVersions).values({ caseId: session.caseId, interviewId, snapshotId: session.snapshotId, version: (latest?.version ?? 0) + 1, statements, contentHash: contentHash(statements), aiAssisted: messages.some(m => m.generatedBy === 'ai'), createdByUserId: auth.userId }).returning();
    return draft!;
  });
}

export async function editDraft(ctx: ModuleContext, auth: AuthContext, id: string, expectedVersion: number, statements: Statement[]) {
  return ctx.db.transaction(async tx => {
    const old = await getDraft(tx, id, auth);
    await requireCaseAuthor(tx, old.caseId, auth);
    const messages=old.interviewId?await tx.select().from(interviewMessages).where(eq(interviewMessages.sessionId,old.interviewId)):[];
    const original=z.array(draftStatementSchema).parse(old.statements);
    const contexts=attachInterviewQuestions(original,messages);
    for(const s of statements)if(s.question && s.question!==original.find(x=>x.id===s.id)?.question && s.question!==contexts.find(x=>x.id===s.id)?.question)throw AppError.validation('采访问题必须来自原始采访，不能伪造。');
    const [latest] = await tx.select().from(followupVersions).where(eq(followupVersions.caseId, old.caseId)).orderBy(desc(followupVersions.version)).limit(1);
    if (old.version !== expectedVersion || latest?.id !== id) throw AppError.conflict('Edit the current draft version');
    // User-supplied text is explicitly retained as author evidence, never attributed to AI or old source.
    const authorEdits = statements.map(s => ({ id: `author_edit:${old.version + 1}:${s.id}`, text: s.text, visibility: s.visibility }));
    const edited = statements.map((s, index) => ({ ...s, kind: 'author_report' as const, evidence_refs: [authorEdits[index]!.id] }));
    const [draft] = await tx.insert(followupVersions).values({ caseId: old.caseId, interviewId: old.interviewId, snapshotId: old.snapshotId, version: old.version + 1, statements: edited, authorEdits, contentHash: contentHash(edited), aiAssisted: old.aiAssisted, createdByUserId: auth.userId }).returning();
    if (old.status !== 'published') await tx.update(followupVersions).set({ status: 'superseded', updatedAt: ctx.now() }).where(eq(followupVersions.id, id));
    return draft!;
  });
}

export async function confirmDraft(ctx: ModuleContext, auth: AuthContext, id: string, hash: string, itemIds: string[]) {
  return ctx.db.transaction(async tx => {
    const draft = await getDraft(tx, id, auth);
    await requireCaseAuthor(tx, draft.caseId, auth);
    const [latest] = await tx.select().from(followupVersions).where(eq(followupVersions.caseId, draft.caseId)).orderBy(desc(followupVersions.version)).limit(1);
    if (latest?.id !== id || !['draft', 'confirmed'].includes(draft.status) || draft.contentHash !== hash) throw AppError.conflict('Confirmation requires the current draft hash');
    const statements = z.array(draftStatementSchema).parse(draft.statements);
    const validation = validateStatements(statements, await draftEvidence(tx, draft));
    if (validation.blocking || validation.draft_content_hash !== hash) throw AppError.sourceIncomplete('Draft evidence validation failed');
    await requireNoModelBlock(tx, id, hash);
    if (itemIds.length !== statements.length || new Set(itemIds).size !== itemIds.length || statements.some(s => !itemIds.includes(s.id))) throw AppError.validation('Confirm every statement exactly once');
    if (draft.status === 'confirmed') return draft; // Same hash and statement set: no new memory generation.
    const [confirmed] = await tx.update(followupVersions).set({ status: 'confirmed', authorConfirmations: itemIds.map(statementId => ({ statement_id: statementId, content_hash: hash, user_id: auth.userId })), confirmedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(followupVersions.id, id)).returning();
    await invalidateAuthorMemory(ctx, tx, auth.userId);
    return confirmed!;
  });
}

export async function publishDraft(ctx: ModuleContext, auth: AuthContext, id: string, hash: string) {
  return ctx.db.transaction(async tx => {
    const initial = await getDraft(tx, id, auth);
    const { source, caseRow } = await requireCaseAuthor(tx, initial.caseId, auth);
    if (caseRow.reviewerRequired) throw AppError.conflict('Human case review is required before publication');
    const [draft] = await tx.select().from(followupVersions).where(eq(followupVersions.id, id)).for('update');
    if (!draft || draft.contentHash !== hash) throw AppError.conflict('Content hash changed');
    if (!await hasActiveConsent(tx, source.id, 'demo_public_display', auth.userId) || !await isPubliclyVisible(tx, source)) throw AppError.consentRequired();
    if (draft.status === 'published' && caseRow.publishedVersionId === id) return { version_id: id, deduped: true };
    const [latest] = await tx.select().from(followupVersions).where(eq(followupVersions.caseId, draft.caseId)).orderBy(desc(followupVersions.version)).limit(1);
    if (latest?.id !== id || draft.status !== 'confirmed' || !draft.confirmedAt) throw AppError.conflict('Publish only the current confirmed version');
    const statements = z.array(draftStatementSchema).parse(draft.statements);
    if (!statements.some(s => s.visibility === 'public')) throw AppError.sourceIncomplete('No public statements');
    const validation = validateStatements(statements, await draftEvidence(tx, draft));
    if (validation.blocking || validation.draft_content_hash !== hash || draft.authorConfirmations.length !== statements.length) throw AppError.sourceIncomplete('Confirmation or evidence no longer valid');
    await requireNoModelBlock(tx, id, hash);
    if (caseRow.publishedVersionId) await tx.update(followupVersions).set({ status: 'superseded', updatedAt: ctx.now() }).where(eq(followupVersions.id, caseRow.publishedVersionId));
    await tx.update(followupVersions).set({ status: 'published', publishedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(followupVersions.id, id));
    await tx.update(followupCases).set({ status: 'published', publishedVersionId: id, updatedAt: ctx.now() }).where(eq(followupCases.id, draft.caseId));
    const recipients = await tx.select({ readerKey: interests.readerKey, cohort: interests.cohort }).from(interests).where(and(eq(interests.sourceId, source.id), eq(interests.active, true)));
    await tx.insert(outbox).values({ topic: 'followup.published', dedupeKey: id, payload: { source_id: source.id, case_id: draft.caseId, version_id: id }, recipients }).onConflictDoNothing();
    await ctx.jobs.enqueue({ kind: 'followup.notify', dedupeKey: `notify:${id}`, payload: { source_id: source.id, case_id: draft.caseId, version_id: id } }, tx);
    return { version_id: id, deduped: false };
  });
}

async function requireNoModelBlock(db: Executor, draftId: string, hash: string) {
  const [pending] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.kind, 'ai.validate'), sql`${jobs.payload}->>'draft_id'=${draftId}`, sql`${jobs.status} in ('queued','running')`)).limit(1);
  if (pending) throw AppError.conflict('Wait for the requested draft validation');
  const [block] = await db.select({ id: aiRuns.id }).from(aiRuns).where(and(eq(aiRuns.task, 'ai_d_val'), eq(aiRuns.status, 'succeeded'),
    sql`${aiRuns.output}->>'draft_id'=${draftId}`, sql`${aiRuns.output}->>'draft_content_hash'=${hash}`, sql`${aiRuns.output}->>'blocking'='true'`)).limit(1);
  if (block) throw AppError.sourceIncomplete('Validation findings require a new author-edited draft');
}

export async function withdrawFollowup(ctx: ModuleContext, auth: AuthContext, id: string, reason?: string) {
  return ctx.db.transaction(async tx => {
    const [initial] = await tx.select().from(followupVersions).where(eq(followupVersions.id, id));
    if (!initial) throw AppError.notFound();
    const { caseRow } = await lockCase(tx, initial.caseId);
    const operator = auth.role === 'admin' || (auth.role === 'researcher' && caseRow.createdByUserId === auth.userId);
    if (!operator) await requireCaseAuthor(tx, initial.caseId, auth);
    const [draft] = await tx.select().from(followupVersions).where(eq(followupVersions.id, id)).for('update');
    if (!draft) throw AppError.notFound();
    if (draft.status === 'withdrawn') return { withdrawn: true };
    if (caseRow.publishedVersionId !== id) throw AppError.conflict('Only the current publication may be withdrawn');
    await tx.update(followupVersions).set({ status: 'withdrawn', withdrawnAt: ctx.now(), updatedAt: ctx.now() }).where(eq(followupVersions.id, id));
    await tx.update(followupCases).set({ status: 'withdrawn', publishedVersionId: null, updatedAt: ctx.now() }).where(eq(followupCases.id, draft.caseId));
    await tx.update(notifications).set({ status: 'withdrawn' }).where(eq(notifications.followupVersionId, id));
    await tx.update(outbox).set({ status: 'cancelled', recipients: [], updatedAt: ctx.now() }).where(eq(outbox.dedupeKey, id));
    await tx.insert(auditLogs).values({ actorType: 'user', actorUserId: auth.userId, action: 'followup.withdrawn', subjectType: 'followup', subjectId: id, caseId: draft.caseId, properties: { operator, reason: reason ?? null } });
    return { withdrawn: true };
  });
}

function withReadingSections<T extends { section?: 'then' | 'later' | 'reflection' }>(statements: T[]): T[] {
  if (statements.some((item) => item.section === 'then' || item.section === 'later' || item.section === 'reflection')) return statements;
  if (statements.length <= 1) return statements.map((item) => ({ ...item, section: 'later' as const }));
  const first = Math.max(1, Math.ceil(statements.length / 3));
  const second = Math.max(first + 1, Math.ceil((statements.length * 2) / 3));
  return statements.map((item, index) => ({
    ...item,
    section: (index < first ? 'then' : index < second ? 'later' : 'reflection') as 'then' | 'later' | 'reflection',
  }));
}

export async function publicFollowup(db: Executor, id: string) {
  const [record] = await db.select({ version: followupVersions, caseRow: followupCases, source: sources }).from(followupVersions)
    .innerJoin(followupCases, eq(followupCases.id, followupVersions.caseId)).innerJoin(sources, eq(sources.id, followupCases.sourceId)).where(eq(followupVersions.id, id));
  if (!record) throw AppError.notFound();
  if (record.version.status !== 'published' || record.caseRow.publishedVersionId !== id || !await isPubliclyVisible(db, record.source)) throw AppError.withdrawn();
  const statements = withReadingSections(z.array(draftStatementSchema).parse(record.version.statements).filter(s => s.visibility === 'public'))
    .map(({ id, text, kind, section }) => ({ id, text, kind, ...(section ? { section } : {}) }));
  return { version_id: id, source_id: record.source.id, statements, confirmed_at: record.version.confirmedAt, published_at: record.version.publishedAt, ai_assisted: record.version.aiAssisted, attribution: 'author_reported' };
}
import { invalidateAuthorMemory } from '../memory/service.js';
