import { z } from 'zod';

/**
 * Frozen AI output contracts (PRD §14.2 / §14.3). These are project-defined
 * shapes, not responses from any external platform API. Later AI modules (AI-A
 * extract, AI-B interview, AI-C draft, AI-D validate) must validate their model
 * output against these before persisting it.
 */

export const AI_TASKS = ['ai_a_extract', 'ai_b_interview', 'ai_c_draft', 'ai_d_val'] as const;
export type AiTaskName = (typeof AI_TASKS)[number];

export const MATERIAL_LEVELS = [
  'exact_excerpt',
  'summary_only',
  'author_recollection',
] as const;

export const CASE_TYPES = [
  'experience',
  'plan',
  'prediction',
  'commitment',
  'knowledge',
  'unknown',
] as const;

export const SAFETY_LEVELS = ['clear_for_pilot', 'manual_review', 'excluded'] as const;

export const RECOMMENDED_ACTIONS = [
  'invite',
  'hold',
  'not_suitable',
  'author_initiated',
] as const;

/** AI-A output: source analysis. `evidence_refs` must hit the current snapshot. */
export const claimSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.string(),
  evidence_refs: z.array(z.string()),
  time_anchor: z.string().nullable(),
  time_anchor_basis: z.string().nullable(),
});

export const analysisResultSchema = z.object({
  analysis_id: z.string(),
  schema_version: z.string(),
  source_id: z.string().uuid(),
  snapshot_hash: z.string(),
  material_level: z.enum(MATERIAL_LEVELS),
  case_type: z.enum(CASE_TYPES),
  claims: z.array(claimSchema),
  missing_information: z.array(z.string()),
  safety: z.enum(SAFETY_LEVELS),
  safety_reasons: z.array(z.string()),
  recommended_action: z.enum(RECOMMENDED_ACTIONS),
  action_reasons: z.array(z.string()),
  reviewer_required: z.boolean(),
  model_id: z.string(),
  prompt_version: z.string(),
  created_at: z.string(),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

/** AI-B output: one interview turn. One main question, with its purpose. */
export const interviewTurnSchema = z.object({
  turn_id: z.string(),
  session_id: z.string().uuid(),
  question: z.string(),
  purpose: z.string(),
  basis_refs: z.array(z.string()),
  author_message_id: z.string().nullable(),
  skipped: z.boolean(),
  stop_reason: z.string().nullable(),
  generated_by: z.enum(['ai', 'manual', 'fallback_form']),
});
export type InterviewTurn = z.infer<typeof interviewTurnSchema>;

export const STATEMENT_KINDS = [
  'source_quote',
  'author_report',
  'author_reflection',
  'ai_summary',
] as const;

export const draftStatementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(STATEMENT_KINDS),
  evidence_refs: z.array(z.string()),
  visibility: z.enum(['private', 'public']),
});

/** AI-C output: a follow-up draft awaiting per-item author confirmation. */
export const followupDraftSchema = z.object({
  source_id: z.string().uuid(),
  snapshot_hash: z.string(),
  interview_id: z.string().uuid(),
  version: z.number().int().positive(),
  statements: z.array(draftStatementSchema),
  unresolved_items: z.array(z.unknown()),
  author_edits: z.array(z.unknown()),
  author_confirmations: z.array(z.unknown()),
  ai_assisted: z.boolean(),
  content_hash: z.string(),
});
export type FollowupDraft = z.infer<typeof followupDraftSchema>;

/** AI-D output: rule-first validation findings. */
export const validationFindingSchema = z.object({
  code: z.enum([
    'missing_source',
    'contradiction',
    'sensitive_field',
    'unsupported_fact',
    'missing_time_anchor',
  ]),
  severity: z.enum(['blocking', 'warning']),
  statement_id: z.string().nullable(),
  message: z.string(),
});

export const validationResultSchema = z.object({
  draft_content_hash: z.string(),
  findings: z.array(validationFindingSchema),
  blocking: z.boolean(),
});
export type ValidationResult = z.infer<typeof validationResultSchema>;

/** Job kind constants used by AI modules when enqueueing work. */
export const AI_JOB_KINDS = {
  extract: 'ai.extract',
  interviewNext: 'ai.interview.next',
  draft: 'ai.draft',
  validate: 'ai.validate',
} as const;

/** Serialization key for interview generation (one in-flight generation/session). */
export function interviewGenerateDedupeKey(sessionId: string): string {
  return `interview:${sessionId}:generate`;
}
