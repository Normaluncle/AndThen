import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext, ModuleRegistrar } from '../../shared/types.js';
import type { JobHandlerRegistry } from '../../jobs/types.js';
import { aiRuns, followupCases, followupVersions, sources } from '../../db/schema.js';
import { AppError, success } from '../../http/errors.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { draftEvidence, getDraft } from './service.js';
import { requireCaseAuthor } from '../interviews/service.js';
import { hasActiveConsent } from '../sources/access.js';
import { validateStatements } from '../../ai/evidence.js';
import { AI_JOB_KINDS, draftStatementSchema, validationResultSchema } from '../../ai/tasks.js';
import { PROMPTS, PROMPT_VERSION } from '../../ai/prompts.js';
import { createLlmClient } from '../../ai/client.js';
import { withJobFence, JobLeaseLostError } from '../../jobs/transaction.js';
import { requirePrivateFresh } from './retention.js';

export const registerValidationRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.post('/drafts/:id/validate', { preHandler: [app.authenticate], schema: { tags: ['validation'], security: [{ bearerAuth: [] }], params: z.object({ id: z.string().uuid() }),
    body: z.object({ content_hash: z.string().length(64) }).strict(), summary: 'Rule-first draft validation with optional independent model advisory check',
    response: { 200: envelopeSchema(z.object({ validation: validationResultSchema, mode: z.literal('rules_only'), reason: z.string() })), 202: envelopeSchema(z.object({ job_id: z.string().uuid(), mode: z.literal('ai_pending') })), 404: errorEnvelopeSchema, 409: errorEnvelopeSchema } } }, async (req, reply) => {
    const auth = requireAuthContext(req);
    const result = await ctx.db.transaction(async tx => {
      const draft = await getDraft(tx, req.params.id, auth);
      const { source } = await requireCaseAuthor(tx, draft.caseId, auth);
      const [latest] = await tx.select().from(followupVersions).where(eq(followupVersions.caseId, draft.caseId)).orderBy(desc(followupVersions.version)).limit(1);
      if (latest?.id !== draft.id || draft.contentHash !== req.body.content_hash || !['draft', 'confirmed'].includes(draft.status)) throw AppError.conflict('Validate current draft hash before publishing');
      const validation = validateStatements(z.array(draftStatementSchema).parse(draft.statements), await draftEvidence(tx, draft));
      const permitted = await hasActiveConsent(tx, source.id, 'external_model_processing', auth.userId);
      const configured = createLlmClient(ctx.env, ctx.logger).configured;
      if (validation.blocking || !permitted || !configured) return { validation, mode: 'rules_only' as const, reason: validation.blocking ? 'rules_blocking' : permitted ? 'model_unconfigured' : 'model_consent_missing' };
      const { job } = await ctx.jobs.enqueue({ kind: AI_JOB_KINDS.validate, maxAttempts: 1, dedupeKey: `validate:${draft.id}:${draft.contentHash}`, payload: { source_id: source.id, draft_id: draft.id, content_hash: draft.contentHash, owner_user_id: auth.userId, request_id: req.id } }, tx);
      return { job_id: job.id, mode: 'ai_pending' as const };
    });
    if (result.mode === 'rules_only') return reply.code(200).send(success(req.id, result));
    return reply.code(202).send(success(req.id, result));
  });
};

export function registerValidationJobs(ctx: ModuleContext, registry: JobHandlerRegistry) {
  registry.register(AI_JOB_KINDS.validate, async job => {
    const p = z.object({ source_id: z.string().uuid(), draft_id: z.string().uuid(), content_hash: z.string(), owner_user_id: z.string().uuid(), request_id: z.string() }).parse(job.payload);
    const runId = randomUUID();
    const read = async (db: Parameters<Parameters<typeof ctx.db.transaction>[0]>[0]) => {
      const [source] = await db.select().from(sources).where(eq(sources.id, p.source_id)).for('update');
      if (!source || source.deletedAt || !await hasActiveConsent(db, source.id, 'external_model_processing', p.owner_user_id)) throw new JobLeaseLostError(job.job.id, 'permission changed');
      const [draft] = await db.select().from(followupVersions).where(eq(followupVersions.id, p.draft_id));
      const [caseRow] = draft ? await db.select().from(followupCases).where(eq(followupCases.id, draft.caseId)) : [];
      if (!draft || caseRow?.sourceId !== source.id || caseRow.authorUserId !== p.owner_user_id || draft.contentHash !== p.content_hash || !['draft', 'confirmed'].includes(draft.status)) throw new JobLeaseLostError(job.job.id, 'draft changed');
      requirePrivateFresh(draft.updatedAt, ctx.now());
      if (draft.contentPurgedAt) throw new JobLeaseLostError(job.job.id, 'draft purged');
      const [latest] = await db.select().from(followupVersions).where(eq(followupVersions.caseId, draft.caseId)).orderBy(desc(followupVersions.version)).limit(1);
      if (latest?.id !== draft.id) throw new JobLeaseLostError(job.job.id, 'draft replaced');
      return draft;
    };
    const input = await ctx.db.transaction(async tx => {
      const draft = await read(tx);
      const evidence = await draftEvidence(tx, draft);
      const statements = z.array(draftStatementSchema).parse(draft.statements);
      const rules = validateStatements(statements, evidence);
      await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => { await fenced.insert(aiRuns).values({ id: runId, task: 'ai_d_val', status: 'running', sourceId: p.source_id, caseId: draft.caseId, jobId: job.job.id, modelId: ctx.env.LLM_MODEL, promptVersion: PROMPT_VERSION, requestId: p.request_id }); });
      return { evidence, statements, rules };
    });
    let completion: Awaited<ReturnType<ReturnType<typeof createLlmClient>['complete']>> | undefined;
    let result = input.rules;
    let errorCode: string | null = null;
    try {
      if (!input.rules.blocking) {
        const text = JSON.stringify(input);
        if (text.length > 64000) throw AppError.sourceIncomplete('Validation input exceeds budget');
        completion = await createLlmClient(ctx.env, ctx.logger).complete({ json: true, maxTokens: 2500, temperature: 0, signal: job.signal, messages: [{ role: 'system', content: PROMPTS.ai_d_val }, { role: 'user', content: text }] });
        const candidate = validationResultSchema.omit({ draft_content_hash: true }).strict().parse(JSON.parse(completion.content));
        if (candidate.findings.some(f => f.statement_id !== null && !input.statements.some(s => s.id === f.statement_id))) throw AppError.sourceIncomplete('Unknown validation statement');
        const findings = [...input.rules.findings, ...candidate.findings];
        result = validationResultSchema.parse({ draft_content_hash: p.content_hash, findings, blocking: input.rules.blocking || candidate.blocking || findings.some(f => f.severity === 'blocking') });
      }
    } catch (err) {
      if (job.signal.aborted) throw err;
      errorCode = err instanceof AppError ? err.code : 'invalid_model_output';
    }
    await ctx.db.transaction(async tx => {
      await read(tx);
      await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
        await fenced.update(aiRuns).set({ status: errorCode ? 'failed' : 'succeeded', output: errorCode ? null : { ...result, draft_id: p.draft_id }, errorCode, modelId: completion?.model ?? ctx.env.LLM_MODEL, inputTokens: completion?.usage.inputTokens, outputTokens: completion?.usage.outputTokens, latencyMs: completion?.latencyMs, finishedAt: ctx.now() }).where(eq(aiRuns.id, runId));
      });
    });
    return { data: { validation: errorCode ? null : result, error_code: errorCode, mode: errorCode ? 'manual_review_required' : 'ai_checked' } };
  });
}
