import { describe, expect, it } from 'vitest';
import {
  AI_JOB_KINDS,
  analysisResultSchema,
  followupDraftSchema,
  interviewGenerateDedupeKey,
  interviewTurnSchema,
  validationResultSchema,
} from '../../src/ai/tasks.js';

describe('AI output contracts', () => {
  it('accepts a well-formed analysis result', () => {
    const parsed = analysisResultSchema.safeParse({
      analysis_id: 'a1',
      schema_version: '1',
      source_id: '11111111-1111-1111-1111-111111111111',
      snapshot_hash: 'hash',
      material_level: 'exact_excerpt',
      case_type: 'plan',
      claims: [
        {
          id: 'c1',
          text: '打算考取证书',
          kind: 'plan',
          evidence_refs: ['s1'],
          time_anchor: '2021',
          time_anchor_basis: 'source_published_at',
        },
      ],
      missing_information: [],
      safety: 'clear_for_pilot',
      safety_reasons: [],
      recommended_action: 'invite',
      action_reasons: ['has_time_anchor'],
      reviewer_required: true,
      model_id: 'some-model',
      prompt_version: 'v1',
      created_at: '2026-09-12T00:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown safety level and action', () => {
    const bad = analysisResultSchema.safeParse({
      analysis_id: 'a1',
      schema_version: '1',
      source_id: '11111111-1111-1111-1111-111111111111',
      snapshot_hash: 'h',
      material_level: 'exact_excerpt',
      case_type: 'plan',
      claims: [],
      missing_information: [],
      safety: 'totally_fine',
      safety_reasons: [],
      recommended_action: 'auto_publish',
      action_reasons: [],
      reviewer_required: false,
      model_id: 'm',
      prompt_version: 'v1',
      created_at: 'now',
    });
    expect(bad.success).toBe(false);
  });

  it('validates interview turns and drafts', () => {
    expect(
      interviewTurnSchema.safeParse({
        turn_id: 't1',
        session_id: '11111111-1111-1111-1111-111111111111',
        question: '现在进展如何？',
        purpose: '补齐当前状态',
        basis_refs: ['s1'],
        author_message_id: null,
        skipped: false,
        stop_reason: null,
        generated_by: 'ai',
      }).success,
    ).toBe(true);

    expect(
      followupDraftSchema.safeParse({
        source_id: '11111111-1111-1111-1111-111111111111',
        snapshot_hash: 'h',
        interview_id: '22222222-2222-2222-2222-222222222222',
        version: 1,
        statements: [
          { id: 'st1', text: 'x', kind: 'author_report', evidence_refs: ['m1'], visibility: 'private' },
        ],
        unresolved_items: [],
        author_edits: [],
        author_confirmations: [],
        ai_assisted: true,
        content_hash: 'ch',
      }).success,
    ).toBe(true);
  });

  it('validates AI-D findings', () => {
    expect(
      validationResultSchema.safeParse({
        draft_content_hash: 'h',
        findings: [{ code: 'unsupported_fact', severity: 'blocking', statement_id: 'st1', message: 'no evidence' }],
        blocking: true,
      }).success,
    ).toBe(true);
  });

  it('exposes stable job kinds and a per-session serialization key', () => {
    expect(AI_JOB_KINDS.interviewNext).toBe('ai.interview.next');
    expect(interviewGenerateDedupeKey('abc')).toBe('interview:abc:generate');
  });
});
