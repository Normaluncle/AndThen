'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { FAKE_ACP, mkdtemp, fakeLogPath, readFakeLog, methodOrder } = require('./helpers.cjs');

const CLI = path.join(__dirname, '..', '..', 'tools', 'workbuddy', 'cli.cjs');
const WORKTREE = process.cwd();

function initRepo() {
  const dir = mkdtemp('wb-repo-');
  const id = ['-c', 'user.name=orch-test', '-c', 'user.email=orch-test@localhost'];
  execFileSync('git', ['-C', dir, 'init', '-q']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, ...id, 'commit', '-q', '-m', 'init']);
  return dir;
}

function runCli(args, env = {}, cwd = WORKTREE) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd,
    timeout: 60000,
    env: { ...process.env, ...env },
  });
}

function parseJson(res) {
  const text = res.stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    return JSON.parse(text.slice(start, end + 1));
  }
}

function baseArgs(stateDir, extra) {
  return ['--state-dir', stateDir, '--cli', FAKE_ACP, '--json', ...extra];
}

test('start runs a task end to end and reports completed', () => {
  const stateDir = mkdtemp('wb-cli-');
  const repo = initRepo();
  const taskFile = path.join(stateDir, 'task.md');
  fs.writeFileSync(taskFile, 'Implement the thing.');

  const res = runCli(
    ['start', ...baseArgs(stateDir, ['--agent', 'cli-a', '--task-file', taskFile, '--cwd', repo, '--task-id', 'fixed'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: fakeLogPath(stateDir) },
  );
  assert.equal(res.status, 0, res.stderr);
  const out = parseJson(res);
  assert.equal(out.status, 'completed');
  assert.equal(out.outcome, 'SUCCESS');
  assert.ok(out.sessionId);
  assert.equal(out.model, 'deepseek-v4.1-flash');
  assert.equal(out.window, 1000000);
  assert.ok(fs.existsSync(out.checkpoint));
});

test('resume reuses the recorded session and re-sets the context', () => {
  const stateDir = mkdtemp('wb-cli-');
  const repo = initRepo();
  const taskFile = path.join(stateDir, 'task.md');
  fs.writeFileSync(taskFile, 'Implement the thing.');

  const first = runCli(
    ['start', ...baseArgs(stateDir, ['--agent', 'cli-r', '--task-file', taskFile, '--cwd', repo, '--task-id', 'one'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: fakeLogPath(stateDir) },
  );
  assert.equal(first.status, 0, first.stderr);

  const logPath = path.join(stateDir, 'resume.jsonl');
  const second = runCli(
    ['resume', ...baseArgs(stateDir, ['--agent', 'cli-r', '--task-id', 'two'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: logPath },
  );
  assert.equal(second.status, 0, second.stderr);
  assert.equal(parseJson(second).status, 'completed');
  const order = methodOrder(readFakeLog(logPath));
  assert.ok(order.includes('session/load'));
  assert.ok(!order.includes('session/new'));
});

test('blocks a same-task re-run when an ambiguous attempt left worktree changes', () => {
  const stateDir = mkdtemp('wb-cli-');
  const repo = initRepo();
  const taskFile = path.join(stateDir, 'task.md');
  fs.writeFileSync(taskFile, 'Implement the thing.');

  // First attempt has an unclear outcome (needs_review) but records its git base.
  const first = runCli(
    ['start', ...baseArgs(stateDir, ['--agent', 'cli-g', '--task-file', taskFile, '--cwd', repo, '--task-id', 'fixed'])],
    { FAKE_ACP_MODE: 'outcome_error', FAKE_ACP_LOG: fakeLogPath(stateDir) },
  );
  assert.equal(first.status, 5, first.stdout + first.stderr);
  assert.equal(parseJson(first).status, 'needs_review');

  fs.appendFileSync(path.join(repo, 'a.txt'), 'dirty side effect\n');

  const second = runCli(
    ['start', ...baseArgs(stateDir, ['--agent', 'cli-g', '--task-file', taskFile, '--cwd', repo, '--task-id', 'fixed'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: path.join(stateDir, 'second.jsonl') },
  );
  assert.equal(second.status, 5, second.stdout + second.stderr);
  assert.equal(parseJson(second).status, 'needs_review');
  assert.equal(fs.existsSync(path.join(stateDir, 'second.jsonl')), false, 'blocked retry must not spawn a child');
});

test('allows a same-task re-run when no side effects were detected', () => {
  const stateDir = mkdtemp('wb-cli-');
  const repo = initRepo();
  const taskFile = path.join(stateDir, 'task.md');
  fs.writeFileSync(taskFile, 'Implement the thing.');

  const first = runCli(
    ['start', ...baseArgs(stateDir, ['--agent', 'cli-c', '--task-file', taskFile, '--cwd', repo, '--task-id', 'fixed'])],
    { FAKE_ACP_MODE: 'outcome_error', FAKE_ACP_LOG: fakeLogPath(stateDir) },
  );
  assert.equal(first.status, 5);

  const second = runCli(
    ['start', ...baseArgs(stateDir, ['--agent', 'cli-c', '--task-file', taskFile, '--cwd', repo, '--task-id', 'fixed'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: path.join(stateDir, 'second.jsonl') },
  );
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(parseJson(second).status, 'completed');
});

test('refuses to resume an agent with no recorded session', () => {
  const stateDir = mkdtemp('wb-cli-');
  const taskFile = path.join(stateDir, 'task.md');
  fs.writeFileSync(taskFile, 'Implement the thing.');

  const res = runCli(
    ['resume', ...baseArgs(stateDir, ['--agent', 'cli-none', '--task-file', taskFile])],
    { FAKE_ACP_MODE: 'normal' },
  );
  assert.equal(res.status, 7, res.stdout + res.stderr);
  assert.equal(parseJson(res).error.code, 'E_NO_SESSION');
});

test('status reports agents and cancel is a no-op when nothing runs', () => {
  const stateDir = mkdtemp('wb-cli-');
  const repo = initRepo();
  const taskFile = path.join(stateDir, 'task.md');
  fs.writeFileSync(taskFile, 'Implement the thing.');

  const started = runCli(
    ['start', ...baseArgs(stateDir, ['--agent', 'cli-s', '--task-file', taskFile, '--cwd', repo, '--task-id', 'fixed'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: fakeLogPath(stateDir) },
  );
  assert.equal(started.status, 0, started.stderr);

  const status = runCli(['status', '--state-dir', stateDir, '--json'], {});
  assert.equal(status.status, 0);
  const parsed = parseJson(status);
  assert.equal(parsed.agents.length, 1);
  assert.equal(parsed.agents[0].name, 'cli-s');
  assert.equal(parsed.agents[0].status, 'completed');

  const cancel = runCli(['cancel', '--state-dir', stateDir, '--agent', 'cli-s', '--json'], {});
  assert.equal(cancel.status, 0);
  assert.equal(parseJson(cancel).cancelled, false);
});

test('doctor exits 0 when the environment is valid', () => {
  const stateDir = mkdtemp('wb-cli-');
  const res = runCli(['doctor', '--state-dir', stateDir, '--json'], {});
  if (res.status === 3) {
    // Environment-dependent: report but do not fail the suite.
    return;
  }
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(parseJson(res).ok, true);
});

function childCwd(logPath) {
  const entry = readFakeLog(logPath).find((e) => e.dir === 'cwd');
  return entry && entry.cwd;
}

test('resume from a different shell cwd still uses the saved worktree', () => {
  const stateDir = mkdtemp('wb-cli-');
  const repoA = initRepo();
  const shellB = mkdtemp('wb-shell-');
  const taskFile = path.join(stateDir, 'task.md');
  fs.writeFileSync(taskFile, 'Implement the thing.');

  const log1 = path.join(stateDir, 'one.jsonl');
  const first = runCli(
    ['start', ...baseArgs(stateDir, ['--agent', 'cli-cwd', '--task-file', taskFile, '--cwd', repoA, '--task-id', 'one'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: log1 },
    shellB,
  );
  assert.equal(first.status, 0, first.stderr);
  assert.equal(path.resolve(childCwd(log1)), path.resolve(repoA));

  const log2 = path.join(stateDir, 'two.jsonl');
  const second = runCli(
    ['resume', ...baseArgs(stateDir, ['--agent', 'cli-cwd', '--task-id', 'two'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: log2 },
    shellB,
  );
  assert.equal(second.status, 0, second.stderr);
  assert.equal(path.resolve(childCwd(log2)), path.resolve(repoA), 'resume must use the saved cwd, not the shell cwd');
});

test('refuses a conflicting --cwd on resume unless --migrate-cwd is given', () => {
  const stateDir = mkdtemp('wb-cli-');
  const repoA = initRepo();
  const repoC = initRepo();
  const shellB = mkdtemp('wb-shell-');
  const taskFile = path.join(stateDir, 'task.md');
  fs.writeFileSync(taskFile, 'Implement the thing.');

  const first = runCli(
    ['start', ...baseArgs(stateDir, ['--agent', 'cli-cwd2', '--task-file', taskFile, '--cwd', repoA, '--task-id', 'one'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: path.join(stateDir, 'one.jsonl') },
    shellB,
  );
  assert.equal(first.status, 0, first.stderr);

  const conflict = runCli(
    ['resume', ...baseArgs(stateDir, ['--agent', 'cli-cwd2', '--task-id', 'two', '--cwd', repoC])],
    { FAKE_ACP_MODE: 'normal' },
    shellB,
  );
  assert.equal(conflict.status, 8, conflict.stdout + conflict.stderr);
  assert.equal(parseJson(conflict).error.code, 'E_CONFIG');

  const logM = path.join(stateDir, 'migrated.jsonl');
  const migrated = runCli(
    ['resume', ...baseArgs(stateDir, ['--agent', 'cli-cwd2', '--task-id', 'two', '--cwd', repoC, '--migrate-cwd'])],
    { FAKE_ACP_MODE: 'normal', FAKE_ACP_LOG: logM },
    shellB,
  );
  assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
  assert.equal(path.resolve(childCwd(logM)), path.resolve(repoC));
});
