import { describe, expect, it } from 'vitest';
import {
  AppError,
  ERROR_CODES,
  failure,
  isAppError,
  statusForCode,
  success,
} from '../../src/http/errors.js';

describe('error taxonomy', () => {
  it('maps every PRD error code to a sane HTTP status', () => {
    expect(statusForCode('unauthorized')).toBe(401);
    expect(statusForCode('forbidden')).toBe(403);
    expect(statusForCode('source_incomplete')).toBe(422);
    expect(statusForCode('consent_required')).toBe(422);
    expect(statusForCode('author_unverified')).toBe(422);
    expect(statusForCode('conflict')).toBe(409);
    expect(statusForCode('quota_exhausted')).toBe(429);
    expect(statusForCode('model_timeout')).toBe(504);
    expect(statusForCode('withdrawn')).toBe(410);
    for (const code of ERROR_CODES) {
      expect(statusForCode(code)).toBeGreaterThanOrEqual(400);
      expect(statusForCode(code)).toBeLessThan(600);
    }
  });

  it('builds AppError with the code-derived status', () => {
    const err = AppError.consentRequired('nope');
    expect(isAppError(err)).toBe(true);
    expect(err.status).toBe(422);
    expect(err.code).toBe('consent_required');
    expect(isAppError(new Error('x'))).toBe(false);
  });

  it('emits the PRD response envelopes', () => {
    expect(success('req-1', { a: 1 })).toEqual({
      request_id: 'req-1',
      status: 'ok',
      data: { a: 1 },
    });
    const err = failure('req-2', 'forbidden', 'no');
    expect(err).toEqual({
      request_id: 'req-2',
      status: 'error',
      error_code: 'forbidden',
      message: 'no',
    });
  });
});
