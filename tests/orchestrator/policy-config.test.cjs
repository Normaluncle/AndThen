'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { redactString, redactValue } = require('../../tools/workbuddy/lib/redact.cjs');
const { classifyPermission, buildToolManifest } = require('../../tools/workbuddy/lib/policy.cjs');
const { resolveConfig } = require('../../tools/workbuddy/lib/config.cjs');
const { doctor } = require('../../tools/workbuddy/lib/doctor.cjs');
const { codes } = require('../../tools/workbuddy/lib/errors.cjs');

test('redacts assignment-style and prefixed secrets', () => {
  assert.ok(redactString('token=SUPERSECRETVALUE').includes('[REDACTED]'));
  assert.ok(!redactString('token=SUPERSECRETVALUE').includes('SUPERSECRETVALUE'));
  assert.ok(!redactString('Authorization: Bearer abcdef0123456789').includes('abcdef0123456789'));
  assert.ok(!redactString('https://user:hunter2@proxy.local:8080').includes('hunter2'));
});

test('redacts values by sensitive key name', () => {
  const redacted = redactValue({ apiKey: 'abc', nested: { password: 'def' }, keep: 'ok' });
  assert.deepEqual(redacted, { apiKey: '[REDACTED]', nested: { password: '[REDACTED]' }, keep: 'ok' });
});

test('classifies tool permissions: allow, deny, escalate', () => {
  assert.equal(classifyPermission({ name: 'Bash', rawInput: { command: 'git reset --hard HEAD' } }).decision, 'deny');
  assert.equal(classifyPermission({ name: 'Bash', rawInput: { command: 'rm -rf /' } }).decision, 'deny');
  assert.equal(classifyPermission({ name: 'Bash', rawInput: { command: 'git clean -fd' } }).decision, 'deny');
  assert.equal(classifyPermission({ name: 'Bash', rawInput: { command: 'docker volume rm pgdata' } }).decision, 'deny');
  assert.equal(classifyPermission({ name: 'Bash', rawInput: { command: 'npm test' } }).decision, 'allow');
  assert.equal(classifyPermission({ name: 'Task' }).decision, 'deny');

  const escalated = classifyPermission({ name: 'Bash', rawInput: { command: 'git reset HEAD~1' } });
  assert.equal(escalated.decision, 'escalate');
  assert.equal(escalated.needsMainControl, true);
});

test('tool manifest never enables bypassPermissions or agent delegation', () => {
  const manifest = buildToolManifest();
  assert.equal(manifest.permissionMode, 'acceptEdits');
  assert.ok(manifest.disallowedTools.includes('Task'));
  assert.ok(manifest.disallowedTools.includes('Agent'));
  assert.ok(!manifest.allowedTools.includes('Task'));
});

test('pins the model, 1M context and concurrency guard', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cfg-'));
  const base = { stateDir, cli: 'C:/fake/codebuddy' };
  const config = resolveConfig({ argv: base, env: {}, cwd: process.cwd() });
  assert.equal(config.model, 'deepseek-v4.1-flash');
  assert.equal(config.contextWindow, 1000000);
  assert.equal(config.autocompact, '1000000');
  assert.equal(config.permissionMode, 'acceptEdits');
  assert.equal(config.maxConcurrency, 2);
  assert.equal(path.resolve(config.stateDir), path.resolve(stateDir));

  assert.throws(
    () => resolveConfig({ argv: { ...base, maxConcurrency: 3 }, env: {}, cwd: process.cwd() }),
    (err) => {
      assert.equal(err.code, codes.CONFIG);
      return true;
    },
  );

  const verified = resolveConfig({ argv: { ...base, maxConcurrency: 3, verifiedConcurrency3: true }, env: {}, cwd: process.cwd() });
  assert.equal(verified.maxConcurrency, 3);

  const capped = resolveConfig({ argv: { ...base, maxConcurrency: 9, verifiedConcurrency3: true }, env: {}, cwd: process.cwd() });
  assert.equal(capped.maxConcurrency, 3);
});

test('doctor validates the discovered CLI and product snapshot', (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-doc-'));
  const config = resolveConfig({ argv: { stateDir }, env: {}, cwd: process.cwd() });
  if (!config.cliPath || !config.productConfigPath || !fs.existsSync(config.productConfigPath)) {
    t.skip('WorkBuddy CLI or product snapshot not available on this machine');
    return;
  }
  const report = doctor(config);
  assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
  const product = report.checks.find((c) => c.name === 'product-config');
  assert.ok(product.detail.includes('deepseek-v4.1-flash'));
  assert.ok(product.detail.includes('1000000'));
});
