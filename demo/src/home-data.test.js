import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeStories, filterHomeStories, homeAction} from './home-data.js';

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
