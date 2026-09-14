import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('./Home.jsx', import.meta.url), 'utf8');

// The feed renders both design fixtures (which carry `design-…` ids) and live official
// candidates (which carry `candidate_id` and no `id` at all). Deriving the local interaction
// key straight from `item.id` blanked the deployed homepage on 2026-09-14.
test('the feed never reads the local interaction key off item.id directly', () => {
  assert.doesNotMatch(source, /interactions\[item\.id\.replace/);
  assert.match(source, /interactions\[designInteractionKey\(item\)\]/);
});
