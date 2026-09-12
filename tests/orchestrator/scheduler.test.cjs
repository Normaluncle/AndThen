'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler } = require('../../tools/workbuddy/lib/scheduler.cjs');
const { codes } = require('../../tools/workbuddy/lib/errors.cjs');
const { deferred } = require('./helpers.cjs');

function blockingRun() {
  const calls = [];
  const run = (task) => {
    const d = deferred();
    task.abort = () => d.reject(Object.assign(new Error('aborted'), { code: codes.LOCKED }));
    calls.push({ task, d });
    return d.promise;
  };
  return { run, calls };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('enforces a per-agent mutex for the same session', async () => {
  const { run, calls } = blockingRun();
  const scheduler = new Scheduler({ maxConcurrency: 2, run });

  const first = scheduler.submit({ agent: { name: 'same' }, taskId: 'a', mode: 'new' });
  await tick();
  await assert.rejects(
    scheduler.submit({ agent: { name: 'same' }, taskId: 'b', mode: 'new' }),
    (err) => {
      assert.equal(err.code, codes.LOCKED);
      return true;
    },
  );

  calls[0].d.resolve({ status: 'completed' });
  assert.equal((await first).status, 'completed');
});

test('limits global concurrency and queues the remainder (event-based dispatch)', async () => {
  const { run, calls } = blockingRun();
  const scheduler = new Scheduler({ maxConcurrency: 2, run });

  const p1 = scheduler.submit({ agent: { name: 'a' }, taskId: '1', mode: 'new' });
  const p2 = scheduler.submit({ agent: { name: 'b' }, taskId: '2', mode: 'new' });
  const p3 = scheduler.submit({ agent: { name: 'c' }, taskId: '3', mode: 'new' });
  await tick();

  assert.deepEqual(scheduler.stats(), { max: 2, active: 2, queued: 1, agents: ['a', 'b'] });
  assert.equal(calls.length, 2, 'third task must wait for a free slot');

  calls.find((c) => c.task.agent.name === 'a').d.resolve({ status: 'completed' });
  await tick();
  assert.equal(scheduler.stats().active, 2);
  assert.equal(scheduler.stats().queued, 0);
  assert.equal(calls.length, 3, 'queued task dispatches when a slot frees');

  calls.find((c) => c.task.agent.name === 'b').d.resolve({ status: 'completed' });
  calls.find((c) => c.task.agent.name === 'c').d.resolve({ status: 'completed' });
  const results = await Promise.all([p1, p2, p3]);
  assert.equal(results.length, 3);
});

test('cancel aborts only the target agent', async () => {
  const { run, calls } = blockingRun();
  const scheduler = new Scheduler({ maxConcurrency: 2, run });

  const pa = scheduler.submit({ agent: { name: 'target' }, taskId: 'a', mode: 'new' }).catch((e) => e.code);
  const pb = scheduler.submit({ agent: { name: 'bystander' }, taskId: 'b', mode: 'new' });
  await tick();

  const report = scheduler.cancel('target');
  assert.equal(report.cancelledRunning, true);
  assert.equal(await pa, codes.LOCKED);

  // The bystander task is untouched and can still complete.
  assert.equal(scheduler.stats().agents.includes('bystander'), true);
  calls.find((c) => c.task.agent.name === 'bystander').d.resolve({ status: 'completed' });
  assert.equal((await pb).status, 'completed');

  const noop = scheduler.cancel('never-existed');
  assert.equal(noop.cancelledRunning, false);
  assert.equal(noop.removedFromQueue, 0);
});

test('cancel removes a queued (not yet running) task', async () => {
  const { run, calls } = blockingRun();
  const scheduler = new Scheduler({ maxConcurrency: 1, run });

  const running = scheduler.submit({ agent: { name: 'a' }, taskId: '1', mode: 'new' });
  const queued = scheduler.submit({ agent: { name: 'b' }, taskId: '2', mode: 'new' }).catch((e) => e.code);
  await tick();
  assert.equal(scheduler.stats().queued, 1);

  const report = scheduler.cancel('b');
  assert.equal(report.removedFromQueue, 1);
  assert.equal(await queued, codes.LOCKED);

  calls[0].d.resolve({ status: 'completed' });
  await running;
  assert.equal(scheduler.stats().queued, 0);
});
