import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { aiRuns, interviewMessages, interviewSessions, sourceSnapshots, sources } from '../../db/schema.js';
import type { ModuleContext } from '../../shared/types.js';
import type { JobHandlerContext, JobHandlerRegistry } from '../../jobs/types.js';
import { withJobFence, JobLeaseLostError } from '../../jobs/transaction.js';
import { createLlmClient } from '../../ai/client.js';
import { AI_JOB_KINDS } from '../../ai/tasks.js';
import { PROMPTS, PROMPT_VERSION } from '../../ai/prompts.js';
import { hasActiveConsent } from '../sources/access.js';
import { lockCase } from './service.js';
import { AppError } from '../../http/errors.js';

const payloadSchema = z.object({ source_id: z.string().uuid(), case_id: z.string().uuid(), session_id: z.string().uuid(), owner_user_id: z.string().uuid(), revision: z.number().int() });
const turnSchema = z.object({ question: z.string().trim().min(1).max(500), purpose: z.string().max(1000), basis_refs: z.array(z.string()).min(1).max(10) }).strict();

export function registerInterviewJobs(ctx: ModuleContext, registry: JobHandlerRegistry) {
  registry.register(AI_JOB_KINDS.interviewNext, async job => generateNext(ctx, job));
}

async function generateNext(ctx: ModuleContext, job: JobHandlerContext) {
  const p = payloadSchema.parse(job.payload);
  const runId = randomUUID();
  const input = await ctx.db.transaction(async tx => {
    const { source, caseRow } = await lockCase(tx, p.case_id);
    const [session] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, p.session_id)).for('update');
    if (!session || session.ownerUserId !== p.owner_user_id || caseRow.sourceId !== p.source_id || session.revision !== p.revision || session.status !== 'active') throw AppError.conflict('Interview changed');
    if (session.questionsAsked >= Math.min(5, session.budgetMainQuestions)) return null;
    if (!await hasActiveConsent(tx, source.id, 'private_interview', p.owner_user_id) || !await hasActiveConsent(tx, source.id, 'external_model_processing', p.owner_user_id)) return null;
    const [snapshot] = session.snapshotId ? await tx.select().from(sourceSnapshots).where(eq(sourceSnapshots.id, session.snapshotId)) : [];
    if (!snapshot) throw AppError.sourceIncomplete();
    const history = await tx.select().from(interviewMessages).where(eq(interviewMessages.sessionId, session.id)).orderBy(asc(interviewMessages.sequence));
    if (history.at(-1)?.role === 'ai') return null;
    // Source-first then job fence matches revocation/cancellation lock order.
    await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
      await fenced.insert(aiRuns).values({ id: runId, task: 'ai_b_interview', status: 'running', jobId: job.job.id, sourceId: source.id, caseId: caseRow.id, interviewSessionId: session.id, modelId: ctx.env.LLM_MODEL, promptVersion: PROMPT_VERSION });
    });
    return { session, snapshot, history };
  });
  if (!input) return { data: { generated: false, reason: 'budget_permission_or_state' } };
  const evidence = [
    { id: `snapshot:${input.snapshot.id}`, text: input.snapshot.body ?? input.snapshot.excerpt ?? '' },
    ...input.history.filter(m => m.role === 'author' && !m.skipped).map(m => ({ id: `message:${m.id}`, text: m.authorMessage ?? '' })),
  ];
  let turn: z.infer<typeof turnSchema> | undefined;
  let completion: Awaited<ReturnType<ReturnType<typeof createLlmClient>['complete']>> | undefined;
  let failureCode: string | null = null;
  try {
    const serialized = JSON.stringify({ evidence, remaining_questions: 5 - input.session.questionsAsked,
      history: input.history.map(m => ({ role: m.role, question: m.question, answer: m.authorMessage, skipped: m.skipped })) });
    if (serialized.length > 64000) throw AppError.sourceIncomplete('Authorized input exceeds the task budget');
    completion = await createLlmClient(ctx.env, ctx.logger).complete({ messages: [{ role: 'system', content: PROMPTS.ai_b_interview }, { role: 'user', content: serialized }], json: true, maxTokens: 1000, temperature: 0.2, signal: job.signal });
    turn = turnSchema.parse(JSON.parse(completion.content));
    if (turn.basis_refs.some(ref => !evidence.some(e => e.id === ref))) throw AppError.sourceIncomplete('Unsupported interview reference');
    if ((turn.question.match(/[?？]/g) ?? []).length > 1 || input.history.some(m => m.question === turn!.question)) throw AppError.conflict('Repeated or multiple questions');
  } catch (err) {
    if (job.signal.aborted) throw err;
    failureCode = err instanceof AppError ? err.code : 'invalid_model_output';
  }
  await ctx.db.transaction(async tx => {
    await tx.select({ id: sources.id }).from(sources).where(eq(sources.id, p.source_id)).for('update');
    await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
      const [source] = await fenced.select().from(sources).where(eq(sources.id, p.source_id));
      const [session] = await fenced.select().from(interviewSessions).where(eq(interviewSessions.id, p.session_id)).for('update');
      if (!source || source.deletedAt || !session || session.status !== 'active' || session.revision !== p.revision || !await hasActiveConsent(fenced, p.source_id, 'external_model_processing', p.owner_user_id) || !await hasActiveConsent(fenced, p.source_id, 'private_interview', p.owner_user_id)) {
        throw new JobLeaseLostError(job.job.id, 'authorization or interview changed');
      }
      await fenced.update(aiRuns).set({ status: failureCode ? 'failed' : 'succeeded', errorCode: failureCode, finishedAt: ctx.now(), inputTokens: completion?.usage.inputTokens ?? null, outputTokens: completion?.usage.outputTokens ?? null, latencyMs: completion?.latencyMs ?? null }).where(eq(aiRuns.id, runId));
      if (failureCode || !turn) {
        await fenced.update(interviewSessions).set({ mode: 'manual', stopReason: failureCode, revision: session.revision + 1, updatedAt: ctx.now() }).where(eq(interviewSessions.id, session.id));
      } else {
        await fenced.insert(interviewMessages).values({ sessionId: session.id, role: 'ai', sequence: (input.history.at(-1)?.sequence ?? 0) + 1, question: turn.question, purpose: turn.purpose, basisRefs: turn.basis_refs, generatedBy: 'ai' });
        await fenced.update(interviewSessions).set({ questionsAsked: session.questionsAsked + 1, revision: session.revision + 1, updatedAt: ctx.now() }).where(eq(interviewSessions.id, session.id));
      }
    });
  });
  return { data: { generated: !failureCode, fallback_mode: failureCode ? 'manual' : null, error_code: failureCode } };
}
