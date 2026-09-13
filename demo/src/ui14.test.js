import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  COPY, DESKTOP_NAV, EMPTY_STATES, MOBILE_NAV, PAGE_SCREEN, TOKENS,
  actionsFor, emptyKindFor, emptyState, errorStatusOf, interviewProgress, liveCount,
  mapScreen, overlayPattern, sectionBlocks, visibleRegions, workbenchDefaultTab, workbenchTabs,
} from './ui14.js';
import {draftActions, interviewActions} from './workflow.js';

const named = [
  COPY.then, COPY.writeLater, COPY.followLater, COPY.willing,
  COPY.saveContinue, COPY.skipQuestion, COPY.confirmPublish, ...COPY.sections,
];

function fixture(page, extra = {}) {
  return mapScreen({page, viewport: extra.viewport || 'desktop', ...extra});
}

test('design system 15 exposes brand tokens, type of CTAs, and chrome labels', () => {
  assert.equal(TOKENS.primary, '#2563FF');
  assert.equal(TOKENS.secondary, '#60A5FA');
  assert.equal(TOKENS.light, '#DBEAFE');
  assert.equal(TOKENS.brand, '然后呢？');
  assert.deepEqual(DESKTOP_NAV, ['发现', '我的关注', '写下后来']);
  assert.deepEqual(MOBILE_NAV.map((item) => item.label), ['发现', '关注', '写下后来', '后来', '我的']);
  for (const label of named) assert.equal(typeof label, 'string');
  assert.ok(named.every((label) => label.length > 0));
});

test('mapScreen sends API-shaped discover/following/notice payloads onto screens 01-04 and 08', () => {
  const stories = [{source_id: 's1', title: '演示故事', text: '正文', provenance: 'test_fixture'}];
  const discover = fixture('发现', {items: stories});
  assert.equal(discover.screenId, '01');
  assert.ok(discover.regionIds.includes('hero'));
  assert.ok(discover.regionIds.includes('search'));
  assert.equal(discover.ctas.find((cta) => cta.action === 'interest').label, COPY.then);

  const story = fixture('内容', {story: {title: '演示故事', text: '正文', provenance: 'test_fixture'}});
  assert.equal(story.screenId, '02');
  assert.ok(story.regionIds.includes('interest-panel'));
  assert.ok(story.ctas.some((cta) => cta.label === COPY.followLater));

  const following = fixture('我的关注', {items: stories});
  assert.equal(following.screenId, '03');
  assert.ok(following.regionIds.includes('following-list'));

  const notices = fixture('通知', {notifications: [{id: 'n1', followupVersionId: 'f1'}]});
  assert.equal(notices.screenId, '04');
  assert.equal(notices.chrome.bellBadge, 1);

  const later = fixture('更新', {followup: {statements: [{id: 'a', text: '后来', section: 'later'}]}});
  assert.equal(later.screenId, '08');
  assert.deepEqual(later.sections.map((block) => block.label), COPY.sections);
  assert.equal(later.sections.find((block) => block.key === 'later').items[0].text, '后来');
});

test('mapScreen sends workbench, invite, interview, draft and import payloads onto screens 05-07 and 11-12', () => {
  const workbench = fixture('作者工作台', {items: [{id: 'c1', title: '回访', interest_count: 3}]});
  assert.equal(workbench.screenId, '05');
  assert.equal(workbench.ctas.find((cta) => cta.action === 'openInvite').label, COPY.willing);

  const invite = fixture('回访', {caseId: 'c1', sourceId: 's1'});
  assert.equal(invite.screenId, '11');
  assert.ok(invite.ctas.some((cta) => cta.label === '开始回访'));

  const session = {status: 'active', mode: 'ai', questionsAsked: 2, revision: 4};
  const messages = [{role: 'ai', question: '现在呢？'}];
  const interview = fixture('采访', {session, messages, answer: '一段后来'});
  assert.equal(interview.screenId, '06');
  assert.equal(interview.interview.label, '第 2 / 5');
  const interviewCtas = Object.fromEntries(interview.ctas.map((cta) => [cta.action, cta]));
  const expected = interviewActions(session, messages);
  assert.equal(interviewCtas.saveAnswer.enabled, expected.answer);
  assert.equal(interviewCtas.skipQuestion.label, COPY.skipQuestion);
  assert.equal(interviewCtas.saveAnswer.label, COPY.saveContinue);

  const statements = [{id: '1', text: '后来这段经历值得被认真写下，把当时的选择和现在的结果讲清楚。'.repeat(4), visibility: 'public', section: 'then'}];
  const draft = {status: 'confirmed', statements, contentHash: 'h', version: 2};
  const saved = JSON.stringify(statements);
  const confirm = fixture('草稿', {draft, savedStatements: saved});
  assert.equal(confirm.screenId, '07');
  const publish = confirm.ctas.find((cta) => cta.action === 'publishDraft');
  assert.equal(publish.label, COPY.confirmPublish);
  assert.equal(publish.enabled, draftActions(draft, saved).publish);
  assert.equal(publish.overlay, 'confirm');

  const imported = fixture('导入', {sourceId: 's1'});
  assert.equal(imported.screenId, '12');
  assert.ok(imported.regionIds.includes('import-form'));
});

test('screens 09-10 keep account, memory and admin regions without inventing live totals', () => {
  const account = fixture('账号', {user: {display_name: '演示读者', role: 'reader'}, memory: {status: 'ready'}});
  assert.equal(account.screenId, '09');
  assert.ok(account.regionIds.includes('zhihu-account'));
  assert.ok(account.regionIds.includes('memory'));
  const admin = fixture('回访管理', {user: {role: 'admin'}});
  assert.equal(admin.screenId, '10');
  assert.equal(liveCount(undefined), null);
  assert.equal(liveCount(3), '3');
});

test('empty, withdrawn and timeout from 13 are selected from API/state fixtures', () => {
  assert.equal(emptyKindFor({page: '我的关注', items: []}), 'following_empty');
  assert.equal(emptyState(emptyKindFor({page: '我的关注', items: []})).title, EMPTY_STATES.following_empty.title);
  assert.equal(emptyKindFor({page: '通知', notifications: []}), 'no_notifications');
  assert.equal(emptyKindFor({page: '发现', items: []}), 'discover_empty');
  assert.notEqual(emptyState(emptyKindFor({page: '发现', items: []})).title, EMPTY_STATES.following_empty.title);
  assert.doesNotMatch(emptyState(emptyKindFor({page: '发现', items: []})).title, /关注/);
  assert.equal(emptyState(emptyKindFor({page: '发现', items: []})).ctaPage, '发现');
  assert.equal(emptyKindFor({page: '作者工作台', items: []}), 'workbench_empty');
  assert.equal(emptyKindFor({page: '更新', error: {status: 410}}), 'withdrawn');
  assert.equal(emptyKindFor({page: '更新', followup: {status: 'withdrawn'}}), 'withdrawn');
  assert.equal(emptyKindFor({page: '采访', session: {stopReason: 'model_timeout'}}), 'timeout');
  assert.equal(emptyKindFor({page: '内容', story: {author_declined: true}}), 'author_declined');
  assert.equal(errorStatusOf({status: 410}), 410);
  const withdrawn = fixture('更新', {error: {status: 410}});
  assert.equal(withdrawn.empty.kind, 'withdrawn');
  assert.match(withdrawn.empty.body, /撤回/);
  const timeout = fixture('采访', {session: {stopReason: 'model_timeout'}});
  assert.equal(timeout.empty.kind, 'timeout');
  assert.equal(timeout.empty.cta, '重新尝试');
});

test('overlay pattern 14 picks modal, drawer, sheet, full sheet and toast from intent and viewport', () => {
  assert.equal(overlayPattern('confirm', 'desktop').pattern, 'modal');
  assert.equal(overlayPattern('destructive', 'desktop').pattern, 'modal');
  assert.equal(overlayPattern('destructive', 'desktop').destructive, true);
  assert.equal(overlayPattern('auxiliary', 'desktop').pattern, 'drawer');
  assert.equal(overlayPattern('reading', 'desktop').pattern, 'drawer');
  assert.equal(overlayPattern('choice', 'mobile').pattern, 'sheet');
  assert.equal(overlayPattern('confirm', 'mobile').pattern, 'sheet');
  assert.equal(overlayPattern('reading', 'mobile').pattern, 'full-sheet');
  const toast = overlayPattern('success', 'mobile');
  assert.equal(toast.pattern, 'toast');
  assert.ok(toast.durationMs >= 1500 && toast.durationMs <= 2000);
  const publish = fixture('草稿', {
    viewport: 'desktop',
    overlayIntent: 'confirm',
    draft: {status: 'confirmed', statements: [{id: '1', text: '原文', visibility: 'public'}]},
    savedStatements: JSON.stringify([{id: '1', text: '原文', visibility: 'public'}]),
  });
  assert.equal(publish.overlay.pattern, 'modal');
  const mobileConfirm = fixture('草稿', {viewport: 'mobile', overlayIntent: 'confirm'});
  assert.equal(mobileConfirm.overlay.pattern, 'sheet');
});

test('region visibility is derived from the same helpers the pages render', () => {
  const emptyDiscover = fixture('发现', {items: []});
  assert.equal(emptyDiscover.empty.kind, 'discover_empty');
  assert.equal(emptyDiscover.regionIds.includes('feed'), false);
  assert.ok(emptyDiscover.regionIds.includes('empty-discover_empty'));
  assert.ok(emptyDiscover.regionIds.includes('hero'));
  const filled = fixture('发现', {items: [{source_id: 's'}]});
  assert.ok(filled.regionIds.includes('feed'));
  assert.equal(filled.regionIds.includes('empty-discover_empty'), false);
  assert.equal(filled.regionIds.includes('workbench-tabs'), false);
  const ids = visibleRegions({page: '发现', items: []}).map((region) => region.id);
  assert.deepEqual(emptyDiscover.regionIds, ids);

  const items = [
    {id: 'a', status: 'eligible'},
    {id: 'b', status: 'accepted', interview_id: 'i1'},
    {id: 'c', status: 'published', draft_id: 'd1'},
  ];
  const tabs = workbenchTabs(items);
  assert.deepEqual(tabs.map((tab) => tab.label), ['等我回应', '正在写', '已发布']);
  assert.equal(tabs[0].items[0].id, 'a');
  assert.equal(tabs[1].items[0].id, 'b');
  assert.equal(tabs[2].items[0].id, 'c');
  assert.equal(workbenchDefaultTab(items), 'waiting');
  assert.equal(workbenchDefaultTab(items.filter((item) => item.id !== 'a')), 'writing');
  const workbench = fixture('作者工作台', {items});
  assert.ok(workbench.regionIds.includes('workbench-tabs'));
  assert.deepEqual(workbench.workbenchTabs.map((tab) => tab.label), ['等我回应', '正在写', '已发布']);
  assert.deepEqual(workbench.workbenchTabs, tabs);
  const emptyWorkbench = fixture('作者工作台', {items: []});
  assert.ok(emptyWorkbench.regionIds.includes('workbench-tabs'));
  assert.equal(emptyWorkbench.regionIds.includes('workbench-list'), false);

  const blocks = sectionBlocks([
    {id: 't', section: 'then', text: '当时'},
    {id: 'l', section: 'later', text: '后来'},
    {id: 'r', section: 'reflection', text: '现在回看'},
  ]);
  assert.deepEqual(blocks.map((block) => block.label), ['当时', '后来', '现在回看']);
  assert.equal(interviewProgress({questionsAsked: 2}).label, '第 2 / 5');
});

test('interview and draft CTAs stay gated by the shipped workflow helpers', () => {
  const paused = {status: 'paused', mode: 'ai', questionsAsked: 1};
  const pausedView = actionsFor({page: '采访', session: paused, messages: [{role: 'ai'}]});
  assert.equal(pausedView.find((cta) => cta.action === 'saveAnswer').enabled, interviewActions(paused, [{role: 'ai'}]).answer);
  assert.equal(pausedView.find((cta) => cta.action === 'resumeInterview').enabled, true);
  const longText = '后来这段经历值得被认真写下，把当时的选择和现在的结果讲清楚。'.repeat(4);
  const dirtyDraft = {status: 'confirmed', statements: [{id: '1', text: longText + '改', visibility: 'public'}]};
  const original = JSON.stringify([{id: '1', text: longText, visibility: 'public'}]);
  const dirty = actionsFor({page: '草稿', draft: dirtyDraft, savedStatements: original});
  const expected = draftActions(dirtyDraft, original);
  assert.equal(dirty.find((cta) => cta.action === 'publishDraft').enabled, expected.publish);
  assert.equal(dirty.find((cta) => cta.action === 'saveDraft').enabled, expected.save);
});
