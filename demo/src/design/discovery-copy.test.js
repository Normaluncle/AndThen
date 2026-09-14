import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryAside} from './discovery-copy.js';

test('the discovery sidebar does not call a public feed a local-only preview', () => {
  const local = discoveryAside(false);
  assert.equal(local.title, '自动发现 · 本地验证');
  assert.match(local.note, /不会发布到公网/);

  const live = discoveryAside(true);
  assert.equal(live.title.includes('本地验证'), false);
  assert.equal(live.note.includes('不会发布到公网'), false);
  assert.match(live.title, /自动发现/);
  // Both modes still say the candidates are unconfirmed official summaries.
  assert.equal(local.body, live.body);
  assert.match(live.body, /尚未经过作者确认/);
});
