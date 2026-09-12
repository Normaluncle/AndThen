import { asc, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext, ModuleRegistrar } from '../../shared/types.js';
import type { Transaction } from '../../db/client.js';
import type { JobHandlerRegistry } from '../../jobs/types.js';
import { aiRuns, followupCases, followupVersions, interviewSessions, interviewMessages, sourceSnapshots, sources } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { AppError, success } from '../../http/errors.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { requireCaseAuthor } from '../interviews/service.js';
import { hasActiveConsent } from '../sources/access.js';
import { AI_JOB_KINDS, draftStatementSchema, followupDraftSchema } from '../../ai/tasks.js';
import { contentHash, validateStatements, type Evidence } from '../../ai/evidence.js';
import { PROMPTS, PROMPT_VERSION } from '../../ai/prompts.js';
import { createLlmClient } from '../../ai/client.js';
import { withJobFence, JobLeaseLostError } from '../../jobs/transaction.js';
import { requirePrivateFresh } from './retention.js';

const payloadSchema = z.object({ source_id: z.string().uuid(), case_id: z.string().uuid(), session_id: z.string().uuid(), owner_user_id: z.string().uuid(), expected_version: z.number().int().nonnegative(), revision: z.number().int(), request_id: z.string() });
const candidateSchema = z.object({ statements: z.array(draftStatementSchema).min(1).max(50), unresolved_items: z.array(z.string().max(2000)).max(50) }).strict();

export const registerDraftingRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.post('/interviews/:id/draft-ai', { preHandler: [app.authenticate], schema: { tags: ['followups'], security: [{ bearerAuth: [] }], params: z.object({ id: z.string().uuid() }),
    body: z.object({ expected_version: z.number().int().nonnegative() }).strict(), summary: 'Generate a new AI draft from the finished interview; expected_version is zero when no draft exists',
    response: { 202: envelopeSchema(z.object({ job_id: z.string().uuid(), deduped: z.boolean() })), 404: errorEnvelopeSchema, 409: errorEnvelopeSchema, 422: errorEnvelopeSchema, 503: errorEnvelopeSchema } } }, async (req, reply) => {
    const auth = requireAuthContext(req);
    const result = await ctx.db.transaction(async tx => {
      const [session] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, req.params.id));
      if (!session) throw AppError.notFound();
      const { source } = await requireCaseAuthor(tx, session.caseId, auth);
      const payload = { source_id: source.id, case_id: session.caseId, session_id: session.id, owner_user_id: auth.userId, expected_version: req.body.expected_version, revision: session.revision, request_id: req.id };
      await readInput(tx, payload);
      if (!createLlmClient(ctx.env, ctx.logger).configured) throw AppError.serviceUnavailable('Model unconfigured; use the manual draft endpoint');
      const { job, deduped } = await ctx.jobs.enqueue({ kind: AI_JOB_KINDS.draft, maxAttempts: 1, dedupeKey: `draft:${session.id}:${payload.expected_version}`, payload }, tx);
      return { job_id: job.id, deduped };
    });
    return reply.code(202).send(success(req.id, result));
  });
};

async function readInput(tx: Transaction, p: z.infer<typeof payloadSchema>) {
  const [source] = await tx.select().from(sources).where(eq(sources.id, p.source_id)).for('update');
  const [caseRow] = await tx.select().from(followupCases).where(eq(followupCases.id, p.case_id)).for('update');
  if (!source || source.deletedAt || !caseRow || caseRow.sourceId !== source.id || caseRow.authorUserId !== p.owner_user_id) throw AppError.withdrawn();
  if (!await hasActiveConsent(tx, source.id, 'private_interview', p.owner_user_id) || !await hasActiveConsent(tx, source.id, 'external_model_processing', p.owner_user_id)) throw AppError.consentRequired();
  const [session] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, p.session_id)).for('update');
  if (!session || session.caseId !== caseRow.id || session.ownerUserId !== p.owner_user_id || session.status !== 'finished' || session.revision !== p.revision) throw AppError.conflict('Interview must remain finished at the requested revision');
  requirePrivateFresh(session.updatedAt);
  const [latest] = await tx.select().from(followupVersions).where(eq(followupVersions.caseId, caseRow.id)).orderBy(desc(followupVersions.version)).limit(1);
  if ((latest?.version ?? 0) !== p.expected_version) throw AppError.conflict('Draft version changed');
  const [snapshot] = session.snapshotId ? await tx.select().from(sourceSnapshots).where(eq(sourceSnapshots.id, session.snapshotId)) : [];
  if (!snapshot || snapshot.sourceId !== source.id) throw AppError.sourceIncomplete();
  const messages = await tx.select().from(interviewMessages).where(eq(interviewMessages.sessionId, session.id)).orderBy(asc(interviewMessages.sequence));
  const evidence: Evidence[] = [{ id: `snapshot:${snapshot.id}`, text: snapshot.body ?? snapshot.excerpt ?? '', visibility: 'public' },
    ...messages.filter(m => m.role === 'author' && !m.skipped && m.authorMessage).map(m => ({ id: `message:${m.id}`, text: m.authorMessage!, visibility: m.visibility === 'public' ? 'public' as const : 'private' as const }))];
  if (evidence.length < 2) throw AppError.sourceIncomplete('No author answers to draft');
  if (JSON.stringify(evidence).length > 64000) throw AppError.sourceIncomplete('Draft input exceeds budget');
  return { source, caseRow, session, snapshot, latest, evidence };
}

export function registerDraftingJobs(ctx: ModuleContext, registry: JobHandlerRegistry) {
  registry.register(AI_JOB_KINDS.draft, async job => {
    const p = payloadSchema.parse(job.payload);
    const runId = randomUUID();
    const input = await ctx.db.transaction(async tx => {
      const state = await readInput(tx, p);
      await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
        await fenced.insert(aiRuns).values({ id: runId, task: 'ai_c_draft', status: 'running', sourceId: p.source_id, caseId: p.case_id, interviewSessionId: p.session_id, jobId: job.job.id, modelId: ctx.env.LLM_MODEL, promptVersion: PROMPT_VERSION, requestId: p.request_id });
      });
      return state;
    });
    let completion: Awaited<ReturnType<ReturnType<typeof createLlmClient>['complete']>> | undefined;
    let candidate: z.infer<typeof candidateSchema> | undefined;
    let errorCode: string | null = null;
    try {
      completion = await createLlmClient(ctx.env, ctx.logger).complete({ json: true, maxTokens: 4000, temperature: 0, signal: job.signal, messages: [{ role: 'system', content: PROMPTS.ai_c_draft }, { role: 'user', content: JSON.stringify({ evidence: input.evidence, material_level: input.snapshot.materialLevel }) }] });
      candidate = candidateSchema.parse(JSON.parse(completion.content));
      if (validateStatements(candidate.statements, input.evidence).blocking) throw AppError.sourceIncomplete('Generated statements fail evidence or privacy validation');
      for (const statement of candidate.statements) {
        if (statement.kind === 'source_quote' && (input.snapshot.materialLevel !== 'exact_excerpt' || statement.evidence_refs.some(ref => ref !== `snapshot:${input.snapshot.id}`))) throw AppError.sourceIncomplete('Only exact source evidence may be quoted');
        if (['author_report', 'author_reflection'].includes(statement.kind) && statement.evidence_refs.some(ref => !ref.startsWith('message:'))) throw AppError.sourceIncomplete('Author statements require interview evidence');
      }
    } catch (err) {
      if (job.signal.aborted) throw err;
      errorCode = err instanceof AppError ? err.code : 'invalid_model_output';
    }
    let draftId: string | null = null;
    await ctx.db.transaction(async tx => {
      let current: Awaited<ReturnType<typeof readInput>>;
      try { current = await readInput(tx, p); } catch { throw new JobLeaseLostError(job.job.id, 'draft, source or permission changed'); }
      await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
        if (candidate && !errorCode) {
          const data = followupDraftSchema.parse({ source_id: p.source_id, snapshot_hash: current.snapshot.contentHash, interview_id: p.session_id, version: p.expected_version + 1, statements: candidate.statements, unresolved_items: candidate.unresolved_items, author_edits: [], author_confirmations: [], ai_assisted: true, content_hash: contentHash(candidate.statements) });
          const [draft] = await fenced.insert(followupVersions).values({ caseId: p.case_id, snapshotId: current.snapshot.id, interviewId: p.session_id, version: data.version, statements: data.statements, unresolvedItems: data.unresolved_items, aiAssisted: true, contentHash: data.content_hash, createdByUserId: p.owner_user_id }).returning();
          draftId = draft!.id;
          if (current.latest && current.latest.status !== 'published') await fenced.update(followupVersions).set({ status: 'superseded', updatedAt: ctx.now() }).where(eq(followupVersions.id, current.latest.id));
        }
        await fenced.update(aiRuns).set({ status: errorCode ? 'failed' : 'succeeded', errorCode, output: draftId ? { draft_id: draftId } : null, modelId: completion?.model ?? ctx.env.LLM_MODEL, inputTokens: completion?.usage.inputTokens, outputTokens: completion?.usage.outputTokens, latencyMs: completion?.latencyMs, finishedAt: ctx.now() }).where(eq(aiRuns.id, runId));
      });
    });
    return { data: { draft_id: draftId, error_code: errorCode, fallback_mode: errorCode ? 'manual_draft' : null } };
  });
}
