export {
  createLlmClient,
  type LlmChatMessage,
  type LlmClient,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmUsage,
} from './client.js';

export {
  AI_JOB_KINDS,
  AI_TASKS,
  CASE_TYPES,
  MATERIAL_LEVELS,
  RECOMMENDED_ACTIONS,
  SAFETY_LEVELS,
  STATEMENT_KINDS,
  analysisResultSchema,
  claimSchema,
  draftStatementSchema,
  followupDraftSchema,
  interviewGenerateDedupeKey,
  interviewTurnSchema,
  validationFindingSchema,
  validationResultSchema,
} from './tasks.js';

export type {
  AiTaskName,
  AnalysisResult,
  FollowupDraft,
  InterviewTurn,
  ValidationResult,
} from './tasks.js';
