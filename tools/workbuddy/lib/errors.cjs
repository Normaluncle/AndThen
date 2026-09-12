'use strict';

/** Process exit codes for the orchestrator CLI. */
const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  DOCTOR: 3,
  LOCKED: 4,
  NEEDS_REVIEW: 5,
  VIOLATION: 6,
  NO_SESSION: 7,
  CONFIG: 8,
});

const codes = Object.freeze({
  USAGE: 'E_USAGE',
  CONFIG: 'E_CONFIG',
  LOCKED: 'E_LOCKED',
  NO_SESSION: 'E_NO_SESSION',
  RESUME_FAILED: 'E_RESUME_FAILED',
  VIOLATION: 'E_VIOLATION',
  TIMEOUT: 'E_TIMEOUT',
  DISCONNECT: 'E_DISCONNECT',
  OUTCOME: 'E_OUTCOME',
  NEEDS_REVIEW: 'E_NEEDS_REVIEW',
  FORBIDDEN: 'E_FORBIDDEN',
  DOCTOR: 'E_DOCTOR',
  INTERNAL: 'E_INTERNAL',
});

class OrchError extends Error {
  constructor(code, message, { exitCode = EXIT.ERROR, details = {} } = {}) {
    super(message);
    this.name = 'OrchError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

module.exports = { EXIT, codes, OrchError };
