'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { redactString, redactJson } = require('./redact.cjs');

function sanitize(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Durable state under the gitignored state dir. All writes are atomic
 * (tmp + rename) so a crashed process never leaves a half-written record.
 */
class StateStore {
  constructor({ dir }) {
    this.dir = dir;
    this.agentsDir = path.join(dir, 'agents');
    this.checkpointsDir = path.join(dir, 'checkpoints');
    this.logsDir = path.join(dir, 'logs');
    this.locksDir = path.join(dir, 'locks');
    for (const d of [this.dir, this.agentsDir, this.checkpointsDir, this.logsDir, this.locksDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  _writeAtomic(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }

  _readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  agentPath(name) {
    return path.join(this.agentsDir, `${sanitize(name)}.json`);
  }

  readAgent(name) {
    return this._readJson(this.agentPath(name));
  }

  writeAgent(name, record) {
    const existing = this.readAgent(name) || {};
    const merged = { ...existing, ...record, name, updatedAt: new Date().toISOString() };
    this._writeAtomic(this.agentPath(name), JSON.stringify(merged, null, 2));
    return merged;
  }

  listAgents() {
    if (!fs.existsSync(this.agentsDir)) return [];
    return fs
      .readdirSync(this.agentsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this._readJson(path.join(this.agentsDir, f)))
      .filter(Boolean);
  }

  queuePath() {
    return path.join(this.dir, 'queue.json');
  }

  readQueue() {
    return this._readJson(this.queuePath()) || { tasks: [] };
  }

  writeQueue(queue) {
    this._writeAtomic(this.queuePath(), JSON.stringify(queue, null, 2));
  }

  checkpointPath(agent, taskId) {
    return path.join(this.checkpointsDir, sanitize(agent), `${sanitize(taskId)}.json`);
  }

  writeCheckpoint(agent, taskId, checkpoint) {
    const file = this.checkpointPath(agent, taskId);
    this._writeAtomic(file, JSON.stringify(checkpoint, null, 2));
    return file;
  }

  readCheckpoint(agent, taskId) {
    return this._readJson(this.checkpointPath(agent, taskId));
  }

  logPath(agent) {
    return path.join(this.logsDir, `${sanitize(agent)}.log`);
  }

  appendLog(agent, line) {
    const text = redactString(String(line)).replace(/\s+$/, '');
    if (!text) return;
    fs.appendFileSync(this.logPath(agent), `${text}\n`);
  }

  auditPath(agent) {
    return path.join(this.logsDir, `${sanitize(agent)}.audit.jsonl`);
  }

  appendAudit(agent, event) {
    const rec = { at: new Date().toISOString(), agent, ...event };
    fs.appendFileSync(this.auditPath(agent), `${redactJson(rec)}\n`);
  }

  readAudit(agent) {
    const file = this.auditPath(agent);
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
}

module.exports = { StateStore, sanitize };
