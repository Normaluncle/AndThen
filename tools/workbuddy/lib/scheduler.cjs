'use strict';

const { OrchError, codes, EXIT } = require('./errors.cjs');

/**
 * In-process task scheduler: a bounded concurrency pool with a FIFO queue and a
 * per-agent mutex. Dispatch is event-driven — each completion immediately pulls
 * the next queued task; there is no fixed-interval poll loop.
 */
class Scheduler {
  constructor({ maxConcurrency = 2, run, store, logger = () => {} } = {}) {
    if (!run) throw new OrchError(codes.INTERNAL, 'scheduler requires a run function');
    this.max = maxConcurrency;
    this.run = run;
    this.store = store || null;
    this.log = logger;
    this.queue = [];
    this.running = new Map();
    this.closed = false;
  }

  get active() {
    return this.running.size;
  }

  stats() {
    return {
      max: this.max,
      active: this.running.size,
      queued: this.queue.length,
      agents: [...this.running.keys()],
    };
  }

  /**
   * Submit a task. Resolves with the runner result, or rejects if the agent is
   * already running (per-agent mutex) or the task itself fails.
   */
  submit(task) {
    const name = task.agent && task.agent.name;
    if (!name) return Promise.reject(new OrchError(codes.USAGE, 'task.agent.name is required'));
    if (this.running.has(name)) {
      return Promise.reject(
        new OrchError(codes.LOCKED, `agent "${name}" is already running; exclusive session lock held`, {
          exitCode: EXIT.LOCKED,
          details: { agent: name },
        }),
      );
    }
    if (this.closed) return Promise.reject(new OrchError(codes.INTERNAL, 'scheduler is closed'));

    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, enqueuedAt: Date.now() };
      this.queue.push(entry);
      if (this.store) this.store.appendAudit(name, { type: 'queued', taskId: task.taskId, mode: task.mode });
      this._drain();
    });
  }

  _drain() {
    while (!this.closed && this.running.size < this.max && this.queue.length > 0) {
      const entry = this.queue.shift();
      const name = entry.task.agent.name;
      if (this.running.has(name)) {
        entry.reject(new OrchError(codes.LOCKED, `agent "${name}" is already running`, { exitCode: EXIT.LOCKED }));
        continue;
      }
      this.log(`DISPATCH ${name} (active=${this.running.size + 1}/${this.max} queued=${this.queue.length})`);
      if (this.store) this.store.appendAudit(name, { type: 'dispatch', taskId: entry.task.taskId, active: this.running.size + 1 });
      const promise = Promise.resolve()
        .then(() => this.run(entry.task))
        .then(
          (res) => entry.resolve(res),
          (err) => entry.reject(err),
        )
        .finally(() => {
          this.running.delete(name);
          if (this.store) this.store.appendAudit(name, { type: 'finished', taskId: entry.task.taskId });
          this._drain();
        });
      this.running.set(name, { entry, promise });
    }
  }

  /**
   * Cancel a queued or running task for one agent only. Running tasks are
   * aborted through the runner-provided task.abort hook (kills that child tree).
   */
  cancel(agentName) {
    const name = typeof agentName === 'string' ? agentName : agentName && agentName.name;
    const removed = [];
    const kept = [];
    for (const entry of this.queue) {
      if (entry.task.agent.name === name) removed.push(entry);
      else kept.push(entry);
    }
    this.queue = kept;
    for (const entry of removed) {
      entry.reject(
        new OrchError(codes.LOCKED, `queued task for agent "${name}" was cancelled`, { exitCode: EXIT.LOCKED }),
      );
    }
    const active = this.running.get(name);
    if (active && typeof active.entry.task.abort === 'function') {
      active.entry.task.abort();
    }
    return { agent: name, removedFromQueue: removed.length, cancelledRunning: Boolean(active) };
  }

  async close() {
    this.closed = true;
    const pending = this.queue.splice(0);
    for (const entry of pending) {
      entry.reject(new OrchError(codes.INTERNAL, 'scheduler closed before task ran'));
    }
    await Promise.allSettled([...this.running.values()].map((r) => r.promise));
  }
}

module.exports = { Scheduler };
