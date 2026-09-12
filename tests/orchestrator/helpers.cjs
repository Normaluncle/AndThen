'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore } = require('../../tools/workbuddy/lib/state.cjs');
const { LockManager } = require('../../tools/workbuddy/lib/locks.cjs');
const { ALLOWED_TOOLS, DISALLOWED_TOOLS, PERMISSION_MODE } = require('../../tools/workbuddy/lib/policy.cjs');

const FAKE_ACP = path.join(__dirname, 'fake-acp-child.cjs');

function mkdtemp(prefix = 'wb-orch-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Build a config object shaped like resolveConfig() output, pointed at the fake
 * ACP child. Tests pass `extraEnv` to select the fake's behaviour.
 */
function makeConfig(overrides = {}) {
  const stateDir = overrides.stateDir || mkdtemp();
  return {
    projectRoot: process.cwd(),
    mainRoot: process.cwd(),
    stateDir,
    cliPath: FAKE_ACP,
    productConfigPath: null,
    installedProductConfigPath: null,
    proxy: { source: 'none', address: null, enabled: false },
    model: 'deepseek-v4.1-flash',
    contextWindow: 1000000,
    autocompact: '1000000',
    maxConcurrency: 2,
    concurrencyVerified: false,
    quiet: false,
    permissionMode: PERMISSION_MODE,
    allowedTools: [...ALLOWED_TOOLS],
    disallowedTools: [...DISALLOWED_TOOLS],
    timeouts: { request: 10000, prompt: 10000, lockWait: 0 },
    extraEnv: {},
    cwd: process.cwd(),
    ...overrides,
  };
}

function makeStore(config) {
  return new StateStore({ dir: config.stateDir });
}

function makeLocks(config) {
  return new LockManager({ dir: config.stateDir });
}

function writeTask(dir, text = 'Do the thing.') {
  const file = path.join(dir, 'task.md');
  fs.writeFileSync(file, text);
  return file;
}

function fakeLogPath(dir) {
  return path.join(dir, 'fake-acp.jsonl');
}

function readFakeLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function methodOrder(entries) {
  return entries.filter((e) => e.dir === 'recv').map((e) => e.method);
}

function recvOf(entries, method) {
  return entries.filter((e) => e.dir === 'recv' && e.method === method);
}

/** A fake run function for scheduler tests; resolves when released. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

module.exports = {
  FAKE_ACP,
  mkdtemp,
  makeConfig,
  makeStore,
  makeLocks,
  writeTask,
  fakeLogPath,
  readFakeLog,
  methodOrder,
  recvOf,
  deferred,
};
