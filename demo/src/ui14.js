// UI_14 screen contract. Presentation reads this; tests drive these functions
// with the same API-shaped fixtures the pages receive. Live numbers stay
// absent unless the payload actually supplies them.
import {draftActions, interviewActions} from './workflow.js';
import {articleLength} from './article-format.js';

export const TOKENS = {
  brand: '然后呢？',
  brandEn: 'And Then?',
  primary: '#2563FF',
  secondary: '#60A5FA',
  light: '#DBEAFE',
  text: '#111827',
  textSecondary: '#374151',
  textMuted: '#6B7280',
  border: '#D1D5DB',
  canvas: '#F9FAFB',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  space: [4, 8, 12, 16, 24, 32, 48, 64],
  toastMs: {min: 1500, max: 2000, default: 1750},
};

export const COPY = {
  then: '然后呢？',
  writeLater: '写下后来',
  followLater: '关注后续',
  willing: '愿意讲讲后来吗？',
  saveContinue: '保存并继续',
  skipQuestion: '跳过这个问题',
  confirmPublish: '确认发布这则后来',
  sections: ['当时', '后来', '现在回看'],
  search: '搜索关键词、问题或粘贴知乎链接',
  heroTitle: '故事还在继续。',
  heroBody: '看见一段过去的经历时，有时候我们真正想问的是：然后呢？',
  pasteLink: '粘贴知乎链接，直接查看',
  confirmPublishQuestion: '确认发布这则后来？',
  pauseInterview: '暂停采访',
  resumeInterview: '继续采访',
  finishInterview: '结束采访',
};

export const DESKTOP_NAV = ['发现', '我的关注', '写下后来'];
export const MOBILE_NAV = [
  {page: '发现', label: '发现', icon: 'home'},
  {page: '我的关注', label: '关注', icon: 'heart'},
  {page: '作者工作台', label: '写下后来', icon: 'plus'},
  {page: '通知', label: '后来', icon: 'later'},
  {page: '账号', label: '我的', icon: 'me'},
];

export const INTEREST_CHOICES = [
  ['outcome', '现在的结果与变化'],
  ['journey', '过程中的转折与经历'],
  ['reflection', '回头看的感受与建议'],
  ['other', '其他，我想补充'],
];

export const PAGE_SCREEN = {
  发现: '01',
  内容: '02',
  我的关注: '03',
  通知: '04',
  作者工作台: '05',
  采访: '06',
  草稿: '07',
  更新: '08',
  账号: '09',
  资料与记忆: '09',
  回访管理: '10',
  官方数据: '10',
  回访: '11',
  导入: '12',
  提交资料: '12',
};

export const SCREEN_REGIONS = {
  '01': ['chrome-header', 'hero', 'search', 'import-link', 'category-tabs', 'feed', 'about', 'mobile-tabbar'],
  '02': ['chrome-header', 'story-title', 'story-body', 'interest-panel', 'reason-picker', 'story-meta', 'mobile-tabbar'],
  '03': ['chrome-header', 'following-tabs', 'following-list', 'following-aside', 'mobile-tabbar'],
  '04': ['chrome-header', 'notice-tabs', 'notice-list', 'notice-aside', 'mobile-tabbar'],
  '05': ['chrome-header', 'workbench-hero', 'workbench-tabs', 'workbench-list', 'workbench-aside', 'mobile-tabbar'],
  '06': ['chrome-header', 'interview-progress', 'interview-question', 'interview-composer', 'interview-aside'],
  '07': ['chrome-header', 'draft-sections', 'draft-preview', 'publish-options'],
  '08': ['chrome-header', 'followup-hero', 'section-then', 'section-later', 'section-reflection', 'followup-aside'],
  '09': ['chrome-header', 'zhihu-account', 'author-identity', 'memory', 'consents', 'privacy'],
  '10': ['chrome-header', 'admin-nav', 'source-table', 'research-panel'],
  '11': ['chrome-header', 'invite-card', 'invite-privacy', 'invite-actions'],
  '12': ['chrome-header', 'import-form', 'import-preview', 'verify-status'],
  '13': ['empty-following', 'empty-waiting', 'empty-later', 'empty-declined', 'empty-withdrawn', 'empty-timeout', 'empty-notice'],
  '14': ['overlay-modal', 'overlay-drawer', 'overlay-sheet', 'overlay-full-sheet', 'overlay-toast'],
  '15': ['token-primary', 'token-secondary', 'token-light', 'btn-primary', 'btn-secondary', 'btn-ghost', 'btn-disabled'],
};

export const EMPTY_STATES = {
  following_empty: {
    kind: 'following_empty',
    title: '还没有关注任何后续',
    body: '在这里关注你感兴趣的故事。当有人回来更新时，你会第一时间收到通知。',
    cta: '去发现更多故事',
    ctaPage: '发现',
    illustration: '/empty/following.png',
  },
  waiting_author: {
    kind: 'waiting_author',
    title: '等待作者回应',
    body: '你已向作者发送了回访问题，作者正在思考中，可能需要一些时间。',
    cta: '查看问题',
    illustration: '/empty/waiting.png',
  },
  later_ready: {
    kind: 'later_ready',
    title: '已有后来更新',
    body: '作者发布了新的后来，快去看看吧！时间在流动，故事仍在继续。',
    cta: '阅读最新内容',
  },
  author_declined: {
    kind: 'author_declined',
    title: '作者暂不参与',
    body: '作者目前选择暂不参与后续回访。感谢你的关注，或许未来会有新的可能。',
    cta: '去发现其他故事',
    ctaPage: '发现',
  },
  withdrawn: {
    kind: 'withdrawn',
    title: '内容已撤回',
    body: '该内容已被作者撤回，或因其他原因暂时无法查看。感谢你的理解。',
    cta: '返回上一页',
  },
  timeout: {
    kind: 'timeout',
    title: 'AI 回访暂时超时',
    body: '本次 AI 回访处理时间较长，可能是网络波动。请稍后重试，或尝试调整问题后再次发送。',
    cta: '重新尝试',
    secondaryCta: '调整问题',
  },
  no_notifications: {
    kind: 'no_notifications',
    title: '暂无通知',
    body: '当有人回应、发布新的后来或有重要更新时，你会在这里收到通知。',
    cta: '去发现故事',
    ctaPage: '发现',
    illustration: '/empty/notifications.png',
  },
  discover_empty: {
    kind: 'discover_empty',
    title: '暂时还没有可阅读的故事',
    body: '浏览本站内容，或搜索、粘贴知乎链接，发现值得回访的经历。',
    cta: '去搜索知乎',
    ctaPage: '发现',
  },
  workbench_empty: {
    kind: 'workbench_empty',
    title: '暂无可处理的回访',
    body: '完成身份与内容核验后，回访会显示在这里。',
    cta: '去发现故事',
    ctaPage: '发现',
    illustration: '/empty/waiting.png',
  },
  loading: {
    kind: 'loading',
    title: '处理中…',
    body: '正在读取当前页面，请稍候。',
  },
};

const TIMEOUT_REASONS = new Set(['timeout', 'model_timeout', 'ai_timeout']);

export function overlayPattern(intent, viewport = 'desktop') {
  if (intent === 'success') {
    return {pattern: 'toast', durationMs: TOKENS.toastMs.default, backdrop: false};
  }
  const desktop = viewport !== 'mobile';
  if (desktop) {
    if (intent === 'confirm' || intent === 'destructive') {
      return {pattern: 'modal', backdrop: '40-60', destructive: intent === 'destructive'};
    }
    if (intent === 'auxiliary' || intent === 'reading') {
      return {pattern: 'drawer', backdrop: '40-60'};
    }
    return {pattern: 'modal', backdrop: '40-60'};
  }
  if (intent === 'reading') return {pattern: 'full-sheet', backdrop: '40-60'};
  return {pattern: 'sheet', backdrop: '40-60', destructive: intent === 'destructive'};
}

export function emptyState(kind) {
  if (!kind) return null;
  return EMPTY_STATES[kind] || null;
}

export function errorStatusOf(error) {
  if (!error) return 0;
  if (typeof error === 'number') return error;
  if (error.status) return error.status;
  const text = String(error.message || error);
  if (text.includes('410') || text.includes('已撤回')) return 410;
  return 0;
}

export function emptyKindFor(state = {}) {
  const status = errorStatusOf(state.error);
  if (status === 410) return 'withdrawn';
  if (state.busy && !(state.items || []).length && !state.story && !state.session && !state.draft && !state.followup) {
    return 'loading';
  }
  if (state.page === '采访' && TIMEOUT_REASONS.has(state.session?.stopReason)) return 'timeout';
  if (state.page === '更新' && (status === 410 || state.followup?.status === 'withdrawn' || state.draft?.status === 'withdrawn')) {
    return 'withdrawn';
  }
  if (state.page === '内容' && (state.story?.author_declined || state.story?.case_status === 'declined')) {
    return 'author_declined';
  }
  if (state.busy) return null;
  const items = state.items || [];
  if (state.page === '发现' && items.length === 0) return 'discover_empty';
  if (state.page === '我的关注' && items.length === 0) return 'following_empty';
  if (state.page === '通知' && (state.notifications || items).length === 0) return 'no_notifications';
  if (state.page === '作者工作台' && items.length === 0) return 'workbench_empty';
  return null;
}

export function sectionBlocks(statements = []) {
  const groups = {then: [], later: [], reflection: [], unset: []};
  for (const statement of statements) {
    if (statement.section === 'then') groups.then.push(statement);
    else if (statement.section === 'later') groups.later.push(statement);
    else if (statement.section === 'reflection') groups.reflection.push(statement);
    else groups.unset.push(statement);
  }
  return [
    {key: 'then', label: '当时', items: groups.then},
    {key: 'later', label: '后来', items: [...groups.later, ...groups.unset]},
    {key: 'reflection', label: '现在回看', items: groups.reflection},
  ];
}

export function coverStyle(seed = '') {
  const palettes = [
    ['#1e3a8a', '#60A5FA'],
    ['#0f172a', '#2563FF'],
    ['#1d4ed8', '#93C5FD'],
    ['#1e40af', '#DBEAFE'],
  ];
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [from, to] = palettes[hash % palettes.length];
  return {background: `linear-gradient(160deg, ${from} 0%, ${to} 100%)`};
}

export function liveCount(value) {
  if (value === 0) return '0';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function storyTitle(item) {
  return item?.title || '尚未命名的故事';
}

export function isFixture(item) {
  return item?.provenance === 'test_fixture';
}

function cta(id, label, enabled, action, extra = {}) {
  return {id, label, enabled: !!enabled, action, ...extra};
}

export function actionsFor(state = {}) {
  const {page, session, messages = [], draft, savedStatements, answer} = state;
  if (page === '发现' || page === '内容') {
    return [
      cta('then', COPY.then, true, 'interest'),
      cta('follow', COPY.followLater, true, 'interest'),
    ];
  }
  if (page === '作者工作台' || page === '回访') {
    return [
      cta('willing', COPY.willing, true, 'openInvite'),
      cta('accept', '开始回访', true, 'acceptInvite'),
      cta('decline', '暂不参与', true, 'declineInvite'),
    ];
  }
  if (page === '采访') {
    const interview = interviewActions(session, messages);
    return [
      cta('save', COPY.saveContinue, interview.answer && !!answer, 'saveAnswer'),
      cta('skip', COPY.skipQuestion, interview.answer, 'skipQuestion'),
      cta('pause', COPY.pauseInterview, interview.pause, 'pauseInterview'),
      cta('resume', COPY.resumeInterview, interview.resume, 'resumeInterview'),
      cta('finish', COPY.finishInterview, interview.finish, 'finishInterview'),
      cta('retry', '重试 AI 提问', interview.retry, 'retryInterview'),
    ];
  }
  if (page === '草稿') {
    const draftState = draftActions(draft, savedStatements);
    const tooShort = articleLength(draft?.statements) < 100;
    return [
      cta('save-draft', '保存修改', draftState.save, 'saveDraft'),
      cta('confirm-draft', '确认全部内容', draftState.confirm && !tooShort, 'confirmDraft'),
      cta('publish', COPY.confirmPublish, draftState.publish && !tooShort, 'publishDraft', {overlay: 'confirm'}),
      cta('withdraw', '撤回发布', draftState.withdraw, 'withdrawFollowup', {overlay: 'destructive'}),
    ];
  }
  if (page === '导入' || page === '提交资料') {
    return [cta('import', '导入并核验', true, 'importSource')];
  }
  return [];
}

export function interviewProgress(session) {
  const total = Math.min(session?.budgetMainQuestions ?? 5, 5);
  const current = Math.min(session?.questionsAsked || 0, total);
  return {current, total, label: `第 ${Math.max(current, 1)} / ${total}`};
}

export const WORKBENCH_TABS = [
  {id: 'waiting', label: '等我回应'},
  {id: 'writing', label: '正在写'},
  {id: 'published', label: '已发布'},
];

export function workbenchBucket(item = {}) {
  if (item.status === 'published' || item.followup_status === 'published' || item.draft_status === 'published') return 'published';
  if (item.interview_id || item.draft_id || ['accepted', 'interviewing', 'in_progress', 'active'].includes(item.status)) return 'writing';
  return 'waiting';
}

export function workbenchTabs(items = []) {
  const buckets = {waiting: [], writing: [], published: []};
  for (const item of items) buckets[workbenchBucket(item)].push(item);
  return WORKBENCH_TABS.map((tab) => ({...tab, items: buckets[tab.id], count: buckets[tab.id].length}));
}

export function workbenchDefaultTab(items = []) {
  return workbenchTabs(items).find((tab) => tab.count)?.id || 'waiting';
}

function addRegion(ids, id, on = true) {
  if (on && id) ids.push(id);
}

export function visibleRegions(state = {}) {
  const page = state.page || '发现';
  const viewport = state.viewport === 'mobile' ? 'mobile' : 'desktop';
  const screenId = PAGE_SCREEN[page] || '01';
  const kind = emptyKindFor(state);
  const items = state.items || [];
  const notices = state.notifications || [];
  const ids = [];
  addRegion(ids, 'chrome-header');
  addRegion(ids, 'mobile-tabbar');
  if (screenId === '01') {
    addRegion(ids, 'hero');
    addRegion(ids, 'search');
    addRegion(ids, 'import-link');
    addRegion(ids, 'category-tabs');
    addRegion(ids, 'feed', items.length > 0);
    addRegion(ids, 'about', viewport === 'desktop');
  } else if (screenId === '02') {
    addRegion(ids, 'story-title', !!state.story);
    addRegion(ids, 'story-body', !!state.story);
    addRegion(ids, 'interest-panel', !!state.story);
    addRegion(ids, 'reason-picker', !!state.story);
    addRegion(ids, 'story-meta', !!state.story);
  } else if (screenId === '03') {
    addRegion(ids, 'following-tabs');
    addRegion(ids, 'following-list', items.length > 0);
    addRegion(ids, 'following-aside', viewport === 'desktop');
  } else if (screenId === '04') {
    addRegion(ids, 'notice-tabs');
    addRegion(ids, 'notice-list', notices.length > 0 || items.length > 0);
    addRegion(ids, 'notice-aside', viewport === 'desktop');
  } else if (screenId === '05') {
    addRegion(ids, 'workbench-hero');
    addRegion(ids, 'workbench-tabs');
    addRegion(ids, 'workbench-list', items.length > 0);
    addRegion(ids, 'workbench-aside', viewport === 'desktop');
  } else if (screenId === '06') {
    addRegion(ids, 'interview-progress', !!state.session);
    addRegion(ids, 'interview-question', !!state.session);
    addRegion(ids, 'interview-composer', !!state.session);
    addRegion(ids, 'interview-aside', viewport === 'desktop' && !!state.session);
  } else if (screenId === '07') {
    addRegion(ids, 'draft-sections', !!state.draft);
    addRegion(ids, 'draft-preview', !!state.draft);
    addRegion(ids, 'publish-options', !!state.draft);
  } else if (screenId === '08') {
    const open = !!state.followup && kind !== 'withdrawn';
    addRegion(ids, 'followup-hero', open);
    addRegion(ids, 'section-then', open);
    addRegion(ids, 'section-later', open);
    addRegion(ids, 'section-reflection', open);
    addRegion(ids, 'followup-aside', open && viewport === 'desktop');
  } else if (screenId === '09') {
    addRegion(ids, 'zhihu-account');
    addRegion(ids, 'author-identity');
    addRegion(ids, 'memory');
    addRegion(ids, 'consents');
    addRegion(ids, 'privacy');
  } else if (screenId === '10') {
    addRegion(ids, 'admin-nav');
    addRegion(ids, 'source-table');
    addRegion(ids, 'research-panel', state.user?.role === 'admin' || page === '官方数据');
  } else if (screenId === '11') {
    addRegion(ids, 'invite-card');
    addRegion(ids, 'invite-privacy');
    addRegion(ids, 'invite-actions');
  } else if (screenId === '12') {
    addRegion(ids, 'import-form');
    addRegion(ids, 'import-preview');
    addRegion(ids, 'verify-status');
  }
  if (kind) addRegion(ids, `empty-${kind}`);
  if (state.busy) addRegion(ids, 'loading');
  return ids.map((id) => ({id, visible: true}));
}

export function mapScreen(state = {}) {
  const page = state.page || '发现';
  const viewport = state.viewport === 'mobile' ? 'mobile' : 'desktop';
  const screenId = PAGE_SCREEN[page] || '01';
  const kind = emptyKindFor(state);
  const empty = emptyState(kind);
  const overlayIntent = state.overlayIntent;
  const overlay = overlayIntent ? overlayPattern(overlayIntent, viewport) : null;
  const regions = visibleRegions(state);
  const notifications = state.notifications || [];
  return {
    screenId,
    page,
    viewport,
    brand: TOKENS.brand,
    regions,
    regionIds: regions.map((region) => region.id),
    ctas: actionsFor(state),
    empty,
    overlay,
    chrome: {
      desktopNav: DESKTOP_NAV,
      mobileNav: MOBILE_NAV,
      searchPlaceholder: COPY.search,
      bellBadge: notifications.length,
      avatar: state.user?.display_name || '',
    },
    loading: !!state.busy,
    interview: page === '采访' ? interviewProgress(state.session) : null,
    workbenchTabs: page === '作者工作台' ? workbenchTabs(state.items || []) : null,
    sections: page === '草稿' || page === '更新' || page === '内容'
      ? sectionBlocks(state.draft?.statements || state.followup?.statements || state.story?.published_followup?.statements || [])
      : null,
    fixtureOnly: isFixture(state.story || state.items?.[0]),
  };
}

export function navPage(label) {
  if (label === '关注') return '我的关注';
  if (label === '写下后来') return '作者工作台';
  if (label === '后来') return '通知';
  if (label === '我的') return '账号';
  return label;
}
