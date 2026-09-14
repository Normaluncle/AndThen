import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {followReasonLabels, publishBackTarget, publishChrome, playgroundResetAllowed} from './publish-chrome.js';

test('story follow chrome always exposes the four reason labels', () => {
  assert.deepEqual(followReasonLabels(), [
    '现在的结果与变化',
    '过程中的转折与经历',
    '回头看的感受与建议',
    '其他，我想补充',
  ]);
});

test('live publish returns to the interview when the draft still has one', () => {
  assert.deepEqual(publishBackTarget({interviewId: 'int-1'}), {screen: '06', interview: 'int-1'});
  assert.deepEqual(publishBackTarget({interview_id: 'int-2'}), {screen: '06', interview: 'int-2'});
  assert.deepEqual(publishBackTarget({}), {screen: '05'});
  assert.equal(publishChrome({interviewId: 'int-1'}).nativeSelect, false);
  assert.ok(publishChrome({}).rail.includes('事实由作者确认'));
});

test('the live 07 page does not render a native select for section or visibility', () => {
  const source = readFileSync(new URL('./screens.jsx', import.meta.url), 'utf8');
  const draftFn = source.slice(source.indexOf('export function DraftPage'), source.indexOf('export function AccountPage'));
  assert.equal(/<select[\s>]/.test(draftFn), false);
  assert.match(draftFn, /返回编辑/);
  assert.match(draftFn, /事实由作者确认/);
  assert.match(draftFn, /data-region="publish-options"/);
});

test('playground reset is allowed for guests and local demo fixtures only', () => {
  assert.equal(playgroundResetAllowed(null), true);
  assert.equal(playgroundResetAllowed({cohort: 'local_demo_fixture'}), true);
  assert.equal(playgroundResetAllowed({cohort: 'anonymous_reader'}), false);
  assert.equal(playgroundResetAllowed({cohort: 'team', role: 'admin'}), false);
});

test('quote illustration is the committed ChatGPT asset served from demo public', () => {
  const root = fileURLToPath(new URL('../../ChatGPT Image 2026年9月14日 10_35_01.png', import.meta.url));
  const served = fileURLToPath(new URL('../public/home/quote-bear.png', import.meta.url));
  assert.equal(existsSync(root), true);
  assert.equal(existsSync(served), true);
  const home = readFileSync(new URL('./Home.jsx', import.meta.url), 'utf8');
  assert.match(home, /\/home\/quote-bear\.png/);
});
