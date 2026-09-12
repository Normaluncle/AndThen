import { createHash } from 'node:crypto';
import { z } from 'zod';
import { draftStatementSchema, type ValidationResult } from './tasks.js';

export type Statement = z.infer<typeof draftStatementSchema>;
export interface Evidence { id: string; text: string; visibility: 'private' | 'public' }

/** Object-key order cannot invalidate a confirmation; array order is meaningful. */
export function contentHash(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') return Object.fromEntries(
      Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]),
    );
    return v;
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** Conservative Demo rule: published assertions must be verbatim evidence.
 * Semantic paraphrases stay blocked until an explicit author edit becomes evidence.
 * This intentionally does not pretend a model can prove arbitrary entailment.
 */
export function validateStatements(statements: Statement[], evidence: Evidence[]): ValidationResult {
  const findings: ValidationResult['findings'] = [];
  const byId = new Map(evidence.map(e => [e.id, e]));
  const ids = new Set<string>();
  for (const s of statements) {
    const add = (code: ValidationResult['findings'][number]['code'], message: string) =>
      findings.push({ code, severity: 'blocking', statement_id: s.id, message });
    if (!s.id || ids.has(s.id)) add('contradiction', 'Statement IDs must be unique');
    ids.add(s.id);
    const refs = s.evidence_refs.map(id => byId.get(id));
    if (!refs.length || refs.some(e => !e)) {
      add('missing_source', 'Each statement needs existing evidence');
      continue;
    }
    if (s.visibility === 'public' && refs.some(e => e!.visibility === 'private')) {
      add('sensitive_field', 'Private evidence cannot support a public statement');
    }
    if (!s.text.trim() || !refs.some(e => e!.text.includes(s.text))) {
      add('unsupported_fact', 'Use an exact evidence excerpt or explicitly supply an author edit');
    }
  }
  return { draft_content_hash: contentHash(statements), findings, blocking: findings.length > 0 };
}
