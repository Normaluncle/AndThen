// The "continue as a real reader" entry, kept in one testable place.
//
// Establishing the reader session is only the pre-step that lets the server
// start a Zhihu authorization (`POST /auth/zhihu/start` requires an
// authenticated caller). The identity the reader ends up with after the
// callback is the Zhihu-bound account, never an anonymous guest — so this
// sequence must always end in a redirect to the authorization page, and must
// never silently degrade into "guest only".
export const READER_CONSENT_VERSION = 'reader-v1';

/**
 * The panel offers demo accounts only when the server says they exist
 * (`GET /auth/demo/status`). Production runs with them switched off, so the
 * tab list differs between environments even though the code is identical.
 */
export function sessionTabs(demo) {
  return demo ? ['真实使用', '体验演示'] : ['真实使用', '开发者'];
}

/**
 * The demo accounts exist for reviewers, so the panel only offers the tab on the judge link
 * (`?judge=1`). An ordinary visitor never sees it, even on a deployment where the server has
 * demo logins switched on. `?judge=0` (or false/no/off) keeps them hidden.
 */
export function judgeEntry(search = '') {
  // Tolerates a non-string (e.g. `routes.map(routeUrl)` passes the index as the second argument).
  const text = typeof search === 'string' ? search : '';
  const params = new URLSearchParams(text.startsWith('?') ? text : `?${text}`);
  if (!params.has('judge')) return false;
  return !['0', 'false', 'no', 'off'].includes((params.get('judge') ?? '').trim().toLowerCase());
}

/**
 * The developer tab is only ever rendered when demo accounts are unavailable.
 * Its copy used to send people to "「体验演示」里的管理员按钮" — a tab that is
 * not on screen in exactly that case, which is what made the deployed panel
 * show instructions with no button to follow.
 */
export const DEVELOPER_TAB_COPY = '请使用管理员发放的一次性登录凭证。普通读者请用「真实使用」以知乎账号继续。';

async function openReaderSession(request, onReader) {
  const reader = await request('/auth/readers', 'POST', {
    consent: { accepted: true, version: READER_CONSENT_VERSION },
  });
  onReader(reader);
  return reader;
}

export async function continueAsRealReader(request, { onReader, assign }) {
  const reader = await openReaderSession(request, onReader);
  const started = await request('/auth/zhihu/start', 'POST', {});
  const url = started?.authorization_url;
  if (typeof url !== 'string' || !url) throw new Error('服务器没有返回知乎授权地址，请稍后重试。');
  assign(url);
  return { ...reader, authorization_url: url };
}

/** Explicit opt-out for people who have no Zhihu account to authorize. */
export async function continueAsGuest(request, { onReader }) {
  return openReaderSession(request, onReader);
}
