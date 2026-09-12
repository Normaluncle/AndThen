'use strict';

/**
 * Redaction helpers. Anything that reaches a log or a CLI summary passes through
 * here first. Key-based redaction is the primary defence; value patterns cover
 * the token shapes that show up in commands and stderr.
 */

const SENSITIVE_KEY =
  /(token|secret|password|passwd|api[_-]?key|apikey|authorization|auth|cookie|credential|private[_-]?key|access[_-]?key|client[_-]?secret|session[_-]?token|proxy[_-]?auth)/i;

const PATTERNS = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, '[REDACTED_JWT]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/g, '$1$2:[REDACTED]@'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_TOKEN]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, '[REDACTED_TOKEN]'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]'],
  [
    /((?:token|secret|password|passwd|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|authorization)\s*[=:]\s*)([^\s"'&,;]+)/gi,
    '$1[REDACTED]',
  ],
];

function redactString(input) {
  if (typeof input !== 'string' || input.length === 0) return input;
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

function redactValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(k)) out[k] = '[REDACTED]';
    else out[k] = redactValue(v, depth + 1);
  }
  return out;
}

/** Serialize a redacted object for logs. */
function redactJson(value) {
  try {
    return JSON.stringify(redactValue(value));
  } catch {
    return '"[unserializable]"';
  }
}

/** Never log env values; only note which sensitive-looking keys were present. */
function envKeySummary(env) {
  return Object.keys(env || {}).filter((k) => SENSITIVE_KEY.test(k));
}

module.exports = { redactString, redactValue, redactJson, envKeySummary, SENSITIVE_KEY };
