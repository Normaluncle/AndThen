'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { LockManager, ConcurrencyGate } = require('../../tools/workbuddy/lib/locks.cjs');
const { codes } = require('../../tools/workbuddy/lib/errors.cjs');

function freshLocks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-locks-'));
  return { locks: new LockManager({ dir }), dir };
}

function deadPid() {
  const r = spawnSync(process.execPath, ['-e', '0']);
  return r.pid;
}

test('reclaims a stale lock whose holder PID is dead', () => {
  const { locks } = freshLocks();
  const file = path.join(locks.dir, 'agent-stale.lock');
  fs.writeFileSync(
    file,
    JSON.stringify({ kind: 'agent', key: 'stale', token: 'dead', pid: deadPid(), createdAt: new Date().toISOString() }),
  );

  const handle = locks.acquire('agent', 'stale', { agent: 'stale' });
  assert.ok(handle);
  assert.notEqual(locks.peek('agent', 'stale').token, 'dead');
  handle.release();
  assert.equal(locks.peek('agent', 'stale'), null);
});

test('refuses to acquire a lock held by a live PID', () => {
  const { locks } = freshLocks();
  const held = locks.acquire('agent', 'live', { agent: 'live' });
  assert.throws(
    () => locks.acquire('agent', 'live', { agent: 'live' }),
    (err) => {
      assert.equal(err.code, codes.LOCKED);
      assert.equal(err.details.holderPid, process.pid);
      return true;
    },
  );
  held.release();
  const again = locks.acquire('agent', 'live', { agent: 'live' });
  again.release();
});

test('only the owning token can release a lock', () => {
  const { locks } = freshLocks();
  const held = locks.acquire('agent', 'own', {});
  locks._release(path.join(locks.dir, 'agent-own.lock'), 'wrong-token');
  assert.ok(locks.peek('agent', 'own'), 'wrong token must not release');
  held.release();
  assert.equal(locks.peek('agent', 'own'), null);
});

test('concurrency gate caps slots and wakes waiters when one frees', async () => {
  const { locks } = freshLocks();
  const gate = new ConcurrencyGate({ locks, max: 1, pollFallbackMs: 25 });

  const first = gate.tryAcquire('a');
  assert.ok(first);
  assert.equal(gate.tryAcquire('b'), null, 'no second slot while one is held');

  let waited = false;
  const pending = gate.acquire({ key: 'b', onWait: () => { waited = true; } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(waited, true, 'onWait should fire when no slot is free');

  first.release();
  const second = await pending;
  assert.ok(second);
  assert.equal(locks.countLive('slot'), 1);
  second.release();
  assert.equal(locks.countLive('slot'), 0);
});

test('concurrency gate drops stale slots from dead PIDs', () => {
  const { locks } = freshLocks();
  const gate = new ConcurrencyGate({ locks, max: 1 });
  const file = path.join(locks.dir, 'slot-dead.lock');
  fs.writeFileSync(file, JSON.stringify({ kind: 'slot', key: 'dead', token: 'x', pid: deadPid() }));
  assert.equal(locks.countLive('slot'), 0);
  const handle = gate.tryAcquire('new');
  assert.ok(handle, 'stale slot should not block a new claim');
  handle.release();
});
