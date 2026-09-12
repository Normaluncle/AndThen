'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { OrchError, codes, EXIT } = require('./errors.cjs');
const { detectSystemProxy } = require('./proxy.cjs');
const { PERMISSION_MODE, ALLOWED_TOOLS, DISALLOWED_TOOLS } = require('./policy.cjs');

const MODEL = 'deepseek-v4.1-flash';
const CONTEXT_WINDOW = 1000000;
const AUTOCOMPACT = '1000000';
const DEFAULT_MAX_CONCURRENCY = 2;
const MAX_CONCURRENCY_CAP = 3;

function gitToplevel(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return cwd;
  }
}

/** Root of the shared repo (parent of the common git dir), so worktrees can find root-level snapshots. */
function gitCommonRoot(cwd) {
  try {
    const common = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const abs = path.resolve(cwd, common);
    return path.dirname(abs);
  } catch {
    return gitToplevel(cwd);
  }
}

function cliCandidates(env) {
  const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const rel = path.join('resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
  return [
    path.join(local, 'Programs', 'WorkBuddyAI', rel),
    path.join(local, 'Programs', 'workbuddy-ai', rel),
    path.join(programFiles, 'WorkBuddyAI', rel),
    path.join(programFilesX86, 'WorkBuddyAI', rel),
  ];
}

function discoverCli(env) {
  return cliCandidates(env).find((p) => fs.existsSync(p)) || null;
}

function productConfigCandidates(stateDir, projectRoot, mainRoot) {
  const rel = path.join('workbuddy-probe-results', 'acp', 'product-resolved.json');
  const relLocal = 'product-resolved.json';
  return dedupe([
    path.join(stateDir, relLocal),
    path.join(mainRoot, rel),
    path.join(projectRoot, rel),
  ]);
}

function installedProductConfigCandidates(env) {
  const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const rel = path.join('resources', 'app.asar.unpacked', 'cli', 'product.json');
  return [
    path.join(local, 'Programs', 'WorkBuddyAI', rel),
    path.join(local, 'Programs', 'workbuddy-ai', rel),
  ];
}

function dedupe(list) {
  return [...new Set(list)];
}

function firstExisting(list) {
  return list.find((p) => p && fs.existsSync(p)) || null;
}

function resolveConfig({ argv = {}, env = process.env, cwd = process.cwd() } = {}) {
  const projectRoot = gitToplevel(cwd);
  const mainRoot = gitCommonRoot(cwd);

  const stateDir = path.resolve(
    argv.stateDir || env.WORKBUDDY_STATE_DIR || path.join(projectRoot, '.orchestrator'),
  );
  const cliPath = argv.cli || env.WORKBUDDY_CLI_PATH || discoverCli(env);
  const productConfigPath =
    argv.productConfig ||
    env.ACC_PRODUCT_CONFIG_PATH ||
    firstExisting(productConfigCandidates(stateDir, projectRoot, mainRoot));

  let maxConcurrency = Number(argv.maxConcurrency || env.WORKBUDDY_MAX_CONCURRENCY || DEFAULT_MAX_CONCURRENCY);
  if (!Number.isFinite(maxConcurrency) || maxConcurrency < 1) maxConcurrency = DEFAULT_MAX_CONCURRENCY;
  if (maxConcurrency > MAX_CONCURRENCY_CAP) maxConcurrency = MAX_CONCURRENCY_CAP;

  const concurrencyVerified =
    argv.verifiedConcurrency3 === true || env.WORKBUDDY_CONCURRENCY_VERIFIED === '1';
  if (maxConcurrency === MAX_CONCURRENCY_CAP && !concurrencyVerified) {
    throw new OrchError(
      codes.CONFIG,
      'maxConcurrency=3 requires explicit verification (--verified-concurrency-3 or WORKBUDDY_CONCURRENCY_VERIFIED=1)',
      { exitCode: EXIT.CONFIG },
    );
  }

  const proxy = argv.proxy
    ? { source: 'flag', address: argv.proxy, enabled: true }
    : detectSystemProxy({ env });

  return {
    projectRoot,
    mainRoot,
    stateDir,
    cliPath,
    productConfigPath,
    installedProductConfigPath: firstExisting(installedProductConfigCandidates(env)),
    proxy,
    model: MODEL,
    contextWindow: CONTEXT_WINDOW,
    autocompact: AUTOCOMPACT,
    maxConcurrency,
    concurrencyVerified,
    permissionMode: PERMISSION_MODE,
    allowedTools: [...ALLOWED_TOOLS],
    disallowedTools: [...DISALLOWED_TOOLS],
    timeouts: {
      request: Number(env.WORKBUDDY_REQUEST_TIMEOUT_MS || 60000),
      prompt: Number(env.WORKBUDDY_PROMPT_TIMEOUT_MS || 2700000),
      lockWait: Number(env.WORKBUDDY_LOCK_WAIT_MS || 0),
    },
    extraEnv: {},
    cwd,
  };
}

module.exports = {
  resolveConfig,
  gitToplevel,
  gitCommonRoot,
  discoverCli,
  MODEL,
  CONTEXT_WINDOW,
  AUTOCOMPACT,
  DEFAULT_MAX_CONCURRENCY,
  MAX_CONCURRENCY_CAP,
};
