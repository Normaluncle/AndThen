'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildToolManifest } = require('./policy.cjs');

const MIN_NODE_MAJOR = 24;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { __error: err.message };
  }
}

function check(name, status, detail) {
  return { name, status, detail };
}

function nodeCheck() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= MIN_NODE_MAJOR) return check('node', 'ok', `v${process.versions.node}`);
  return check('node', 'fail', `Node ${process.versions.node} < required ${MIN_NODE_MAJOR}`);
}

function gitCheck() {
  try {
    const v = execFileSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return check('git', 'ok', v);
  } catch {
    return check('git', 'fail', 'git not found on PATH');
  }
}

function stateDirCheck(stateDir) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const probe = path.join(stateDir, `.doctor-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return check('state-dir', 'ok', stateDir);
  } catch (err) {
    return check('state-dir', 'fail', `${stateDir} (${err.message})`);
  }
}

function cliCheck(cliPath) {
  if (!cliPath) return check('cli', 'fail', 'no WorkBuddy CLI path found; set --cli or WORKBUDDY_CLI_PATH');
  if (!fs.existsSync(cliPath)) return check('cli', 'fail', `${cliPath} does not exist`);
  return check('cli', 'ok', cliPath);
}

function productConfigCheck(config) {
  const file = config.productConfigPath;
  if (!file) return check('product-config', 'fail', 'no product-resolved.json found; set --product-config');
  if (!fs.existsSync(file)) return check('product-config', 'fail', `${file} does not exist`);
  const data = readJson(file);
  if (data.__error) return check('product-config', 'fail', `${file} is not valid JSON: ${data.__error}`);
  const models = Array.isArray(data.models) ? data.models : [];
  const model = models.find((m) => m.id === config.model);
  if (!model) return check('product-config', 'fail', `${file}: model "${config.model}" is not present in the snapshot`);
  const supported = (model.contextWindow && model.contextWindow.supportedLengths) || [];
  if (!supported.includes(config.contextWindow)) {
    return check('product-config', 'fail', `${config.model} does not support ${config.contextWindow} (supported: ${supported.join(', ')})`);
  }
  const version = data.genieVersion || data.version || 'unknown';
  let status = 'ok';
  let detail = `${file} version=${version} models=${models.length} model=${config.model} supports ${config.contextWindow}`;
  if (config.installedProductConfigPath && fs.existsSync(config.installedProductConfigPath)) {
    const installed = readJson(config.installedProductConfigPath);
    if (!installed.__error) {
      const installedVersion = installed.genieVersion || installed.version || 'unknown';
      if (installedVersion !== version) {
        status = 'warn';
        detail += `; snapshot version ${version} != installed ${installedVersion} — re-verify after upgrade`;
      } else if (!(installed.models || []).some((m) => m.id === config.model)) {
        status = 'warn';
        detail += '; snapshot is aligned to the installed version but adds the required model locally';
      }
    }
  }
  return check('product-config', status, detail);
}

function proxyCheck(config) {
  const p = config.proxy || {};
  if (p.address) return check('proxy', 'ok', `enabled via ${p.source}: ${p.address} (child env only; global settings untouched)`);
  return check('proxy', 'warn', `no enabled system HTTP proxy detected (${p.reason || 'unknown'}); network calls may fail`);
}

function permissionsCheck(config) {
  const manifest = buildToolManifest();
  return check(
    'permissions',
    'ok',
    `mode=${manifest.permissionMode}; allowed=[${manifest.allowedTools.join(',')}]; disallowed=[${manifest.disallowedTools.join(',')}]; no bypassPermissions; worktree is not a sandbox`,
  );
}

/**
 * Pre-flight environment + snapshot validation. Prints no credentials.
 * @returns {{ok:boolean, checks:Array, config:object}}
 */
function doctor(config) {
  const checks = [
    nodeCheck(),
    gitCheck(),
    cliCheck(config.cliPath),
    productConfigCheck(config),
    stateDirCheck(config.stateDir),
    proxyCheck(config),
    permissionsCheck(config),
  ];
  const ok = checks.every((c) => c.status !== 'fail');
  return { ok, checks };
}

module.exports = { doctor, MIN_NODE_MAJOR };
