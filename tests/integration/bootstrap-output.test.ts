import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestContext, type TestContext } from '../helpers/testdb.js';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext('bootstrap_output'); });
afterAll(async () => { await ctx.close(); });
it('writes a bootstrap credential only to the requested file, including with --json', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'andthen-bootstrap-output-'));
  const target = join(directory, 'login.token');
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/bootstrap/admin.ts', '--email', 'bootstrap-fixture@example.test', '--out', target, '--json'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: ctx.env.DATABASE_URL } });
    const secret = (await readFile(target, 'utf8')).trim();
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(stdout).toBe('');
    expect(stderr).not.toContain(secret);
  } finally {
    await unlink(target).catch(() => {});
    await rmdir(directory);
  }
});
