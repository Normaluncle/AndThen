import test from 'node:test';
import assert from 'node:assert/strict';
import { followingFeed, groupReadingSections, yearFromText } from './reading-layout.js';

test('later pages group past statements into then/later/reflection even without section tags', () => {
  const grouped = groupReadingSections([
    { id: 'a', text: '2021年我辞职了。' },
    { id: 'b', text: '后来换了工作。' },
    { id: 'c', text: '现在觉得值得。' },
  ]);
  assert.deepEqual(grouped.then.map((item) => item.id), ['a']);
  assert.deepEqual(grouped.later.map((item) => item.id), ['b']);
  assert.deepEqual(grouped.reflection.map((item) => item.id), ['c']);
  assert.equal(yearFromText('2021年我辞职了。'), '2021');
});

test('unavailable follows reuse the official summary instead of rendering a blank card', () => {
  const feed = followingFeed(
    [{ source_id: 'src-1', available: false, followed_at: '2026-09-12T00:00:00Z', title: null, text: null }],
    [{ candidate_id: 'cand-1', linked_source_id: 'src-1', title: '转行两年', text: '我从车辆工程转行。', author_name: '司晨' }],
  );
  assert.equal(feed.length, 1);
  assert.equal(feed[0].title, '转行两年');
  assert.equal(feed[0].text, '我从车辆工程转行。');
  assert.equal(feed[0].id, 'cand-1');
});
