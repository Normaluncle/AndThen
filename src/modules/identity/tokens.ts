import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

export interface OpaqueToken {
  /** The raw secret. Returned once, never persisted. */
  token: string;
  /** SHA-256 hex of the raw token. This is what the database stores. */
  tokenHash: string;
  /** First 8 chars, for operator-facing display only. */
  tokenPrefix: string;
}

/** 256-bit random, URL-safe opaque token. Not a JWT: nothing is client-decodable. */
export function generateOpaqueToken(): OpaqueToken {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token: raw, tokenHash: hashToken(raw), tokenPrefix: raw.slice(0, 8) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison for equal-length hex digests. */
export function tokenHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function newId(): string {
  return randomUUID();
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
