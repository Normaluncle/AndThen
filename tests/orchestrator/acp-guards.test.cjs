'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runTask } = require('../../tools/workbuddy/lib/runner.cjs');
const { codes } = require('../../tools/workbuddy/lib/errors.cjs');
const { makeConfig, makeStore, makeLocks, writeTask, fakeLogPath, readFakeLog, methodOrder, recvOf } = require('./helpers.cjs');

const CWD = process.cwd();

function ctx(mode, dir) {
  const config = makeConfig({ stateDir: dir, extraEnv: { FAKE_ACP_MODE: mode, FAKE_ACP_LOG: fakeLogPath(dir) } });
  return { config, store: makeStore(config), locks: makeLocks(config), logPath: fakeLogPath(dir) };
}

test('confirms model + 1M context and reads back before the first prompt', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wb-guard-'));
  const { config, store, locks, logPath } = ctx('normal', dir);
  const taskFile = writeTask(dir);
  const result = await runTask({
    config,
    store,
    locks,
    task: { agent: { name: 'dev-a', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' },
    emit: () => {},
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.outcome, 'SUCCESS');

  const entries = readFakeLog(logPath);
  const order = methodOrder(entries);
  assert.deepEqual(order.slice(0, 2), ['initialize', 'session/new']);
  assert.ok(order.indexOf('session/prompt') > order.lastIndexOf('session/set_config_option'), 'prompt must come after config sets');

  const sets = recvOf(entries, 'session/set_config_option');
  const modelSet = sets.find((s) => s.params.configId === 'model');
  const ctxSet = sets.find((s) => s.params.configId === 'context_window');
  assert.equal(modelSet.params.value, 'deepseek-v4.1-flash');
  assert.equal(ctxSet.params.value, '1000000');

  const rec = store.readAgent('dev-a');
  assert.equal(rec.sessionId, result.sessionId);
  assert.equal(rec.confirmedWindow, '1000000');
  assert.equal(rec.confirmedModel, 'deepseek-v4.1-flash');
});

test('resume reloads the session, re-sets model + context, and ignores replayed events', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wb-guard-'));
  const { config, store, locks, logPath } = ctx('normal', dir);
  const taskFile = writeTask(dir);

  const first = await runTask({
    config,
    store,
    locks,
    task: { agent: { name: 'dev-r', cwd: CWD }, mode: 'new', taskFile, taskId: 'run-1' },
    emit: () => {},
  });
  assert.equal(first.status, 'completed');

  const agent = store.readAgent('dev-r');
  assert.ok(agent.sessionId);

  fs.writeFileSync(logPath, '');
  const second = await runTask({
    config,
    store,
    locks,
    task: { agent: { name: 'dev-r', cwd: CWD, sessionId: agent.sessionId }, mode: 'resume', taskFile, taskId: 'run-2' },
    emit: () => {},
  });
  assert.equal(second.status, 'completed');

  const entries = readFakeLog(logPath);
  const order = methodOrder(entries);
  assert.equal(order[0], 'initialize');
  assert.equal(order[1], 'session/load');
  assert.ok(order.indexOf('session/prompt') > order.lastIndexOf('session/set_config_option'), 'resume must re-set config before prompt');
  assert.ok(!order.includes('session/new'), 'resume must not create a new session');

  const sets = recvOf(entries, 'session/set_config_option');
  assert.equal(sets.find((s) => s.params.configId === 'context_window').params.value, '1000000');

  // Replayed history must not leak into current output.
  const logText = fs.readFileSync(store.logPath('dev-r'), 'utf8');
  assert.ok(!logText.includes('REPLAYED_OLD_OUTPUT'), 'replayed output must not be treated as current output');

  const checkpoint = store.readCheckpoint('dev-r', 'run-2');
  assert.ok(checkpoint.replayedEvents >= 2, 'replayed events should be counted, not emitted');
});

test('rejects a silent 300K fallback and terminates as failed', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wb-guard-'));
  const { config, store, locks } = ctx('window300k', dir);
  const taskFile = writeTask(dir);

  await assert.rejects(
    runTask({ config, store, locks, task: { agent: { name: 'dev-300k', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' }, emit: () => {} }),
    (err) => {
      assert.equal(err.code, codes.VIOLATION);
      assert.equal(err.result.status, 'failed');
      assert.equal(err.result.violations[0].type, 'context_window_mismatch');
      return true;
    },
  );
  assert.equal(store.readAgent('dev-300k').status, 'failed');
  assert.equal(locks.peek('agent', 'dev-300k'), null, 'lock must be released after violation');
});

test('rejects runtime model drift and marks failed', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wb-guard-'));
  const { config, store, locks } = ctx('model_drift', dir);
  const taskFile = writeTask(dir);

  await assert.rejects(
    runTask({ config, store, locks, task: { agent: { name: 'dev-drift', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' }, emit: () => {} }),
    (err) => {
      assert.equal(err.code, codes.VIOLATION);
      assert.equal(err.result.violations[0].type, 'model_drift');
      return true;
    },
  );
  assert.equal(store.readAgent('dev-drift').status, 'failed');
});

test('treats a non-SUCCESS outcome as needs_review even though the process exits 0', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wb-guard-'));
  const { config, store, locks } = ctx('outcome_error', dir);
  const taskFile = writeTask(dir);

  const result = await runTask({
    config,
    store,
    locks,
    task: { agent: { name: 'dev-outcome', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' },
    emit: () => {},
  });
  assert.equal(result.status, 'needs_review');
  assert.equal(result.outcome, 'ERROR');
});

test('refuses to resume without a sessionId and never spawns a child', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wb-guard-'));
  const { config, store, locks, logPath } = ctx('normal', dir);
  const taskFile = writeTask(dir);

  await assert.rejects(
    runTask({ config, store, locks, task: { agent: { name: 'dev-none', cwd: CWD }, mode: 'resume', taskFile, taskId: 't1' }, emit: () => {} }),
    (err) => {
      assert.equal(err.code, codes.NO_SESSION);
      return true;
    },
  );
  assert.equal(fs.existsSync(logPath), false, 'no child should have been spawned');
  assert.equal(locks.peek('agent', 'dev-none'), null);
});

test('a failed session/load does not silently create a new session', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wb-guard-'));
  const { config, store, locks, logPath } = ctx('load_fail', dir);
  const taskFile = writeTask(dir);
  store.writeAgent('dev-load', { name: 'dev-load', cwd: CWD, sessionId: 'sess-missing' });

  await assert.rejects(
    runTask({ config, store, locks, task: { agent: { name: 'dev-load', cwd: CWD, sessionId: 'sess-missing' }, mode: 'resume', taskFile, taskId: 't1' }, emit: () => {} }),
    (err) => {
      assert.equal(err.code, codes.RESUME_FAILED);
      return true;
    },
  );
  const order = methodOrder(readFakeLog(logPath));
  assert.ok(order.includes('session/load'));
  assert.ok(!order.includes('session/new'), 'must not recreate a missing session');
});
