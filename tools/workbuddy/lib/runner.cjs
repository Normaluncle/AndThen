'use strict';

const fs = require('node:fs');
const { AcpClient } = require('./acp-client.cjs');
const { OrchError, codes, EXIT } = require('./errors.cjs');
const { gitInfo, treeChangedSince } = require('./exec.cjs');
const { redactString } = require('./redact.cjs');
const { classifyPermission, buildToolManifest } = require('./policy.cjs');
const { proxyEnv } = require('./proxy.cjs');

const SYSTEM_PROMPT = [
  'Implement only assigned project work.',
  'Do not delegate or spawn agents.',
  'Use tools and project skills.',
  'Do not alter system networking, credentials, other projects or external accounts.',
  'Never reset/delete existing work or volumes.',
  'Commit with agent identity, not guessed human identity.',
].join(' ');

const TRANSIENT = new Set([codes.TIMEOUT, codes.DISCONNECT, codes.INTERNAL]);

function isTransient(err) {
  if (!err) return false;
  if (TRANSIENT.has(err.code)) return true;
  return /ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(err.message || '');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build the child-process spawn spec for one agent. */
function buildSpawnSpec(config, cwd) {
  const args = [
    config.cliPath,
    '--acp',
    '--model',
    config.model,
    '--permission-mode',
    config.permissionMode,
    '--allowedTools',
    ...config.allowedTools,
    '--disallowedTools',
    ...config.disallowedTools,
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    '',
    '--autocompact',
    config.autocompact,
    '--append-system-prompt',
    SYSTEM_PROMPT,
  ];
  const env = {
    ...process.env,
    CODEBUDDY_SKIP_GIT_BASH_CHECK: '1',
    ...proxyEnv(config.proxy),
    ...(config.extraEnv || {}),
  };
  if (config.productConfigPath) env.ACC_PRODUCT_CONFIG_PATH = config.productConfigPath;
  return { command: process.execPath, args, cwd, env };
}

function outcomeOf(result) {
  const meta = (result && result._meta) || {};
  return meta['codebuddy.ai/outcome'] || (result && result.outcome) || null;
}

function modelIdsIn(meta) {
  if (!meta) return [];
  return ['codebuddy.ai/requestModelId', 'codebuddy.ai/responseModelId']
    .map((k) => meta[k])
    .filter(Boolean);
}

/**
 * Run one task (new session or resume) end to end. Owns the agent lock, the ACP
 * child and the agent record. Never retries a development prompt; only read-only
 * initialization/network steps are retried.
 */
async function runTask({ config, store, locks, task, emit = () => {} }) {
  const agentName = task.agent.name;
  const cwd = task.agent.cwd;
  const taskId = task.taskId;
  const mode = task.mode;
  const startedAt = new Date().toISOString();

  const lock = locks.acquire('agent', agentName, { agent: agentName, mode, taskId, cwd });
  let client = null;

  const rt = {
    replaying: false,
    active: false,
    violation: null,
    replayEvents: 0,
    lastWindow: null,
    lastUsed: null,
    outputChars: 0,
  };

  const result = {
    agent: agentName,
    taskId,
    mode,
    cwd,
    sessionId: task.agent.sessionId || null,
    model: config.model,
    window: config.contextWindow,
    status: 'initializing',
    outcome: null,
    violations: [],
    tools: [],
    startedAt,
    checkpoint: null,
    git: null,
  };

  const log = (line) => {
    const text = redactString(String(line));
    store.appendLog(agentName, text);
    emit(text);
  };

  const persist = (patch) => {
    const rec = store.writeAgent(agentName, {
      name: agentName,
      cwd,
      taskFile: task.taskFile,
      taskId,
      mode,
      model: config.model,
      contextWindow: config.contextWindow,
      status: result.status,
      sessionId: result.sessionId,
      ...patch,
    });
    return rec;
  };

  const raiseViolation = (type, detail) => {
    if (rt.violation) return;
    rt.violation = { type, detail: redactString(String(detail)) };
    result.violations.push(rt.violation);
    result.status = 'failed';
    persist({ status: 'failed', violation: rt.violation, error: `${type}: ${detail}` });
    store.appendAudit(agentName, { type: 'violation', violation: rt.violation });
    log(`VIOLATION ${type}: ${rt.violation.detail}`);
    if (client) client.terminate();
  };

  const onNotification = (method, params) => {
    if (method !== 'session/update') {
      store.appendAudit(agentName, { type: 'notification', method });
      return;
    }
    const update = (params && params.update) || {};
    const kind = update.sessionUpdate;

    // Replayed history from session/load is never current output and never a
    // violation signal for the request we are about to make.
    if (rt.replaying) {
      rt.replayEvents += 1;
      store.appendAudit(agentName, { type: 'replay_event', kind });
      return;
    }
    // Events outside an active prompt do not belong to the current request.
    if (!rt.active) {
      store.appendAudit(agentName, { type: 'idle_event', kind });
      return;
    }

    if (kind === 'usage_update') {
      if (update.size !== config.contextWindow) {
        raiseViolation('context_window_mismatch', `usage window ${update.size} != required ${config.contextWindow}`);
        return;
      }
      rt.lastWindow = update.size;
      rt.lastUsed = update.used;
      result.window = update.size;
      result.used = update.used;
      persist({ window: update.size, used: update.used });
    } else if (kind === 'agent_message_chunk') {
      const text = update.content && update.content.text;
      if (text) {
        rt.outputChars += text.length;
        log(text.trimEnd());
      }
    } else if (kind === 'tool_call') {
      const name = update.title || update.toolCallId || 'tool';
      result.tools.push({ name, status: 'requested' });
      store.appendAudit(agentName, { type: 'tool_call', name });
      log(`TOOL ${name}`);
    } else if (kind === 'tool_call_update') {
      store.appendAudit(agentName, { type: 'tool_result', status: update.status, toolCallId: update.toolCallId });
      log(`TOOL_RESULT ${update.status}`);
    }

    for (const id of modelIdsIn(update._meta)) {
      if (id !== config.model) raiseViolation('model_drift', `runtime model metadata ${id} != ${config.model}`);
    }
  };

  const onServerRequest = (method, params, id) => {
    if (method === 'session/request_permission') {
      const toolCall = (params && params.toolCall) || {};
      const decision = classifyPermission(toolCall);
      store.appendAudit(agentName, {
        type: 'permission_request',
        tool: toolCall.title || toolCall.name || '',
        decision: decision.decision,
        reason: decision.reason,
        needsMainControl: decision.needsMainControl,
      });
      if (decision.decision === 'allow') {
        const options = (params && params.options) || [];
        const allow = options.find((o) => o.kind === 'allow_once') || options[0];
        if (allow) {
          store.appendAudit(agentName, { type: 'permission_result', outcome: 'selected', optionId: allow.optionId });
          return { outcome: { outcome: 'selected', optionId: allow.optionId } };
        }
      }
      store.appendAudit(agentName, {
        type: 'permission_result',
        outcome: 'cancelled',
        reason: decision.reason,
        needsMainControl: decision.needsMainControl,
      });
      return { outcome: { outcome: 'cancelled' } };
    }
    store.appendAudit(agentName, { type: 'unsupported_request', method });
    throw new OrchError(codes.INTERNAL, `unsupported client operation: ${method}`);
  };

  const ensureClient = () => {
    if (client && !client.closed) return client;
    if (client) client.terminate();
    client = new AcpClient({
      spawnSpec: buildSpawnSpec(config, cwd),
      requestTimeoutMs: config.timeouts.request,
      promptTimeoutMs: config.timeouts.prompt,
      onNotification,
      onServerRequest,
      onStderr: (text) => store.appendLog(agentName, `STDERR ${text.trim()}`),
    });
    client.start();
    if (client.pid) lock.update({ childPid: client.pid, sessionId: result.sessionId });
    return client;
  };

  const withRetry = async (label, fn, attempts = 3) => {
    let lastErr;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!isTransient(err) || i === attempts) throw err;
        log(`RETRY ${label} attempt ${i} failed (${err.code}): ${err.message}`);
        await delay(40 * i);
      }
    }
    throw lastErr;
  };

  try {
    const git = gitInfo(cwd);
    result.git = git;

    if (mode === 'resume' && !result.sessionId) {
      throw new OrchError(codes.NO_SESSION, 'no sessionId recorded for this agent; refusing to resume and refusing to silently create a new session', {
        exitCode: EXIT.NO_SESSION,
      });
    }

    const taskText = fs.readFileSync(task.taskFile, 'utf8');
    task.abort = () => {
      if (client) client.terminate();
    };

    persist({ status: 'initializing', gitBaseSha: git.baseSha, gitBranch: git.branch, toolManifest: buildToolManifest() });
    store.appendAudit(agentName, { type: 'start', mode, taskId, taskFile: task.taskFile, git });

    ensureClient();
    await withRetry('initialize', () =>
      ensureClient().call('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'workbuddy-orchestrator', version: '1' },
      }),
    );

    if (mode === 'resume') {
      rt.replaying = true;
      try {
        await withRetry('session/load', () => ensureClient().call('session/load', { sessionId: result.sessionId, cwd, mcpServers: [] }));
      } catch (err) {
        throw new OrchError(codes.RESUME_FAILED, `session/load failed: ${err.message}. Refusing to create a new session.`, {
          exitCode: EXIT.ERROR,
          details: { cause: err.code, sessionId: result.sessionId },
        });
      } finally {
        rt.replaying = false;
      }
      store.appendAudit(agentName, { type: 'resumed', sessionId: result.sessionId, replayedEvents: rt.replayEvents });
    } else {
      const session = await withRetry('session/new', () => ensureClient().call('session/new', { cwd, mcpServers: [] }));
      const sessionId = session && session.sessionId;
      if (!sessionId) throw new OrchError(codes.INTERNAL, 'session/new returned no sessionId');
      result.sessionId = sessionId;
      persist({ sessionId, status: 'initializing' });
      lock.update({ sessionId });
      store.appendAudit(agentName, { type: 'new_session', sessionId });
    }

    // Model + 1M context must be set and read back before any prompt.
    await ensureClient()
      .call('session/set_config_option', { sessionId: result.sessionId, configId: 'mode', value: config.permissionMode })
      .catch(() => null);
    const modelRes = await ensureClient().call('session/set_config_option', {
      sessionId: result.sessionId,
      configId: 'model',
      value: config.model,
    });
    const ctxRes = await ensureClient().call('session/set_config_option', {
      sessionId: result.sessionId,
      configId: 'context_window',
      value: String(config.contextWindow),
    });
    const options = (ctxRes && ctxRes.configOptions) || (modelRes && modelRes.configOptions) || [];
    const modelOpt = options.find((o) => o.id === 'model');
    const ctxOpt = options.find((o) => o.id === 'context_window');
    if (!modelOpt || modelOpt.currentValue !== config.model) {
      throw new OrchError(codes.VIOLATION, `model not confirmed after set: ${modelOpt && modelOpt.currentValue}`, { exitCode: EXIT.VIOLATION });
    }
    if (!ctxOpt || String(ctxOpt.currentValue) !== String(config.contextWindow)) {
      throw new OrchError(codes.VIOLATION, `context_window not confirmed after set: ${ctxOpt && ctxOpt.currentValue}`, { exitCode: EXIT.VIOLATION });
    }
    persist({ status: 'running', confirmedModel: modelOpt.currentValue, confirmedWindow: String(ctxOpt.currentValue) });
    store.appendAudit(agentName, { type: 'configured', model: modelOpt.currentValue, contextWindow: String(ctxOpt.currentValue) });
    log(`READY ${agentName} ${result.sessionId} model=${modelOpt.currentValue} window=${ctxOpt.currentValue}`);

    rt.active = true;
    result.status = 'running';
    persist({ status: 'running' });
    let promptResult;
    try {
      promptResult = await ensureClient().call(
        'session/prompt',
        { sessionId: result.sessionId, prompt: [{ type: 'text', text: taskText }] },
        { timeoutMs: config.timeouts.prompt },
      );
    } finally {
      rt.active = false;
    }

    if (rt.violation) {
      throw new OrchError(codes.VIOLATION, `runtime violation: ${rt.violation.type} (${rt.violation.detail})`, { exitCode: EXIT.VIOLATION });
    }

    for (const id of modelIdsIn(promptResult && promptResult._meta)) {
      if (id !== config.model) {
        raiseViolation('model_drift', `result model metadata ${id} != ${config.model}`);
      }
    }
    if (rt.violation) {
      throw new OrchError(codes.VIOLATION, `runtime violation: ${rt.violation.type} (${rt.violation.detail})`, { exitCode: EXIT.VIOLATION });
    }

    const outcome = outcomeOf(promptResult);
    result.outcome = outcome;
    result.stopReason = (promptResult && promptResult.stopReason) || null;
    result.window = rt.lastWindow || config.contextWindow;
    result.used = rt.lastUsed;

    // Process exit 0 is not success: only an explicit SUCCESS outcome completes.
    if (outcome === 'SUCCESS') {
      result.status = 'completed';
    } else {
      result.status = 'needs_review';
    }
    persist({ status: result.status, outcome, stopReason: result.stopReason });
    store.appendAudit(agentName, { type: 'prompt_result', outcome, status: result.status, stopReason: result.stopReason });
    log(`RESULT ${agentName} status=${result.status} outcome=${outcome}`);

    result.checkpoint = writeCheckpoint(store, agentName, taskId, result, rt);
    persist({ status: result.status, checkpoint: result.checkpoint, outcome });
    return result;
  } catch (err) {
    const orch = err instanceof OrchError ? err : new OrchError(codes.INTERNAL, err.message);
    if (rt.violation) {
      result.status = 'failed';
    } else if (orch.code === codes.RESUME_FAILED || orch.code === codes.NO_SESSION) {
      result.status = 'failed';
    } else if (orch.code === codes.LOCKED) {
      result.status = 'failed';
    } else if (orch.code === codes.TIMEOUT || orch.code === codes.DISCONNECT) {
      result.status = 'failed';
    } else {
      result.status = 'failed';
    }
    result.error = { code: orch.code, message: redactString(orch.message) };
    result.outcome = result.outcome || null;
    persist({ status: result.status, error: result.error, violation: rt.violation || undefined });
    store.appendAudit(agentName, { type: 'error', code: orch.code, message: result.error.message });
    log(`ERROR ${agentName} ${orch.code}: ${result.error.message}`);
    result.checkpoint = writeCheckpoint(store, agentName, taskId, result, rt);
    persist({ status: result.status, checkpoint: result.checkpoint });
    const wrapped = new OrchError(orch.code, orch.message, { exitCode: orch.exitCode, details: { result } });
    wrapped.result = result;
    throw wrapped;
  } finally {
    if (client) client.terminate();
    lock.release();
    store.appendAudit(agentName, { type: 'released', taskId });
  }
}

function writeCheckpoint(store, agentName, taskId, result, rt) {
  const checkpoint = {
    agent: agentName,
    taskId,
    mode: result.mode,
    sessionId: result.sessionId,
    status: result.status,
    outcome: result.outcome,
    model: result.model,
    window: result.window,
    used: result.used,
    git: result.git,
    gitBaseSha: result.git && result.git.baseSha,
    tools: result.tools,
    violations: result.violations,
    error: result.error || null,
    replayedEvents: rt.replayEvents,
    outputChars: rt.outputChars,
    finishedAt: new Date().toISOString(),
  };
  return store.writeCheckpoint(agentName, taskId, checkpoint);
}

/** Retry preflight: an ambiguous prior result must be reviewed before re-running. */
function preflightRetry({ cwd, baseSha, previous }) {
  if (!previous) return { ok: true, reason: 'first run' };
  const changed = treeChangedSince(cwd, baseSha);
  if (previous.status === 'completed') return { ok: true, reason: 'previous completed; explicit re-run' };
  if (changed && changed.changed) {
    return { ok: false, reason: 'worktree changed since previous attempt; outcome ambiguous', changed };
  }
  return { ok: true, reason: 'no side effects detected', changed };
}

module.exports = { runTask, buildSpawnSpec, preflightRetry, SYSTEM_PROMPT };
