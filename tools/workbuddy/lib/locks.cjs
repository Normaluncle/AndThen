'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { OrchError, codes, EXIT } = require('./errors.cjs');
const { isPidAlive } = require('./exec.cjs');
const { sanitize } = require('./state.cjs');

class LockHandle {
  constructor({ manager, kind, key, file, token }) {
    this.manager = manager;
    this.kind = kind;
    this.key = key;
    this.file = file;
    this.token = token;
    this.released = false;
  }

  update(patch) {
    if (this.released) return null;
    return this.manager._update(this.file, this.token, patch);
  }

  release() {
    if (this.released) return;
    this.released = true;
    this.manager._release(this.file, this.token);
  }
}

/**
 * File-based exclusive locks with PID staleness detection. Used for the
 * per-agent/session mutex and for the cross-process concurrency gate.
 */
class LockManager {
  constructor({ dir }) {
    this.dir = path.join(dir, 'locks');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(kind, key) {
    return path.join(this.dir, `${sanitize(kind)}-${sanitize(key)}.lock`);
  }

  _read(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  /** Read a lock record without acquiring. */
  peek(kind, key) {
    return this._read(this._file(kind, key));
  }

  /**
   * Acquire an exclusive lock. A lock whose PID is no longer alive is stale and
   * is reclaimed. Live holders raise E_LOCKED.
   */
  acquire(kind, key, meta = {}) {
    const file = this._file(kind, key);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = crypto.randomBytes(8).toString('hex');
      const record = {
        kind,
        key,
        token,
        pid: process.pid,
        createdAt: new Date().toISOString(),
        ...meta,
      };
      try {
        fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx' });
        return new LockHandle({ manager: this, kind, key, file, token });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        const existing = this._read(file);
        if (!existing || !isPidAlive(existing.pid)) {
          // Stale lock (dead PID or unreadable): reclaim and retry.
          try {
            fs.unlinkSync(file);
          } catch {
            /* raced with another reclaimer */
          }
          continue;
        }
        throw new OrchError(codes.LOCKED, `lock "${kind}:${key}" held by live pid ${existing.pid}`, {
          exitCode: EXIT.LOCKED,
          details: { kind, key, holderPid: existing.pid, since: existing.createdAt },
        });
      }
    }
    throw new OrchError(codes.LOCKED, `could not acquire lock "${kind}:${key}"`, { exitCode: EXIT.LOCKED });
  }

  _update(file, token, patch) {
    const current = this._read(file);
    if (!current || current.token !== token) return null;
    const merged = { ...current, ...patch, updatedAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(merged));
    return merged;
  }

  _release(file, token) {
    const current = this._read(file);
    if (!current) return;
    if (token && current.token !== token) return; // do not release someone else's lock
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }

  /** Remove a lock regardless of holder (used by cancel after killing the holder). */
  forceRelease(kind, key) {
    try {
      fs.unlinkSync(this._file(kind, key));
    } catch {
      /* already gone */
    }
  }

  list(kind) {
    if (!fs.existsSync(this.dir)) return [];
    const prefix = `${sanitize(kind)}-`;
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.lock'))
      .map((f) => this._read(path.join(this.dir, f)))
      .filter(Boolean);
  }

  /** Count locks of a kind whose holder is still alive, dropping stale ones. */
  countLive(kind) {
    let live = 0;
    for (const rec of this.list(kind)) {
      if (rec && isPidAlive(rec.pid)) live += 1;
      else if (rec) this.forceRelease(rec.kind, rec.key);
    }
    return live;
  }
}

/**
 * Cross-process concurrency gate. Slots are lock files; acquisition is
 * event-driven (fs.watch on the locks dir) rather than a fixed poll loop.
 */
class ConcurrencyGate {
  constructor({ locks, max = 2, pollFallbackMs = 250 }) {
    this.locks = locks;
    this.max = max;
    this.pollFallbackMs = pollFallbackMs;
    this._waiters = new Set();
  }

  _tryClaim(key) {
    try {
      return this.locks.acquire('slot', key, { gate: true });
    } catch (err) {
      if (err.code === codes.LOCKED) return null;
      throw err;
    }
  }

  /** Claim a slot immediately or return null (no waiting). */
  tryAcquire(key) {
    if (this.locks.countLive('slot') >= this.max) return null;
    return this._tryClaim(key);
  }

  /**
   * Claim a slot or wait until one frees. Resolves with a handle that must be
   * released. `signal` (AbortSignal) cancels the wait.
   */
  acquire({ key, timeoutMs = 0, onWait, signal } = {}) {
    const claim = () => this.tryAcquire(key);

    const immediate = claim();
    if (immediate) return Promise.resolve(immediate);
    if (onWait) onWait({ max: this.max, active: this.locks.countLive('slot') });

    return new Promise((resolve, reject) => {
      let done = false;
      let timer = null;
      let watcherFs = null;
      let beat = null;

      const cleanup = () => {
        if (watcherFs) watcherFs.close();
        if (beat) clearInterval(beat);
        if (timer) clearTimeout(timer);
        this._waiters.delete(waiter);
      };
      const settle = (fn, arg) => {
        if (done) return;
        done = true;
        cleanup();
        fn(arg);
      };
      const attempt = () => {
        const h = claim();
        if (h) settle(resolve, h);
      };
      const waiter = { attempt, settle };

      try {
        watcherFs = fs.watch(this.locks.dir, () => attempt());
      } catch {
        watcherFs = null;
      }
      // Fallback heartbeat only; primary wake-up is the fs.watch event above.
      beat = setInterval(attempt, this.pollFallbackMs);
      if (beat.unref) beat.unref();

      if (signal) {
        signal.addEventListener(
          'abort',
          () => settle(reject, new OrchError(codes.LOCKED, 'wait aborted', { exitCode: EXIT.LOCKED })),
          { once: true },
        );
      }
      if (timeoutMs > 0) {
        timer = setTimeout(
          () => settle(reject, new OrchError(codes.LOCKED, 'timed out waiting for a concurrency slot', { exitCode: EXIT.LOCKED })),
          timeoutMs,
        );
      }
      this._waiters.add(waiter);
      attempt();
    });
  }
}

module.exports = { LockManager, LockHandle, ConcurrencyGate };
