import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const base = option('--base-url', 'http://127.0.0.1:8080');
const statePath = resolve(option('--state-file', 'data/demo/state.json'));
async function call(method, path, token, body) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${result.error_code ?? 'unknown'}`);
  return result.data;
}
async function waitFor(check) {
  for (let i = 0; i < 30; i++) { const result = await check(); if (result) return result; await new Promise(r => setTimeout(r, 500)); }
  throw new Error('Timed out waiting for durable worker result');
}
const save = state => { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 }); };
if (args.includes('--verify') || args.includes('--cleanup')) {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (state.provenance !== 'test_fixture') throw new Error('Only test fixtures can be handled by this script');
  if (args.includes('--cleanup')) {
    await call('POST', `/followups/${state.draftId}/withdraw`, state.authorToken);
    const receipt = await call('DELETE', `/sources/${state.sourceId}`, state.authorToken);
    await waitFor(async () => (await call('GET', `/deletions/${receipt.deletion_id}`, state.authorToken)).status === 'succeeded');
    await call('POST', '/auth/logout', state.authorToken);
    await call('POST', '/auth/logout', state.readerToken);
    save({ provenance: 'test_fixture', deleted: true, sourceId: state.sourceId, deletionId: receipt.deletion_id });
    console.log(JSON.stringify({ deleted: true, deletion_id: receipt.deletion_id }));
  } else {
    const published = await call('GET', `/followups/${state.draftId}`);
    const history = await call('GET', `/interviews/${state.interviewId}`, state.authorToken);
    const follows = await call('GET', '/me/following', state.readerToken);
    if (!published.statements.some(s => s.text === state.answer) || !history.messages.some(m => m.authorMessage === state.answer)) throw new Error('Persisted fixture content changed');
    if (!follows.items.some(i => i.source_id === state.sourceId)) throw new Error('Persisted interest missing');
    console.log(JSON.stringify({ persisted: true, source_id: state.sourceId, draft_id: state.draftId, interview_messages: history.messages.length }));
  }
} else {
  if (existsSync(statePath) && !JSON.parse(readFileSync(statePath, 'utf8')).deleted) throw new Error('Existing demo state would be overwritten; verify/clean it or choose a new --state-file');
  const tokenPath = option('--admin-token-file');
  if (!tokenPath) throw new Error('Supply --admin-token-file with a one-time bootstrap token; do not put tokens on the command line');
  const admin = await call('POST', '/auth/sessions', null, { login_token: readFileSync(tokenPath, 'utf8').trim() });
  const created = await call('POST', '/admin/users', admin.session_token, { role: 'author', display_name: 'Demo test_fixture author', cohort: 'test_fixture' });
  const author = await call('POST', '/auth/sessions', null, { login_token: created.login_token });
  const reader = await call('POST', '/auth/readers', null, { consent: { accepted: true, version: 'test_fixture_v1' } });
  const state = { provenance: 'test_fixture', authorToken: author.session_token, readerToken: reader.session_token };
  save(state);
  const source = await call('POST', '/sources', state.authorToken, { source_type: 'author_paste', original_url: `https://example.test/andthen/${randomUUID()}`, title: '本地后端演示测试材料', material_level: 'exact_excerpt', excerpt: '当时我计划完成一个小项目。', excerpt_location: 'test_fixture paragraph 1', provenance: 'test_fixture' });
  state.sourceId = source.source_id; save(state);
  await call('POST', `/sources/${state.sourceId}/author-verifications`, admin.session_token, { subject_user_id: created.user.id, method: 'manual', evidence_ref: 'evidence://test_fixture/demo-only', approve: true });
  for (const purpose of ['private_interview', 'demo_public_display']) await call('POST', `/sources/${state.sourceId}/consents`, state.authorToken, { purpose, version: 'demo_v1' });
  const createdCase = await call('POST', '/cases', state.authorToken, { source_id: state.sourceId, launch_type: 'author_initiated' });
  state.caseId = createdCase.case.id; save(state);
  await call('POST', `/cases/${state.caseId}/review`, admin.session_token, { expected_version: createdCase.case.updated_at, snapshot_hash: source.content_hash, decision: 'eligible', reason_code: 'source_checked', evidence_ref: 'evidence://test_fixture/demo-review', confirms_source_and_safety_review: true });
  await call('POST', `/cases/${state.caseId}/decision`, state.authorToken, { decision: 'accept' });
  await call('PUT', `/stories/${state.sourceId}/interest`, state.readerToken, { active: true });
  const started = await call('POST', `/cases/${state.caseId}/interviews`, state.authorToken, { mode: 'manual', confirms_own_content: true, confirms_old_state: true });
  state.interviewId = started.session.id;
  state.answer = '后来我完成了这个小项目，具体日期没有记录。'; save(state);
  const answered = await call('POST', `/interviews/${state.interviewId}/messages`, state.authorToken, { message: state.answer, visibility: 'public', client_message_id: randomUUID(), expected_version: started.session.revision });
  await call('POST', `/interviews/${state.interviewId}/finish`, state.authorToken, { expected_version: answered.session.revision });
  const draft = await call('POST', `/interviews/${state.interviewId}/draft`, state.authorToken);
  state.draftId = draft.id; save(state);
  await call('POST', `/drafts/${draft.id}/confirm`, state.authorToken, { content_hash: draft.contentHash, statement_ids: draft.statements.map(s => s.id) });
  await call('POST', `/drafts/${draft.id}/publish`, state.authorToken, { content_hash: draft.contentHash, confirms_publication: true });
  await waitFor(async () => (await call('GET', '/notifications', state.readerToken)).items.some(n => n.followupVersionId === draft.id));
  await call('POST', '/auth/logout', admin.session_token);
  console.log(JSON.stringify({ completed: true, mode: 'manual_test_fixture', source_id: state.sourceId, draft_id: state.draftId, state_file: statePath, next: 'Use --verify after restart, or --cleanup to withdraw/delete this fixture' }));
}
