import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeStories, filterHomeStories, filterByDateRange, storyTime, storyTimeText, cardCounts, homeAction, homeDestination} from './home-data.js';

test('home categories and submitted keyword filter the design stories together', () => {
  assert.equal(filterHomeStories(homeStories, '学习成长')[0].id, 'design-study');
  assert.equal(filterHomeStories(homeStories, '全部', '辞职').length, 1);
  assert.equal(filterHomeStories(homeStories, '情感关系', '辞职').length, 0);
  assert.equal(filterHomeStories(homeStories, '全部', '不存在的内容').length, 0);
  assert.equal(filterHomeStories(homeStories, '为你推荐').length, 3);
});
test('design stories never resolve to a live write or story endpoint', () => {
  for (const item of homeStories) {
    assert.equal(item.provenance, 'test_fixture');
    assert.equal(homeAction({...item, source_id: 'must-not-open'}), 'preview');
  }
  assert.equal(homeAction({source_id: 'live-id'}), 'open');
  assert.equal(homeAction({candidate_id: 'candidate'}), 'interest');
  assert.equal(homeAction({url: 'https://www.zhihu.com/'}), 'import');
});
test('home clicks send existing stories to a detail route instead of a preview modal', () => {
  const calls = [];
  const navigate = (screen, options) => calls.push({screen, options});
  assert.equal(homeDestination(homeStories[0], navigate), 'preview');
  assert.deepEqual(calls[0], {screen: '02', options: {story: 'career'}});
  assert.equal(homeDestination({source_id: 'live-id'}, navigate), 'open');
  assert.deepEqual(calls[1], {screen: '02', options: {source: 'live-id'}});
  assert.equal(homeDestination({candidate_id: 'cand-1', title: '摘要'}, navigate), 'interest');
  assert.deepEqual(calls[2], {screen: '02', options: {candidate: 'cand-1'}});
});
test('the story time chain falls back from publish date to update date to capture time', () => {
  assert.deepEqual(storyTime({published_at: '2023-05-05T00:00:00.000Z'}), {date: '2023-05-05', basis: 'published'});
  assert.deepEqual(storyTime({upstream_updated_at: '2026-04-03T03:57:41.000Z'}), {date: '2026-04-03', basis: 'updated'});
  assert.deepEqual(storyTime({acquired_at: '2026-09-14T03:14:16.681Z'}), {date: '2026-09-14', basis: 'acquired'});
  assert.deepEqual(storyTime({published_at: '2021-06-12T00:00:00Z', upstream_updated_at: '2026-04-03T00:00:00Z'}), {date: '2021-06-12', basis: 'published'});
  assert.deepEqual(storyTime({}), {date: null, basis: null});
  // The card says which date it shows instead of calling every date "发布于".
  assert.equal(storyTimeText({published_at: '2021-06-12T00:00:00Z'}), '2021-06-12');
  assert.equal(storyTimeText({upstream_updated_at: '2026-04-03T03:57:41.000Z'}), '2026-04-03 更新');
  assert.equal(storyTimeText({acquired_at: '2026-09-14T03:14:16.681Z'}), '2026-09-14 收录');
  assert.equal(storyTimeText({}), null);
});

test('a date range filters by the chain and never drops a story with no date at all', () => {
  const published = {id: 'a', published_at: '2021-06-12T00:00:00Z'};
  const updated = {id: 'b', upstream_updated_at: '2026-04-03T00:00:00Z'};
  const captured = {id: 'c', acquired_at: '2026-09-14T00:00:00Z'};
  const dateless = {id: 'd'};
  const rows = [published, updated, captured, dateless];

  assert.equal(filterByDateRange(rows, {}).length, 4);
  // This range covers every row, but it used to return nothing at all: an unknown
  // date failed `date && date >= from`, so one filled-in field emptied the feed.
  assert.deepEqual(filterByDateRange(rows, {from: '2020-01-14', to: '2026-09-14'}).map(r => r.id), ['a', 'b', 'c', 'd']);
  // Known dates are still filtered; only the dateless row is exempt.
  assert.deepEqual(filterByDateRange(rows, {from: '2026-01-01'}).map(r => r.id), ['b', 'c', 'd']);
  assert.deepEqual(filterByDateRange(rows, {to: '2022-01-01'}).map(r => r.id), ['a', 'd']);
});

test('a card keeps the platform heat and this site counters as separate numbers', () => {
  const candidate = cardCounts({heat: 24, vote_up_count: 18, comment_count: 3});
  assert.deepEqual(candidate.map(row => [row.icon, row.value]), [['flame', 24], ['like', 0], ['comment', 0], ['star', 0]]);
  assert.match(candidate[0].label, /热度/);
  assert.match(candidate[1].label, /本站/);

  // A site story keeps its own counters and no heat is invented for it.
  const story = cardCounts({site_counts: [4, 1, 2]});
  assert.deepEqual(story.map(row => [row.icon, row.value]), [['like', 4], ['comment', 1], ['star', 2]]);

  // The design preview still reads local interaction state.
  const preview = cardCounts({id: 'design-career'}, {preview: true, interaction: {likes: 7, comments: 2, saves: 1}});
  assert.deepEqual(preview.map(row => [row.icon, row.value]), [['like', 7], ['comment', 2], ['star', 1]]);
});
