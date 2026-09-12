import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
const state = JSON.parse(readFileSync(process.argv[2] ?? 'data/demo/state.json', 'utf8'));
if (state.provenance !== 'test_fixture') throw new Error('Performance script requires a test fixture state');
const base = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:8080';
async function call(method, path, token, body) {
  const start = performance.now();
  const response = await fetch(`${base}/api${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Unexpected status ${response.status} on ${path}`);
  return { data: result.data, milliseconds: performance.now() - start, status: response.status };
}
const readers = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/auth/readers', null, { consent: { accepted: true, version: 'performance_test_fixture' } })));
const writes = [];
for (let round = 0; round < 20; round++) {
  const batch = await Promise.all(readers.map(r => call('PUT', `/stories/${state.sourceId}/interest`, r.data.session_token, { active: round % 2 === 0 })));
  writes.push(...batch.map(r => r.milliseconds));
}
const sources = [];
for (let i = 0; i < 10; i++) sources.push((await call('POST', '/sources', state.authorToken, { source_type: 'author_paste', original_url: `https://example.test/performance/${randomUUID()}`, material_level: 'exact_excerpt', excerpt: '明确标记的性能测试材料', excerpt_location: 'test_fixture', provenance: 'test_fixture' })).data.source_id);
const accepted = await Promise.all(sources.map(id => call('DELETE', `/sources/${id}`, state.authorToken)));
if (accepted.some(r => r.status !== 202)) throw new Error('Deletion did not acknowledge asynchronously');
for (const receipt of accepted) {
  let done = false;
  for (let i = 0; i < 60; i++) {
    const result = await call('GET', `/deletions/${receipt.data.deletion_id}`, state.authorToken);
    if (result.data.status === 'succeeded') { done = true; break; }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!done) throw new Error('Asynchronous cleanup did not finish');
}
await Promise.all(readers.map(r => call('POST', '/auth/logout', r.data.session_token)));
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, p95_ms: +sorted[Math.ceil(sorted.length * .95) - 1].toFixed(2), max_ms: +sorted.at(-1).toFixed(2) };
};
const writeStats = stats(writes);
const ackStats = stats(accepted.map(r => r.milliseconds));
const passed = writeStats.p95_ms <= 2000 && ackStats.max_ms <= 1000;
console.log(JSON.stringify({ generated_at: new Date().toISOString(), mode: 'test_fixture', base_url: base, host_node: process.version, host_platform: process.platform, concurrent_sessions: 10, non_model_interest_writes: writeStats, async_delete_acknowledgments: ackStats, async_cleanup_verified: true, passed, limitations: 'Local warm Docker run; not production capacity or model latency. Async sample covers deletion admission.' }, null, 2));
if (!passed) process.exitCode = 1;
