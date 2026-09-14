import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interviewInsert, interviewRail} from './interview-rail.js';

test('interview rail uses live context and the current AI purpose when present', () => {
  const rail = interviewRail({
    title: '辞职之后',
    text: '当时的原文',
    published_at: '2021-06-12T00:00:00Z',
    original_url: 'https://www.zhihu.com/answer/1',
    reader_interests: {tags: [{tag: '现在的结果与变化'}, {tag: '过程中的转折'}]},
  }, {purpose: '对照当时的选择与现在的生活。'});
  assert.equal(rail.originalText, '当时的原文');
  assert.equal(rail.originalDate, '2021-06-12');
  assert.equal(rail.why, '对照当时的选择与现在的生活。');
  assert.deepEqual(rail.reader, ['现在的结果与变化', '过程中的转折']);
});

test('interview rail keeps a readable fallback when AI output has not arrived', () => {
  const rail = interviewRail({title: '辞职之后'}, null);
  assert.match(rail.why, /辞职之后/);
  assert.equal(rail.reader.length, 4);
  assert.match(rail.originalText, /材料就绪后/);
});

test('composer toolbar inserts marks instead of Chinese labels', () => {
  assert.equal(interviewInsert('', 'bold'), ' **重点**');
  assert.equal(interviewInsert('a', 'italic'), 'a *感受*');
  assert.match(interviewInsert('', 'link'), /https:\/\//);
  assert.equal(interviewInsert('a', 'list'), 'a\n- ');
});

test('empty context still fills every interview rail card', () => {
  const rail = interviewRail(null, null);
  assert.ok(rail.originalText.length > 0);
  assert.ok(rail.why.length > 0);
  assert.equal(rail.reader.length, 4);
});
