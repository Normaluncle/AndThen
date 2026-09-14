import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const connected = readFileSync(new URL('./Connected.jsx', import.meta.url), 'utf8');
const saved = readFileSync(new URL('./ConnectedSaved.jsx', import.meta.url), 'utf8');

// The deployed candidate page used to render FollowBlock without `followed`, so it kept offering
// 关注后续 even after the follow had been saved (HTTP 200, an active row in `interests`).
test('the candidate page shows the follow state and can undo it', () => {
  assert.match(connected, /resource\.value\?\.candidate\?\.interested/, 'the follow state must come from the candidate the API returns');
  assert.match(connected, /<FollowBlock followed=\{followed\}/, 'FollowBlock must receive the follow state');
  assert.match(connected, /candidates\/\$\{id\}\/interest`,'PUT',\{active\}/, 'the same request must be able to follow and unfollow');
  assert.doesNotMatch(connected, /candidates\/\$\{id\}\/interest`,'PUT',\{active:true\}/, 'following must not be hardcoded to active:true');
});

test('the empty history state tells the reader what is recorded', () => {
  assert.match(saved, /浏览记录只记录本站已发布故事/);
});
