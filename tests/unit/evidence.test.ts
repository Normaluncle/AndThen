import { describe, it, expect } from 'vitest';
import { contentHash, validateStatements, type Statement } from '../../src/ai/evidence.js';

const statement: Statement = { id: 's1', text: '项目完成了', kind: 'author_report', visibility: 'public', evidence_refs: ['m1'] };
describe('deterministic evidence and confirmation rules', () => {
  it('accepts exact public evidence and rejects invented dates and numbers', () => {
    const evidence = [{ id: 'm1', text: '后来项目完成了。', visibility: 'public' as const }];
    expect(validateStatements([statement], evidence).blocking).toBe(false);
    expect(validateStatements([{ ...statement, text: '2025年项目完成了，收入100万' }], evidence).blocking).toBe(true);
  });
  it('rejects missing refs, private evidence leaks and duplicate statement ids', () => {
    expect(validateStatements([statement], []).findings[0]?.code).toBe('missing_source');
    const evidence = [{ id: 'm1', text: statement.text, visibility: 'private' as const }];
    expect(validateStatements([statement], evidence).findings[0]?.code).toBe('sensitive_field');
    expect(validateStatements([{ ...statement, visibility: 'private' }, { ...statement, visibility: 'private' }], evidence).blocking).toBe(true);
  });
  it('hashes semantic object keys consistently but detects changed content/order', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
    expect(contentHash(statement)).not.toBe(contentHash({ ...statement, text: 'changed' }));
  });
});
