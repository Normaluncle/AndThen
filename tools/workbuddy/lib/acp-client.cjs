'use strict';

const { spawn } = require('node:child_process');
const { OrchError, codes } = require('./errors.cjs');
const { killTree } = require('./exec.cjs');

/**
 * Minimal ACP (Agent Client Protocol) client over newline-delimited JSON-RPC on
 * a child process's stdio. Owns exactly one child; terminating it never touches
 * other agents' processes.
 */
class AcpClient {
  constructor({
    spawnSpec,
    requestTimeoutMs = 60000,
    promptTimeoutMs = 2700000,
    onNotification,
    onServerRequest,
    onStderr,
    onExit,
    logger,
  } = {}) {
    this.spawnSpec = spawnSpec;
    this.requestTimeoutMs = requestTimeoutMs;
    this.promptTimeoutMs = promptTimeoutMs;
    this.onNotification = onNotification || (() => {});
    this.onServerRequest = onServerRequest || null;
    this.onStderr = onStderr || null;
    this.onExit = onExit || null;
    this.logger = logger || (() => {});
    this.seq = 0;
    this.pending = new Map();
    this.buffer = '';
    this.child = null;
    this.closed = false;
    this.exitInfo = null;
  }

  start() {
    this.child = spawn(this.spawnSpec.command, this.spawnSpec.args, {
      cwd: this.spawnSpec.cwd,
      env: this.spawnSpec.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    this.child.stdout.on('data', (d) => this._onData(d));
    this.child.stderr.on('data', (d) => {
      if (this.onStderr) this.onStderr(d.toString());
    });
    this.child.on('error', (err) => this._failAll(new OrchError(codes.DISCONNECT, `agent process error: ${err.message}`)));
    this.child.on('exit', (code, signal) => this._onChildExit(code, signal));
    return this;
  }

  get pid() {
    return this.child ? this.child.pid : null;
  }

  _onData(chunk) {
    this.buffer += chunk.toString();
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this._handle(msg);
    }
  }

  _handle(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new OrchError(codes.INTERNAL, `ACP error for ${p.method}: ${JSON.stringify(msg.error)}`, { details: msg.error }));
      else p.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined && msg.method) {
      this._handleServerRequest(msg);
      return;
    }
    if (msg.method) this.onNotification(msg.method, msg.params);
  }

  _handleServerRequest(msg) {
    const respond = (result, error) => {
      if (this.closed) return;
      this._write(error ? { jsonrpc: '2.0', id: msg.id, error } : { jsonrpc: '2.0', id: msg.id, result });
    };
    if (!this.onServerRequest) {
      respond(null, { code: -32601, message: 'client does not support server requests' });
      return;
    }
    Promise.resolve()
      .then(() => this.onServerRequest(msg.method, msg.params, msg.id))
      .then((result) => respond(result === undefined ? null : result))
      .catch((err) =>
        respond(null, { code: -32000, message: String((err && err.message) || err) }),
      );
  }

  call(method, params, { timeoutMs } = {}) {
    if (this.closed) return Promise.reject(new OrchError(codes.DISCONNECT, 'agent process is not running'));
    const id = ++this.seq;
    const ms = timeoutMs !== undefined ? timeoutMs : this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OrchError(codes.TIMEOUT, `timed out waiting for ${method}`));
      }, ms);
      if (timer.unref) timer.unref();
      this.pending.set(id, { resolve, reject, timer, method });
      this._write({ jsonrpc: '2.0', id, method, params });
    });
  }

  _write(obj) {
    if (this.closed || !this.child) return;
    try {
      this.child.stdin.write(`${JSON.stringify(obj)}\n`);
    } catch {
      /* stdin closed; exit handler will reject pending calls */
    }
  }

  _onChildExit(code, signal) {
    this.closed = true;
    this.exitInfo = { code, signal };
    this._failAll(new OrchError(codes.DISCONNECT, `agent process exited (code=${code} signal=${signal})`));
    if (this.onExit) this.onExit(this.exitInfo);
  }

  _failAll(err) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  /** Terminate this agent's child process tree only. */
  terminate() {
    this.closed = true;
    if (this.child && this.child.pid) killTree(this.child.pid);
    try {
      if (this.child) this.child.stdin.end();
    } catch {
      /* ignore */
    }
  }
}

module.exports = { AcpClient };
