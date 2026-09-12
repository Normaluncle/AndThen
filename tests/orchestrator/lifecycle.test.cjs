'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTask } = require('../../tools/workbuddy/lib/runner.cjs');
const { codes } = require('../../tools/workbuddy/lib/errors.cjs');
const { makeConfig, makeStore, makeLocks, writeTask, fakeLogPath, readFakeLog } = require('./helpers.cjs');

const CWD = process.cwd();

function ctx(mode, dir, timeouts) {
  const config = makeConfig({
    stateDir: dir,
    extraEnv: { FAKE_ACP_MODE: mode, FAKE_ACP_LOG: fakeLogPath(dir) },
    timeouts: timeouts || { request: 10000, prompt: 10000, lockWait: 0 },
  });
  return { config, store: makeStore(config), locks: makeLocks(config), logPath: fakeLogPath(dir) };
}

test('a mid-run disconnect fails the task and releases the agent lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-life-'));
  const { config, store, locks } = ctx('disconnect', dir);
  const taskFile = writeTask(dir);

  await assert.rejects(
    runTask({ config, store, locks, task: { agent: { name: 'dev-dc', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' }, emit: () => {} }),
    (err) => {
      assert.equal(err.code, codes.DISCONNECT);
      assert.equal(err.result.status, 'failed');
      return true;
    },
  );
  assert.equal(locks.peek('agent', 'dev-dc'), null, 'lock must be cleared after disconnect');
  assert.equal(store.readAgent('dev-dc').status, 'failed');
});

test('a prompt timeout fails the task, kills the child and releases the lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-life-'));
  const { config, store, locks } = ctx('hang', dir, { request: 10000, prompt: 400, lockWait: 0 });
  const taskFile = writeTask(dir);

  await assert.rejects(
    runTask({ config, store, locks, task: { agent: { name: 'dev-hang', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' }, emit: () => {} }),
    (err) => {
      assert.equal(err.code, codes.TIMEOUT);
      assert.equal(err.result.status, 'failed');
      return true;
    },
  );
  assert.equal(locks.peek('agent', 'dev-hang'), null);
});

test('redacts secrets from stderr before they reach logs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-life-'));
  const { config, store, locks } = ctx('stderr_secret', dir);
  const taskFile = writeTask(dir);

  await runTask({ config, store, locks, task: { agent: { name: 'dev-redact', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' }, emit: () => {} });
  const logText = fs.readFileSync(store.logPath('dev-redact'), 'utf8');
  assert.ok(!logText.includes('SUPERSECRETTOKENVALUE'), 'raw token must not be logged');
  assert.ok(!logText.includes('abcdef0123456789'), 'bearer value must not be logged');
  assert.ok(logText.includes('[REDACTED]'), 'redaction marker should be present');
});

test('denies a forbidden permission request and audits it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-life-'));
  const { config, store, locks, logPath } = ctx('permission_forbidden', dir);
  const taskFile = writeTask(dir);

  const result = await runTask({ config, store, locks, task: { agent: { name: 'dev-perm', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' }, emit: () => {} });
  assert.equal(result.status, 'completed');

  const entries = readFakeLog(logPath);
  const response = entries.find((e) => e.dir === 'permission_response');
  assert.ok(response, 'fake should have received a permission response');
  assert.equal(response.result.outcome.outcome, 'cancelled');

  const audit = store.readAudit('dev-perm');
  const request = audit.find((e) => e.type === 'permission_request');
  const outcome = audit.find((e) => e.type === 'permission_result');
  assert.equal(request.decision, 'deny');
  assert.equal(outcome.outcome, 'cancelled');
});

test('allows an ordinary project command and audits the selection', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-life-'));
  const { config, store, locks, logPath } = ctx('permission_allowed', dir);
  const taskFile = writeTask(dir);

  const result = await runTask({ config, store, locks, task: { agent: { name: 'dev-perm-ok', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' }, emit: () => {} });
  assert.equal(result.status, 'completed');

  const entries = readFakeLog(logPath);
  const response = entries.find((e) => e.dir === 'permission_response');
  assert.equal(response.result.outcome.outcome, 'selected');
  assert.equal(response.result.outcome.optionId, 'allow');

  const audit = store.readAudit('dev-perm-ok');
  assert.equal(audit.find((e) => e.type === 'permission_request').decision, 'allow');
  assert.equal(audit.find((e) => e.type === 'permission_result').outcome, 'selected');
});
