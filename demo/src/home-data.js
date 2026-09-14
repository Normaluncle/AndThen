// UI_14 design examples, never persisted or sent to a business endpoint.
export const homeStories = [
  {id: 'design-career', provenance: 'test_fixture', category: '职场发展', date: '2021-06-12', cover_caption:'2021.06 我选择了出发', title: '辞职去做自己真正喜欢的事情，值得吗？', text: '我在大厂工作了五年，收入稳定，但是觉得自己像一颗螺丝钉。\n上周我提交了辞职申请，准备给自己半年的时间，去做一直想做的独立开发。\n虽然不知道未来会怎样，但我想试一次。', counts: ['1.2 万', '892', '1,503'], crop: [63, 488, 168, 133]},
  {id: 'design-study', provenance: 'test_fixture', category: '学习成长', date: '2020-09-03', cover_caption:'2020.09 开始备考', title: '从双非到顶尖高校读研，我踩过哪些坑？', text: '本科是普通院校，但我一直不甘心。这里记录一下我准备考研的全过程，\n包括资料、时间安排、心态调整……\n希望能给同样在努力的同学一些参考。', counts: ['8,432', '412', '976'], crop: [63, 660, 168, 133]},
  {id: 'design-relationship', provenance: 'test_fixture', category: '情感关系', date: '2022-01-17', cover_caption:'2022.01 重新出发', title: '和相恋 8 年的 TA 分手后，我是如何走出来的？', text: '我们从大学到工作，一起走过了 8 年。\n但最终还是因为现实的原因分开了。\n这段时间我一直在调整自己，记录一些想法。', counts: ['6,201', '389', '643'], crop: [63, 829, 168, 132]},
];

export function filterHomeStories(items, category, query = '') {
  const words = query.trim().toLocaleLowerCase();
  return items.filter(item => (category === '为你推荐' || category === '全部' || item.category === category)
    && (!words || `${item.title} ${item.text}`.toLocaleLowerCase().includes(words)));
}

/**
 * The date a story may honestly be filtered and displayed by, plus where that date
 * came from. The chain is: upstream publish date, else upstream update date, else
 * when we captured it. The last one always exists, so a story is never dateless and
 * no date ever has to be invented — but the basis is returned so the card can say
 * which one it is showing instead of calling every date "发布于".
 */
export function storyTime(item) {
  if (item?.date) return {date: String(item.date).slice(0, 10), basis: 'published'};
  if (item?.published_at) return {date: item.published_at.slice(0, 10), basis: 'published'};
  if (item?.upstream_updated_at) return {date: item.upstream_updated_at.slice(0, 10), basis: 'updated'};
  if (item?.acquired_at) return {date: item.acquired_at.slice(0, 10), basis: 'acquired'};
  return {date: null, basis: null};
}

const TIME_BASIS_SUFFIX = {published: '', updated: ' 更新', acquired: ' 收录'};

export function storyTimeText(item) {
  const {date, basis} = storyTime(item);
  return date ? date + (TIME_BASIS_SUFFIX[basis] ?? '') : null;
}

/**
 * A date range only ever excludes a story whose date is known. The chain above
 * always resolves for anything the API returns, so this is a safety net rather
 * than the normal path — it used to be the reason one filled-in field emptied the
 * whole feed.
 */
export function filterByDateRange(items, filters = {}) {
  if (!filters.from && !filters.to) return items;
  return items.filter(item => {
    const {date} = storyTime(item);
    return !date || ((!filters.from || date >= filters.from) && (!filters.to || date <= filters.to));
  });
}

/**
 * The numbers under a card, kept as two distinct sets on purpose:
 *  - 热度 is the platform's own engagement, computed from the official response.
 *  - 点赞 / 评论 / 收藏 are this site's counters.
 * They measure different things, so folding them into one row of identical icons
 * would pass Zhihu's popularity off as ours. `title` on each entry names it.
 */
export function cardCounts(item, {interaction, preview} = {}) {
  const rows = [];
  if (typeof item?.heat === 'number') rows.push({icon: 'flame', label: '热度（知乎官方互动）', value: item.heat});
  const site = preview && interaction
    ? [interaction.likes || 0, interaction.comments || 0, interaction.saves || 0]
    : Array.isArray(item?.site_counts) ? item.site_counts : [0, 0, 0];
  rows.push(...site.slice(0, 3).map((value, index) => ({
    icon: ['like', 'comment', 'star'][index], label: ['本站点赞', '本站评论', '本站收藏'][index], value,
  })));
  return rows;
}

export function homeAction(item) {
  if (item.provenance === 'test_fixture' && item.id?.startsWith('design-')) return 'preview';
  if (item.source_id || item.linked_source_id) return 'open';
  if (item.candidate_id) return 'interest';
  return 'import';
}

export function rememberCandidate(item) {
  if (!item?.candidate_id || typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem('andthen.candidate.' + item.candidate_id, JSON.stringify({
    candidate_id: item.candidate_id,
    title: item.title,
    text: item.text,
    author_name: item.author_name,
    url: item.url,
    published_at: item.published_at,
    category: item.category,
  }));
}

export function readCandidate(id) {
  try { return JSON.parse(sessionStorage.getItem('andthen.candidate.' + id) || 'null'); }
  catch { return null; }
}

export function homeDestination(item, navigate) {
  const action = homeAction(item);
  if (action === 'preview') navigate('02', {story: String(item.id || '').replace(/^design-/, '')});
  else if (action === 'open') navigate('02', {source: item.source_id || item.linked_source_id});
  else if (action === 'interest') { rememberCandidate(item); navigate('02', {candidate: item.candidate_id}); }
  else if (action === 'import') navigate('12');
  return action;
}
