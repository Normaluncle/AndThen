/**
 * Canonical error taxonomy (PRD §16.1). Every failure surfaced to a client uses
 * one of these codes; provider/vendor errors and secrets are never passed
 * through verbatim.
 */
export const ERROR_CODES = [
  'validation_error',
  'unsupported_media_type',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'source_incomplete',
  'consent_required',
  'author_unverified',
  'quota_exhausted',
  'model_timeout',
  'withdrawn',
  'service_unavailable',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_error: 400,
  unsupported_media_type: 415,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  source_incomplete: 422,
  consent_required: 422,
  author_unverified: 422,
  quota_exhausted: 429,
  model_timeout: 504,
  withdrawn: 410,
  service_unavailable: 503,
  internal_error: 500,
};

/**
 * Map a framework-raised HTTP status onto our taxonomy. Used for Fastify errors
 * that never passed through `AppError` (unsupported media type, payload too
 * large, ...) so a client mistake is never reported as a server failure.
 */
export function clientErrorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'validation_error';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 410:
      return 'withdrawn';
    case 415:
      return 'unsupported_media_type';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'validation_error';
  }
}

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  /** Safe, non-secret machine detail (e.g. which field failed). */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.status = STATUS_BY_CODE[options.code];
    this.details = options.details;
  }

  static validation(message = 'Request validation failed', details?: Record<string, unknown>) {
    return new AppError({ code: 'validation_error', message, details });
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError({ code: 'unauthorized', message });
  }
  static forbidden(message = 'Not permitted for this identity') {
    return new AppError({ code: 'forbidden', message });
  }
  static notFound(message = 'Resource not found') {
    return new AppError({ code: 'not_found', message });
  }
  static conflict(message = 'Conflicting state', details?: Record<string, unknown>) {
    return new AppError({ code: 'conflict', message, details });
  }
  static sourceIncomplete(message = 'Source material is incomplete') {
    return new AppError({ code: 'source_incomplete', message });
  }
  static consentRequired(message = 'Required consent is missing or revoked') {
    return new AppError({ code: 'consent_required', message });
  }
  static authorUnverified(message = 'Author ownership has not been verified') {
    return new AppError({ code: 'author_unverified', message });
  }
  static withdrawn(message = 'This resource has been withdrawn') {
    return new AppError({ code: 'withdrawn', message });
  }
  static serviceUnavailable(message = 'Dependency unavailable') {
    return new AppError({ code: 'service_unavailable', message });
  }
  static internal(message = 'Internal error', cause?: unknown) {
    return new AppError({ code: 'internal_error', message, cause });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/** Success envelope (PRD §16.1: request_id + status + data). */
export interface SuccessEnvelope<T> {
  request_id: string;
  status: 'ok';
  data: T;
}

/** Error envelope (PRD §16.1: request_id + status + error_code/message). */
export interface ErrorEnvelope {
  request_id: string;
  status: 'error';
  error_code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function success<T>(requestId: string, data: T): SuccessEnvelope<T> {
  return { request_id: requestId, status: 'ok', data };
}

export function failure(
  requestId: string,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  const envelope: ErrorEnvelope = { request_id: requestId, status: 'error', error_code: code, message };
  if (details !== undefined) envelope.details = details;
  return envelope;
}
