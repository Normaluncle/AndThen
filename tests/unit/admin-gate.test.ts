import { describe, expect, it } from 'vitest';
import { verifyAdminConsolePassword } from '../../src/modules/identity/admin-gate.js';

describe('admin console password', () => {
  it('accepts only the configured console password', async () => {
    expect(await verifyAdminConsolePassword('')).toBe(false);
    expect(await verifyAdminConsolePassword('not-the-password')).toBe(false);
    expect(await verifyAdminConsolePassword('QAZWSXEDCRFVTGB..1')).toBe(true);
  });
});
