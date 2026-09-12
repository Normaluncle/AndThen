'use strict';

const { execFileSync } = require('node:child_process');

/** True when a pid refers to a live process (EPERM counts as alive). */
function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

/**
 * Kill a process and its descendants. On Windows `taskkill /T` walks the tree;
 * on POSIX the child is spawned detached so the whole group can be signalled.
 * Only the target tree is touched.
 */
function killTree(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(n), '/T', '/F'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(-n, 'SIGKILL');
    return true;
  } catch {
    /* fall through to single-pid kill */
  }
  try {
    process.kill(n, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Record the git identity a task runs against so retries can tell whether the
 * worktree already moved (side effects) after an ambiguous outcome.
 */
function gitInfo(cwd) {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const baseSha = git(cwd, ['rev-parse', 'HEAD']);
  const porcelain = git(cwd, ['status', '--porcelain']);
  const diffStat = git(cwd, ['diff', '--stat']);
  return {
    available: branch !== null,
    branch: branch || null,
    baseSha: baseSha || null,
    dirty: Boolean(porcelain && porcelain.length > 0),
    changedPaths: porcelain ? porcelain.split('\n').filter(Boolean).length : 0,
    diffStat: diffStat || '',
  };
}

/** Is the working tree unchanged relative to a recorded sha? */
function treeChangedSince(cwd, baseSha) {
  if (!baseSha) return null;
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const porcelain = git(cwd, ['status', '--porcelain']);
  const changed = Boolean(porcelain && porcelain.length > 0);
  return { headChanged: head !== baseSha, worktreeDirty: changed, changed };
}

module.exports = { isPidAlive, killTree, gitInfo, treeChangedSince };
