import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimError, claimNotice, claimState, displayDate, emptyPreview, emptySteps, fixtureSteps,
  importPreview, latestSnapshot, publishedLabel, resolveNotice, summaryImported, verificationSteps,
} from './import-flow.js';

const snapshot = {
  id: 's2', version: 2, material_level: 'exact_excerpt',
  body: null, excerpt: '我在大厂工作了五年，上周提交了辞职申请。',
  published_at: null, upstream_updated_at: '2026-05-25T06:21:18.000Z',
};

test('a missing publication date is reported as missing, never replaced by the edit time', () => {
  assert.equal(publishedLabel({ published_at: '2021-06-12T00:00:00.000Z', upstream_updated_at: '2026-05-25T06:21:18.000Z' }), '2021-06-12');
  assert.equal(publishedLabel({ published_at: null, upstream_updated_at: '2026-05-25T06:21:18.000Z' }), '未提供（官方摘要更新于 2026-05-25）');
  assert.equal(publishedLabel({ published_at: null, upstream_updated_at: null }), '未提供');
  assert.equal(publishedLabel(null), '未提供');
  assert.equal(displayDate('not-a-date'), null);
});

test('the preview maps real fields and falls back honestly when the official adapter returned nothing', () => {
  const preview = importPreview({
    source: { title: '辞职去做自己真正喜欢的事情，值得吗？', source_type: 'third_party_link', original_url: 'https://www.zhihu.com/answer/987654321' },
    snapshot,
    candidate: { author_name: '林下的风', author_avatar: 'https://pic1.zhimg.com/a.jpg', text: '官方摘要' },
  });
  assert.equal(preview.title, '辞职去做自己真正喜欢的事情，值得吗？');
  assert.equal(preview.text, snapshot.excerpt);
  assert.equal(preview.sourceLabel, '知乎公开回答');
  assert.equal(preview.authorName, '林下的风');
  assert.equal(preview.authorAvatar, 'https://pic1.zhimg.com/a.jpg');
  assert.equal(preview.authorNote, '来自知乎官方公开信息');
  assert.equal(preview.originalUrl, 'https://www.zhihu.com/answer/987654321');

  const empty = importPreview({ source: { source_type: 'third_party_link' }, snapshot: { version: 1, body: null, excerpt: null } });
  assert.equal(empty.title, '官方渠道暂未提供标题');
  assert.equal(empty.text, '官方渠道暂未取得正文。补充原文后可以继续。');
  assert.equal(empty.originalUrl, null);
  assert.equal(summaryImported({ source: { title: 'x' } }), true);
  assert.equal(summaryImported({ source: {}, snapshot: { body: null } }), false);
});

test('latest snapshot is the highest version, not the first row returned', () => {
  assert.equal(latestSnapshot([{ version: 1 }, { version: 3 }, { version: 2 }]).version, 3);
  assert.equal(latestSnapshot([]), null);
  assert.equal(latestSnapshot(undefined), null);
});

test('the three status rows follow real state and only offer the actions that are still valid', () => {
  const imported = { source: { title: '标题' }, snapshot };
  const pending = verificationSteps({ ...imported, verifications: [], userId: 'me' });
  assert.deepEqual(pending.map((row) => row.tone), ['green', 'orange', 'gray']);
  assert.equal(pending[1].action, null);
  assert.equal(pending[2].action, '确认这是我的回答');

  const notImported = verificationSteps({ source: {}, snapshot: { version: 1, body: null, excerpt: null }, verifications: [], userId: 'me' });
  assert.equal(notImported[0].title, '官方摘要待补全');
  assert.equal(notImported[1].title, '原文片段待补充');
  assert.equal(notImported[1].action, '去粘贴原文');
});

test('a self-claim reads as declared-and-unverified, and never as verified', () => {
  const own = [{ user_id: 'me', method: 'self_claim', status: 'pending' }];
  assert.equal(claimState({ verifications: own, userId: 'me' }), 'claimed');
  const claimed = verificationSteps({ source: { title: '标题' }, snapshot, verifications: own, userId: 'me' });
  assert.equal(claimed[2].title, '作者身份已声明，等待核验');
  assert.equal(claimed[2].action, null);

  assert.equal(claimState({ verifications: [{ user_id: 'me', method: 'oauth', status: 'verified' }], userId: 'me' }), 'verified');
  assert.equal(verificationSteps({ source: { title: '标题' }, snapshot, verifications: [{ user_id: 'me', method: 'oauth', status: 'verified' }], userId: 'me' })[2].title, '作者身份已确认');
  assert.equal(claimState({ verifications: [{ user_id: 'someone', method: 'oauth', status: 'verified' }], userId: 'me' }), 'other');
  assert.equal(verificationSteps({ source: { title: '标题' }, snapshot, verifications: [{ user_id: 'someone', method: 'oauth', status: 'verified' }], userId: 'me' })[2].action, null);
  assert.equal(claimState({ verifications: [], userId: 'me' }), 'none');
});

test('a claim needs the text, and the notices report the real analysis status', () => {
  assert.equal(claimError('   '), '请先粘贴原回答的正文，再确认这是你的回答。');
  assert.equal(claimError('原回答正文'), '');
  assert.equal(resolveNotice({ status: 'pending_content' }), '已登记链接，官方渠道暂未取得正文。可以补充原文继续。');
  assert.equal(resolveNotice({ status: 'summary_available' }), '已取得官方摘要，等待你核验来源边界。');
  assert.equal(resolveNotice(null), '');
  assert.match(claimNotice('queued'), /AI 正在核验/);
  assert.match(claimNotice('awaiting_model_consent'), /同意模型处理后/);
  assert.match(claimNotice('model_unconfigured'), /模型尚未配置/);
  assert.match(claimNotice('available'), /不会公开展示/);
});

test('the anonymous concept preview keeps its own copy and never claims a real identity', () => {
  const idle = fixtureSteps({ text: '', verified: false });
  assert.deepEqual(idle.map((row) => row.tone), ['green', 'orange', 'gray']);
  assert.equal(idle[0].title, '官方摘要已导入');
  assert.equal(idle[1].title, '原文片段待补充');
  assert.equal(idle[1].action, '去粘贴原文');
  assert.equal(idle[2].title, '作者身份待确认');
  assert.equal(idle[2].action, '确认这是我的回答');

  const local = fixtureSteps({ text: '粘贴的内容', verified: true });
  assert.equal(local[1].title, '原文片段已补充');
  assert.equal(local[1].action, '去粘贴原文');
  assert.equal(local[2].title, '作者身份已确认（演示）');
  assert.equal(local[2].action, '确认这是我的回答');
});

test('a signed-in visitor with nothing imported never sees the sample story or its date', () => {
  assert.equal(emptyPreview.publishedLabel, '未取得');
  assert.equal(emptyPreview.originalUrl, null);
  assert.doesNotMatch(emptyPreview.title, /辞职/);
  assert.equal(emptyPreview.authorNote, '尚未取得官方公开信息');

  const steps = emptySteps();
  assert.deepEqual(steps.map((row) => row.tone), ['orange', 'orange', 'gray']);
  assert.deepEqual(steps.map((row) => row.action), [null, null, null]);
  assert.equal(steps[0].title, '尚未导入链接');
});
