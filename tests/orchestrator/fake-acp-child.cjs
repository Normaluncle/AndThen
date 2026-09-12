'use strict';

/**
 * Fake ACP agent used by the orchestrator tests. Speaks newline-delimited
 * JSON-RPC on stdio, mirroring the real WorkBuddy CLI's observable protocol:
 *   - session/new returns configOptions WITHOUT context_window until a model
 *     is set (matches the real CLI), so the client must set model then context.
 *   - session/load replays old events that must not be treated as current output.
 *
 * Behaviour is selected with FAKE_ACP_MODE. Every received message is appended
 * as JSONL to FAKE_ACP_LOG so tests can assert call ordering.
 */

const fs = require('node:fs');

const MODE = process.env.FAKE_ACP_MODE || 'normal';
const LOG_FILE = process.env.FAKE_ACP_LOG || '';
const FIXED_MODEL = 'deepseek-v4.1-flash';

const sessionId = `sess-${process.pid}`;
let contextVisible = false;
let contextValue = '300000';
let currentModel = FIXED_MODEL;
const pendingPermission = new Map();

function log(entry) {
  if (!LOG_FILE) return;
  try {
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  } catch {
    /* ignore */
  }
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function notify(update) {
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
}

function configOptions() {
  const options = [
    { id: 'mode', currentValue: 'acceptEdits', options: [{ value: 'acceptEdits' }, { value: 'default' }] },
    { id: 'model', currentValue: currentModel, options: [{ value: FIXED_MODEL }, { value: 'other-model' }] },
  ];
  if (contextVisible) {
    options.push({ id: 'context_window', currentValue: contextValue, options: [{ value: '300000' }, { value: '1000000' }] });
  }
  options.push({ id: 'sandbox', currentValue: 'none', options: [] });
  return options;
}

function onRequest(msg) {
  log({ dir: 'recv', method: msg.method, params: msg.params });
  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [], configOptions: configOptions() },
      });
      return;
    case 'session/new':
      if (MODE === 'new_no_session') {
        send({ jsonrpc: '2.0', id: msg.id, result: {} });
        return;
      }
      contextVisible = false;
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId, configOptions: configOptions() } });
      return;
    case 'session/load':
      if (MODE === 'load_fail') {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: 'session not found' } });
        return;
      }
      contextVisible = false;
      contextValue = '300000';
      // Replayed history — must never be mistaken for current output.
      notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REPLAYED_OLD_OUTPUT_SHOULD_BE_IGNORED' } });
      notify({ sessionUpdate: 'usage_update', size: 300000, used: 999 });
      notify({ sessionUpdate: 'tool_call', toolCallId: 'old-tool', title: 'OldToolCall', status: 'completed' });
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId, configOptions: configOptions() } });
      return;
    case 'session/set_config_option': {
      const { configId, value } = msg.params || {};
      if (configId === 'model') {
        currentModel = value;
        contextVisible = true; // real CLI reveals context_window after model refresh
      } else if (configId === 'context_window') {
        contextValue = String(value);
        contextVisible = true;
      }
      send({ jsonrpc: '2.0', id: msg.id, result: { configOptions: configOptions() } });
      return;
    }
    case 'session/prompt':
      onPrompt(msg);
      return;
    default:
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
  }
}

function onPrompt(msg) {
  if (MODE === 'disconnect') {
    log({ dir: 'exit', reason: 'disconnect mode' });
    process.exit(0);
  }
  if (MODE === 'hang') {
    log({ dir: 'hang', note: 'no response' });
    return;
  }

  if (MODE === 'stream') {
    notify({ sessionUpdate: 'usage_update', size: 1000000, used: 10 });
    notify({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read d:\\x\\file.md (1 - 50)', status: 'in_progress' });
    // Streaming updates with no status must not be printed.
    notify({ sessionUpdate: 'tool_call_update', toolCallId: 't1' });
    notify({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' });
    notify({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    notify({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Bash\nnode -e "token=SUPERSECRETTOKENVALUE"' });
    notify({ sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'failed' });
    for (const chunk of ['Hel', 'lo ', 'wor', 'ld\n', 'second', ' line']) {
      notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } });
    }
    finishPrompt(msg);
    return;
  }

  let usageSize = Number(contextValue);
  if (MODE === 'window300k') usageSize = 300000;
  notify({ sessionUpdate: 'usage_update', size: usageSize, used: 1234 });

  if (MODE === 'permission_forbidden' || MODE === 'permission_allowed') {
    const command = MODE === 'permission_forbidden' ? 'git reset --hard HEAD~1' : 'git status --porcelain';
    notify({ sessionUpdate: 'tool_call', toolCallId: 'perm-tool', title: 'Bash', status: 'in_progress' });
    const id = 9001;
    send({
      jsonrpc: '2.0',
      id,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: { toolCallId: 'perm-tool', name: 'Bash', title: `Run: ${command}`, rawInput: { command } },
        options: [
          { optionId: 'allow', kind: 'allow_once', name: 'Allow once' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
        ],
      },
    });
    pendingPermission.set(id, msg);
    return;
  }

  finishPrompt(msg);
}

function onPermissionResponse(msg) {
  const prompt = pendingPermission.get(msg.id);
  if (!prompt) return;
  pendingPermission.delete(msg.id);
  log({ dir: 'permission_response', id: msg.id, result: msg.result, error: msg.error });
  finishPrompt(prompt);
}

function finishPrompt(msg) {
  if (MODE === 'outcome_error') {
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn', _meta: { 'codebuddy.ai/outcome': 'ERROR' } } });
    return;
  }
  const meta = { 'codebuddy.ai/outcome': 'SUCCESS', 'codebuddy.ai/responseModelId': FIXED_MODEL };
  if (MODE === 'model_drift') meta['codebuddy.ai/responseModelId'] = 'other-model';
  send({
    jsonrpc: '2.0',
    id: msg.id,
    result: { stopReason: 'end_turn', _meta: meta, usage: { size: Number(contextValue) } },
  });
}

function handle(msg) {
  if (msg.id !== undefined && msg.result !== undefined && msg.method === undefined) {
    onPermissionResponse(msg);
    return;
  }
  if (msg.id !== undefined && msg.method) {
    onRequest(msg);
    return;
  }
  if (msg.id !== undefined && msg.error !== undefined) {
    onPermissionResponse(msg);
  }
}

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});

if (MODE === 'stderr_secret') {
  process.stderr.write('connecting with token=SUPERSECRETTOKENVALUE and Bearer abcdef0123456789\n');
}

log({ dir: 'cwd', cwd: process.cwd() });

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
