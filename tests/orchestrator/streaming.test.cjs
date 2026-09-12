'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTask } = require('../../tools/workbuddy/lib/runner.cjs');
const { makeConfig, makeStore, makeLocks, writeTask, fakeLogPath } = require('./helpers.cjs');

const CWD = process.cwd();

function setup(mode, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-stream-'));
  const config = makeConfig({
    stateDir: dir,
    extraEnv: { FAKE_ACP_MODE: mode, FAKE_ACP_LOG: fakeLogPath(dir) },
    ...extra,
  });
  return { config, store: makeStore(config), locks: makeLocks(config), dir };
}

test('streams message text by line and prints one line per tool start/terminal result', async () => {
  const { config, store, locks, dir } = setup('stream');
  const taskFile = writeTask(dir);
  const lines = [];
  const result = await runTask({
    config,
    store,
    locks,
    task: { agent: { name: 'dev-stream', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' },
    emit: (line) => lines.push(line),
  });

  assert.equal(result.status, 'completed');
  assert.ok(lines.includes('TOOL Read start'));
  assert.ok(lines.includes('TOOL Read completed'));
  assert.ok(lines.includes('TOOL Bash start'));
  assert.ok(lines.includes('TOOL Bash failed'));

  // No per-chunk noise and no undefined status lines.
  assert.ok(!lines.some((l) => /undefined/.test(l)), `no undefined lines, got: ${JSON.stringify(lines)}`);

  // Assistant text is emitted as whole lines, not one token per line.
  assert.deepEqual(
    lines.filter((l) => l === 'Hello world' || l === 'second line'),
    ['Hello world', 'second line'],
  );
  assert.ok(!lines.includes('Hel'));

  // Tool titles with embedded scripts / secrets are summarized and redacted.
  assert.ok(!lines.some((l) => l.includes('node -e')), 'embedded script must not be printed');
  assert.ok(!lines.some((l) => l.includes('SUPERSECRETTOKENVALUE')), 'secret must not be printed');
  assert.ok(!lines.some((l) => l.includes('\n')), 'emitted lines must be single-line');

  // Detailed tool list is stored locally, redacted.
  const checkpoint = store.readCheckpoint('dev-stream', 't1');
  assert.equal(checkpoint.tools.find((t) => t.name === 'Read').status, 'completed');
  assert.equal(checkpoint.tools.find((t) => t.name === 'Bash').status, 'failed');
  assert.ok(!JSON.stringify(checkpoint.tools).includes('SUPERSECRETTOKENVALUE'), 'stored detail must be redacted');
});

test('quiet mode suppresses assistant text but keeps tool and status lines', async () => {
  const { config, store, locks, dir } = setup('stream', { quiet: true });
  const taskFile = writeTask(dir);
  const lines = [];
  const result = await runTask({
    config,
    store,
    locks,
    task: { agent: { name: 'dev-stream-q', cwd: CWD }, mode: 'new', taskFile, taskId: 't1' },
    emit: (line) => lines.push(line),
  });

  assert.equal(result.status, 'completed');
  assert.ok(lines.includes('TOOL Read start'));
  assert.ok(!lines.includes('Hello world'), 'quiet mode must not stream assistant text');

  // Assistant text is still recorded in the redacted local log.
  const logText = fs.readFileSync(store.logPath('dev-stream-q'), 'utf8');
  assert.ok(logText.includes('Hello world'));
});
