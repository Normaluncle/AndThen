#!/usr/bin/env node
'use strict';

/**
 * WorkBuddy orchestration CLI.
 *
 *   node tools/workbuddy/cli.cjs <doctor|start|resume|status|cancel> [options]
 *
 * Pure Node 24, no runtime dependencies. State lives under a gitignored
 * state-dir (default <project>/.orchestrator).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EXIT, OrchError, codes } = require('./lib/errors.cjs');
const { resolveConfig } = require('./lib/config.cjs');
const { StateStore } = require('./lib/state.cjs');
const { LockManager, ConcurrencyGate } = require('./lib/locks.cjs');
const { Scheduler } = require('./lib/scheduler.cjs');
const { runTask, preflightRetry } = require('./lib/runner.cjs');
const { doctor } = require('./lib/doctor.cjs');
const { redactString, redactJson } = require('./lib/redact.cjs');
const { isPidAlive, killTree } = require('./lib/exec.cjs');

const USAGE = `WorkBuddy orchestration scheduler

Usage:
  node tools/workbuddy/cli.cjs doctor  [--json] [--cli <path>] [--product-config <path>] [--state-dir <dir>]
  node tools/workbuddy/cli.cjs start   --agent <name> --task-file <path> [--cwd <dir>] [--task-id <id>] [--json] [--no-wait]
  node tools/workbuddy/cli.cjs resume  --agent <name> [--task-file <path>] [--task-id <id>] [--json] [--no-wait]
  node tools/workbuddy/cli.cjs status  [--agent <name>] [--json]
  node tools/workbuddy/cli.cjs cancel  --agent <name> [--json]

Global options:
  --state-dir <dir>            state dir (default <project>/.orchestrator)
  --cli <path>                 WorkBuddy CLI entry (default: auto-discovered)
  --product-config <path>      product-resolved.json (default: auto-discovered)
  --proxy <url>                override detected system proxy
  --max-concurrency <n>        global concurrent agents (1..2, 3 only when verified)
  --verified-concurrency-3     acknowledge concurrency 3 has been verified
  --quiet                      suppress streamed assistant text (tool/status lines kept)
  --migrate-cwd                allow moving an existing agent session to a new --cwd

Docs: docs/workbuddy-orchestration.md`;

function camel(key) {
  return key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq >= 0) {
      out[camel(token.slice(2, eq))] = token.slice(eq + 1);
      continue;
    }
    const key = camel(token.slice(2));
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function emitLine(text) {
  process.stdout.write(`${text}\n`);
}

function taskIdFor(taskFile, explicit) {
  if (explicit) return explicit;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(taskFile)).digest('hex').slice(0, 12);
  return `task-${hash}`;
}

function buildContext(argv) {
  const config = resolveConfig({ argv });
  const store = new StateStore({ dir: config.stateDir });
  const locks = new LockManager({ dir: config.stateDir });
  return { config, store, locks };
}

/**
 * Resolve the agent's working directory. An existing agent is bound to its
 * recorded worktree: resume defaults to the saved cwd, and an explicit --cwd
 * that differs is refused unless --migrate-cwd is given. This prevents a resume
 * launched from another shell directory from silently moving the session to a
 * different worktree.
 */
function resolveAgent(store, name, explicitCwd, migrateCwd, defaultCwd) {
  const existing = store.readAgent(name);
  if (!existing) return { name, cwd: explicitCwd || defaultCwd, isNew: true };
  const savedCwd = existing.cwd || null;
  if (explicitCwd && savedCwd && path.resolve(savedCwd) !== path.resolve(explicitCwd)) {
    if (!migrateCwd) {
      throw new OrchError(
        codes.CONFIG,
        `agent "${name}" is bound to ${savedCwd}; refusing to run in ${explicitCwd}. Pass --migrate-cwd to move the session.`,
        { exitCode: EXIT.CONFIG, details: { savedCwd, requestedCwd: explicitCwd } },
      );
    }
    store.appendAudit(name, { type: 'cwd_migrated', from: savedCwd, to: explicitCwd });
    store.writeAgent(name, { cwd: explicitCwd, cwdMigratedFrom: savedCwd, cwdMigratedAt: new Date().toISOString() });
    return { ...existing, name, cwd: explicitCwd, migratedFrom: savedCwd };
  }
  return { ...existing, name, cwd: savedCwd || explicitCwd || defaultCwd };
}

function exitCodeForStatus(status, errCode) {
  if (errCode === codes.VIOLATION) return EXIT.VIOLATION;
  if (errCode === codes.NO_SESSION) return EXIT.NO_SESSION;
  if (errCode === codes.LOCKED) return EXIT.LOCKED;
  if (errCode === codes.CONFIG) return EXIT.CONFIG;
  if (status === 'completed') return EXIT.OK;
  if (status === 'needs_review') return EXIT.NEEDS_REVIEW;
  return EXIT.ERROR;
}

function summarize(result) {
  return {
    agent: result.agent,
    taskId: result.taskId,
    mode: result.mode,
    status: result.status,
    outcome: result.outcome,
    sessionId: result.sessionId,
    model: result.model,
    window: result.window,
    used: result.used,
    tools: result.tools.length,
    violations: result.violations,
    error: result.error || null,
    checkpoint: result.checkpoint,
    gitBaseSha: result.git && result.git.baseSha,
    gitBranch: result.git && result.git.branch,
  };
}

async function cmdDoctor(argv) {
  const { config } = buildContext(argv);
  const report = doctor(config);
  if (argv.json) {
    emitLine(JSON.stringify({ ok: report.ok, checks: report.checks }, null, 2));
  } else {
    emitLine(`doctor: ${report.ok ? 'OK' : 'FAILED'}`);
    for (const c of report.checks) emitLine(`  [${c.status}] ${c.name}: ${c.status === 'ok' ? redactString(c.detail) : redactString(c.detail)}`);
  }
  return report.ok ? EXIT.OK : EXIT.DOCTOR;
}

async function runOne(argv, mode) {
  const { config, store, locks } = buildContext(argv);
  const agentName = argv.agent;
  if (!agentName) throw new OrchError(codes.USAGE, '--agent <name> is required', { exitCode: EXIT.USAGE });

  const agent = resolveAgent(store, agentName, argv.cwd ? path.resolve(argv.cwd) : null, argv.migrateCwd === true, config.cwd);
  const taskFile = argv.taskFile || agent.taskFile;
  if (!taskFile) throw new OrchError(codes.USAGE, '--task-file <path> is required for a new task', { exitCode: EXIT.USAGE });
  if (!fs.existsSync(taskFile)) throw new OrchError(codes.USAGE, `task file not found: ${taskFile}`, { exitCode: EXIT.USAGE });
  const taskId = taskIdFor(taskFile, argv.taskId);

  if (mode === 'resume' && !agent.sessionId) {
    throw new OrchError(codes.NO_SESSION, `agent "${agentName}" has no recorded sessionId; refusing to resume and refusing to create a new session`, {
      exitCode: EXIT.NO_SESSION,
    });
  }

  // Same-task retry guard: ambiguous prior side effects must be reviewed, not replayed.
  const previous = store.readCheckpoint(agentName, taskId);
  if (previous && !argv.forceRetry) {
    const pre = preflightRetry({ cwd: agent.cwd, baseSha: previous.gitBaseSha, previous });
    if (!pre.ok) {
      store.writeAgent(agentName, { status: 'needs_review', error: { code: codes.NEEDS_REVIEW, message: pre.reason }, taskId });
      store.appendAudit(agentName, { type: 'retry_blocked', taskId, reason: pre.reason });
      if (argv.json) emitLine(JSON.stringify({ agent: agentName, taskId, status: 'needs_review', reason: pre.reason, changed: pre.changed || null }, null, 2));
      else emitLine(`needs_review: ${pre.reason} (re-run with --force-retry to override)`);
      return EXIT.NEEDS_REVIEW;
    }
  }

  const task = { agent, mode, taskFile, taskId };

  if (!argv.json) emitLine(`agent=${agentName} cwd=${agent.cwd} task=${taskId} mode=${mode}`);

  const gate = new ConcurrencyGate({ locks, max: config.maxConcurrency });
  let slot;
  if (argv.noWait) {
    slot = gate.tryAcquire(agentName);
    if (!slot) {
      store.appendAudit(agentName, { type: 'queued_no_wait', taskId });
      if (argv.json) emitLine(JSON.stringify({ agent: agentName, taskId, status: 'queued', reason: `no free slot (max ${config.maxConcurrency})` }));
      else emitLine(`queued: no free slot (max ${config.maxConcurrency}); re-run when a slot frees`);
      return EXIT.OK;
    }
  } else {
    slot = await gate.acquire({
      key: agentName,
      onWait: (info) => {
        store.appendAudit(agentName, { type: 'waiting_slot', taskId, active: info.active, max: info.max });
        emitLine(`waiting for a concurrency slot (${info.active}/${info.max} active)`);
      },
    });
  }

  const scheduler = new Scheduler({ maxConcurrency: config.maxConcurrency, run: (t) => runTask({ config, store, locks, task: t, emit: argv.json ? () => {} : emitLine }), store, logger: argv.json ? () => {} : emitLine });
  try {
    const result = await scheduler.submit(task);
    if (argv.json) emitLine(JSON.stringify(summarize(result), null, 2));
    else {
      emitLine(`done: status=${result.status} outcome=${result.outcome} window=${result.window} checkpoint=${result.checkpoint}`);
    }
    return exitCodeForStatus(result.status);
  } finally {
    slot.release();
  }
}

async function cmdStatus(argv) {
  const { config, store, locks } = buildContext(argv);
  const agents = argv.agent ? [store.readAgent(argv.agent)].filter(Boolean) : store.listAgents();
  const slots = locks.list('slot').map((s) => ({ pid: s.pid, key: s.key, alive: isPidAlive(s.pid) }));
  if (argv.json) {
    emitLine(JSON.stringify({ stateDir: config.stateDir, maxConcurrency: config.maxConcurrency, activeSlots: slots.filter((s) => s.alive).length, agents }, null, 2));
    return EXIT.OK;
  }
  emitLine(`state-dir: ${config.stateDir}`);
  emitLine(`concurrency: ${slots.filter((s) => s.alive).length}/${config.maxConcurrency} active`);
  if (agents.length === 0) emitLine('no agents recorded');
  for (const a of agents) {
    emitLine(
      `  ${a.name}: status=${a.status || 'unknown'} session=${a.sessionId || '-'} task=${a.taskId || '-'} window=${a.window || a.contextWindow || '-'} outcome=${a.outcome || '-'} cwd=${a.cwd || '-'}`,
    );
    if (a.checkpoint) emitLine(`    checkpoint: ${a.checkpoint}`);
  }
  return EXIT.OK;
}

async function cmdCancel(argv) {
  const { config, store, locks } = buildContext(argv);
  const agentName = argv.agent;
  if (!agentName) throw new OrchError(codes.USAGE, '--agent <name> is required', { exitCode: EXIT.USAGE });

  const lock = locks.peek('agent', agentName);
  if (!lock) {
    const out = { agent: agentName, cancelled: false, reason: 'no active lock for this agent' };
    emitLine(argv.json ? JSON.stringify(out) : `cancel: ${out.reason}`);
    return EXIT.OK;
  }

  const killed = { childPid: null, holderPid: null };
  if (lock.childPid && isPidAlive(lock.childPid)) {
    killTree(lock.childPid);
    killed.childPid = lock.childPid;
  }
  if (lock.pid && lock.pid !== process.pid && isPidAlive(lock.pid)) {
    killTree(lock.pid);
    killed.holderPid = lock.pid;
  }
  locks.forceRelease('agent', agentName);
  const rec = store.readAgent(agentName) || { name: agentName };
  store.writeAgent(agentName, { ...rec, status: 'cancelled', error: { code: codes.LOCKED, message: 'cancelled by operator' } });
  store.appendAudit(agentName, { type: 'cancelled', killed });

  const out = { agent: agentName, cancelled: true, killed };
  emitLine(argv.json ? JSON.stringify(out) : `cancel: terminated agent=${agentName} childPid=${killed.childPid || '-'} holderPid=${killed.holderPid || '-'}`);
  return EXIT.OK;
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const command = argv._[0];
  if (!command || argv.help) {
    emitLine(USAGE);
    return command ? EXIT.OK : EXIT.USAGE;
  }
  try {
    switch (command) {
      case 'doctor':
        return await cmdDoctor(argv);
      case 'start':
        return await runOne(argv, 'new');
      case 'resume':
        return await runOne(argv, 'resume');
      case 'status':
        return await cmdStatus(argv);
      case 'cancel':
        return await cmdCancel(argv);
      default:
        throw new OrchError(codes.USAGE, `unknown command "${command}"`, { exitCode: EXIT.USAGE });
    }
  } catch (err) {
    const orch = err instanceof OrchError ? err : new OrchError(codes.INTERNAL, err.message);
    if (argv.json) {
      emitLine(redactJson({ error: { code: orch.code, message: orch.message, details: orch.details }, result: orch.result ? summarize(orch.result) : null }));
    } else {
      emitLine(`error: ${orch.code} ${redactString(orch.message)}`);
    }
    return orch.exitCode || EXIT.ERROR;
  }
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`fatal: ${redactString(String((err && err.stack) || err))}\n`);
      process.exitCode = EXIT.ERROR;
    });
}

module.exports = { main, parseArgs, summarize };
