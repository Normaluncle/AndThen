import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleContext, ModuleRegistrar } from '../../shared/types.js';
import type { Executor } from '../../db/client.js';
import type { JobHandlerRegistry } from '../../jobs/types.js';
import { sources, sourceSnapshots, authorVerifications, aiRuns } from '../../db/schema.js';
import { requireReadableSource, latestSnapshot } from './service.js';
import { hasActiveConsent } from './access.js';
import { AppError, success } from '../../http/errors.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { analysisResultSchema, AI_JOB_KINDS } from '../../ai/tasks.js';
import { createLlmClient } from '../../ai/client.js';
import { PROMPTS, PROMPT_VERSION } from '../../ai/prompts.js';
import { withJobFence, JobLeaseLostError } from '../../jobs/transaction.js';

const candidateSchema = analysisResultSchema.pick({ case_type: true, claims: true, missing_information: true, safety: true, safety_reasons: true, recommended_action: true, action_reasons: true, reviewer_required: true }).strict();

/** A conservative deterministic screen, not a claim of complete risk detection. */
export function sourceRisk(text: string): string[] {
  return /未成年|自杀|病历|身份证|银行卡|诊断|投资建议|诉讼|minor\b|suicid|medical record/i.test(text) ? ['sensitive_material_requires_human_review'] : [];
}

export async function requireModelSource(db: Executor, sourceId: string, hash: string) {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).for('update');
  if (!source || source.deletedAt) throw AppError.withdrawn();
  const snapshot = await latestSnapshot(db, sourceId);
  if (!snapshot || snapshot.contentHash !== hash) throw AppError.conflict('Source snapshot changed');
  if (source.sourceType === 'third_party_link' || ['pending', 'rejected'].includes(source.permissionStatus)) throw AppError.consentRequired();
  const [verification] = await db.select().from(authorVerifications).where(and(eq(authorVerifications.sourceId, sourceId), eq(authorVerifications.status, 'verified'))).limit(1);
  const owner = verification?.userId ?? (source.sourceType === 'author_paste' ? source.createdByUserId : null);
  if (!owner || !await hasActiveConsent(db, sourceId, 'external_model_processing', owner)) throw AppError.consentRequired();
  const text = snapshot.body ?? snapshot.excerpt ?? '';
  if (!text.trim() || text.length > 64000) throw AppError.sourceIncomplete('Material empty or exceeds input budget');
  return { source, snapshot, owner, text };
}

export const registerAnalysisRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ id: z.string().uuid() });
  api.post('/sources/:id/analyze', { preHandler: [app.authenticate], schema: { tags: ['analysis'], security: [{ bearerAuth: [] }], params,
    summary: 'Enqueue snapshot-bound analysis after permission and risk checks', body: z.object({ snapshot_hash: z.string().min(1).max(128) }).strict(),
    response: { 202: envelopeSchema(z.object({ job_id: z.string().uuid(), deduped: z.boolean() })), 404: errorEnvelopeSchema, 409: errorEnvelopeSchema, 422: errorEnvelopeSchema, 503: errorEnvelopeSchema } } }, async (req, reply) => {
    const auth = requireAuthContext(req);
    const data = await ctx.db.transaction(async tx => {
      await requireReadableSource(tx, auth, req.params.id);
      const state = await requireModelSource(tx, req.params.id, req.body.snapshot_hash);
      const risk = sourceRisk(state.text);
      if (!risk.length && !createLlmClient(ctx.env, ctx.logger).configured) throw AppError.serviceUnavailable('Model unconfigured; manual review remains available');
      const result = await ctx.jobs.enqueue({ kind: AI_JOB_KINDS.extract, dedupeKey: `analyze:${auth.userId}:${state.source.id}:${state.snapshot.contentHash}`, maxAttempts: 1,
        payload: { source_id: state.source.id, snapshot_hash: state.snapshot.contentHash, owner_user_id: auth.userId, request_id: req.id } }, tx);
      return { job_id: result.job.id, deduped: result.deduped };
    });
    return reply.code(202).send(success(req.id, data));
  });
  api.get('/sources/:id/analysis', { preHandler: [app.authenticate], schema: { tags: ['analysis'], security: [{ bearerAuth: [] }], params, summary: 'Read latest analysis for the current source snapshot; stale analysis is not reused',
    response: { 200: envelopeSchema(z.object({ analysis: analysisResultSchema.nullable(), status: z.string() })), 404: errorEnvelopeSchema } } }, async req => {
    await requireReadableSource(ctx.db, requireAuthContext(req), req.params.id);
    const snapshot = await latestSnapshot(ctx.db, req.params.id);
    const runs = await ctx.db.select().from(aiRuns).where(and(eq(aiRuns.sourceId, req.params.id), eq(aiRuns.task, 'ai_a_extract'), eq(aiRuns.status, 'succeeded'))).orderBy(desc(aiRuns.createdAt)).limit(20);
    const match = runs.find(r => r.output?.snapshot_hash === snapshot?.contentHash);
    return success(req.id, { analysis: match ? analysisResultSchema.parse(match.output) : null, status: match ? 'available' : 'not_analyzed_current_snapshot' });
  });
};

export function registerAnalysisJobs(ctx: ModuleContext, registry: JobHandlerRegistry) {
  registry.register(AI_JOB_KINDS.extract, async job => {
    const p = z.object({ source_id: z.string().uuid(), snapshot_hash: z.string(), owner_user_id: z.string().uuid(), request_id: z.string() }).parse(job.payload);
    const runId = randomUUID();
    const state = await ctx.db.transaction(async tx => {
      const state = await requireModelSource(tx, p.source_id, p.snapshot_hash);
      await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
        await fenced.insert(aiRuns).values({ id: runId, task: 'ai_a_extract', status: 'running', sourceId: p.source_id, jobId: job.job.id, requestId: p.request_id, promptVersion: PROMPT_VERSION, modelId: ctx.env.LLM_MODEL });
      });
      return state;
    });
    const risks = sourceRisk(state.text);
    const evidenceId = `snapshot:${state.snapshot.id}`;
    let completion: Awaited<ReturnType<ReturnType<typeof createLlmClient>['complete']>> | undefined;
    let candidate: z.infer<typeof candidateSchema> | undefined;
    let errorCode: string | null = null;
    try {
      if (risks.length) {
        candidate = { case_type: 'unknown', claims: [], missing_information: ['human_risk_review'], safety: 'manual_review', safety_reasons: risks, recommended_action: 'hold', action_reasons: risks, reviewer_required: true };
      } else {
        completion = await createLlmClient(ctx.env, ctx.logger).complete({ json: true, maxTokens: 3000, temperature: 0, signal: job.signal,
          messages: [{ role: 'system', content: PROMPTS.ai_a_extract }, { role: 'user', content: JSON.stringify({ evidence: [{ id: evidenceId, text: state.text }], material_level: state.snapshot.materialLevel, published_at: state.snapshot.publishedAt }) }] });
        candidate = candidateSchema.parse(JSON.parse(completion.content));
        if (candidate.claims.length > 50) throw AppError.sourceIncomplete('Too many claims');
        for (const claim of candidate.claims) {
          if (!claim.text.trim() || !state.text.includes(claim.text) || !claim.evidence_refs.length || claim.evidence_refs.some(id => id !== evidenceId)) throw AppError.sourceIncomplete('Unsupported claim or reference');
          if (claim.time_anchor !== null && (!claim.time_anchor_basis || !state.text.includes(claim.time_anchor_basis) || !claim.time_anchor_basis.includes(claim.time_anchor))) throw AppError.sourceIncomplete('Unsupported time anchor');
        }
        if (!state.snapshot.publishedAt || state.snapshot.materialLevel !== 'exact_excerpt') candidate.reviewer_required = true;
      }
    } catch (err) {
      if (job.signal.aborted) throw err;
      errorCode = err instanceof AppError ? err.code : 'invalid_model_output';
    }
    const output = candidate && !errorCode ? analysisResultSchema.parse({ ...candidate, analysis_id: runId, schema_version: '1', source_id: p.source_id, snapshot_hash: p.snapshot_hash,
      material_level: state.snapshot.materialLevel === 'exact_excerpt' ? 'exact_excerpt' : state.snapshot.materialLevel === 'author_recollection' ? 'author_recollection' : 'summary_only',
      model_id: completion?.model ?? 'deterministic_rules', prompt_version: PROMPT_VERSION, created_at: ctx.now().toISOString() }) : null;
    await ctx.db.transaction(async tx => {
      try { await requireModelSource(tx, p.source_id, p.snapshot_hash); }
      catch { throw new JobLeaseLostError(job.job.id, 'source or permission changed'); }
      await withJobFence(tx, { jobId: job.job.id, fencingToken: job.job.fencingToken }, async fenced => {
        await fenced.update(aiRuns).set({ status: errorCode ? 'failed' : 'succeeded', output, errorCode, modelId: completion?.model ?? (risks.length ? 'deterministic_rules' : ctx.env.LLM_MODEL), finishedAt: ctx.now(), inputTokens: completion?.usage.inputTokens, outputTokens: completion?.usage.outputTokens, latencyMs: completion?.latencyMs }).where(eq(aiRuns.id, runId));
      });
    });
    return { data: { analysis_id: runId, analysis_status: errorCode ? 'failed' : 'succeeded', error_code: errorCode, fallback_mode: errorCode ? 'manual_review' : null } };
  });
}
