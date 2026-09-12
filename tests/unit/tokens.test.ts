import { describe, expect, it } from 'vitest';
import {
  generateOpaqueToken,
  hashToken,
  sha256,
  tokenHashEquals,
} from '../../src/modules/identity/tokens.js';

describe('opaque session tokens', () => {
  it('generates a high-entropy URL-safe token whose hash is not the token', () => {
    const t = generateOpaqueToken();
    expect(t.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.tokenHash).not.toContain(t.token);
    expect(t.tokenPrefix).toBe(t.token.slice(0, 8));
    expect(hashToken(t.token)).toBe(t.tokenHash);
    expect(sha256(t.token)).toBe(t.tokenHash);
  });

  it('never repeats a token across many draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateOpaqueToken().token);
    expect(seen.size).toBe(500);
  });

  it('compares digests without throwing on length mismatch', () => {
    const a = hashToken('a');
    expect(tokenHashEquals(a, a)).toBe(true);
    expect(tokenHashEquals(a, hashToken('b'))).toBe(false);
    expect(tokenHashEquals(a, 'short')).toBe(false);
  });
});
