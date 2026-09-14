// Screen 12 keeps its design layout; only the content is mapped from real
// responses. Nothing here invents a value the server did not return.

/** `published_at`/`upstream_updated_at` arrive as ISO strings; render the day. */
export function displayDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function latestSnapshot(snapshots) {
  return [...(snapshots || [])].sort((a, b) => (b?.version || 0) - (a?.version || 0))[0] || null;
}

/**
 * The official search payload has an edit time, not a publication date, so a
 * missing publish date is reported as missing — never filled with the edit time.
 */
export function publishedLabel(snapshot) {
  const published = displayDate(snapshot?.published_at);
  if (published) return published;
  const updated = displayDate(snapshot?.upstream_updated_at);
  return updated ? `未提供（官方摘要更新于 ${updated}）` : '未提供';
}

const SOURCE_LABELS = {
  third_party_link: '知乎公开回答',
  author_paste: '作者本人提供',
  official_search: '知乎官方检索',
  researcher_import: '研究材料',
};

export function importPreview({ source, snapshot, candidate } = {}) {
  return {
    title: source?.title || candidate?.title || '官方渠道暂未提供标题',
    text: snapshot?.body || snapshot?.excerpt || candidate?.text || '官方渠道暂未取得正文。补充原文后可以继续。',
    sourceLabel: SOURCE_LABELS[source?.source_type] || '来源待核验',
    publishedLabel: publishedLabel(snapshot),
    authorName: candidate?.author_name || '知乎用户',
    authorAvatar: candidate?.author_avatar || null,
    authorNote: '来自知乎官方公开信息',
    originalUrl: source?.original_url || null,
  };
}

/** True when the official adapter actually returned content for this link. */
export function summaryImported({ source, snapshot } = {}) {
  return Boolean(source?.title || snapshot?.body);
}

/** `verified` | `claimed` (own pending declaration) | `other` | `none`. */
export function claimState({ verifications, userId } = {}) {
  const rows = verifications || [];
  const own = rows.filter((row) => row.user_id === userId);
  if (own.some((row) => row.status === 'verified')) return 'verified';
  if (rows.some((row) => row.status === 'verified')) return 'other';
  if (own.some((row) => row.method === 'self_claim')) return 'claimed';
  return 'none';
}

/**
 * The three rows of 「来源核验状态」. Tone and icon stay bound to the row index
 * exactly as the design has them; only the copy and the offered action change.
 */
export function verificationSteps({ source, snapshot, verifications, userId } = {}) {
  const state = claimState({ verifications, userId });
  const excerpt = snapshot?.excerpt || '';
  return [
    summaryImported({ source, snapshot })
      ? { tone: 'green', title: '官方摘要已导入', desc: '已从知乎官方 API 获取标题、摘要等基础信息。', action: null }
      : { tone: 'orange', title: '官方摘要待补全', desc: '官方渠道暂未返回这篇内容的标题与摘要，补充原文后可以继续。', action: null },
    excerpt
      ? { tone: 'orange', title: '原文片段已补充', desc: '已补充原文片段，可继续生成回访。', action: null }
      : { tone: 'orange', title: '原文片段待补充', desc: '当前暂无原回答正文。补充后可获得更深入、更贴近你原意的后续访谈。', action: '去粘贴原文' },
    state === 'verified'
      ? { tone: 'gray', title: '作者身份已确认', desc: '已通过知乎授权或人工核验确认这是你的回答。', action: null }
      : state === 'other'
        ? { tone: 'gray', title: '这则回答已归属其他作者', desc: '本页只登记链接，不会替其他作者创建后续。', action: null }
        : state === 'claimed'
          ? { tone: 'gray', title: '作者身份已声明，等待核验', desc: '已记录你的本人声明。核验通过前可以继续创作，但不会公开展示。', action: null }
          : { tone: 'gray', title: '作者身份待确认', desc: '我们将基于公开信息进行匹配。请确认是否为你本人的回答，以确保后续内容的准确性。', action: '确认这是我的回答' },
  ];
}

/** Client-side guard only; the server rejects a claim without material too. */
export function claimError(excerpt) {
  return (excerpt || '').trim() ? '' : '请先粘贴原回答的正文，再确认这是你的回答。';
}

/** What the page says after 「导入并核验」. */
export function resolveNotice(result) {
  if (!result) return '';
  return result.status === 'pending_content'
    ? '已登记链接，官方渠道暂未取得正文。可以补充原文继续。'
    : '已取得官方摘要，等待你核验来源边界。';
}

/** What the page says after a successful claim. */
export function claimNotice(analysisStatus) {
  if (analysisStatus === 'queued') return '已记录本人声明，AI 正在核验这段材料的可回访性。';
  if (analysisStatus === 'awaiting_model_consent') return '已记录本人声明。同意模型处理后，AI 会开始核验这段材料。';
  if (analysisStatus === 'model_unconfigured') return '已记录本人声明。模型尚未配置，稍后可再试。';
  return '已记录本人声明。核验通过前不会公开展示。';
}

/**
 * What a signed-in visitor sees before importing anything. Same three rows, but
 * no invented story and no invented date: the design's sample content is only
 * ever shown to an anonymous visitor as a labelled concept.
 */
export const emptyPreview = {
  title: '还没有导入链接',
  text: '粘贴知乎的问题或回答链接后，这里会显示官方渠道取得的标题与摘要。',
  sourceLabel: '待核验',
  publishedLabel: '未取得',
  authorName: '—',
  authorNote: '尚未取得官方公开信息',
  originalUrl: null,
};

export function emptySteps() {
  return [
    { tone: 'orange', title: '尚未导入链接', desc: '粘贴知乎链接并核验后，这里会显示官方渠道取得的信息。', action: null },
    { tone: 'orange', title: '原文片段待补充', desc: '导入链接后可以补充原回答正文，获得更贴近你原意的后续访谈。', action: null },
    { tone: 'gray', title: '作者身份待确认', desc: '导入链接并确认这是你的回答后，这里会显示核验状态。', action: null },
  ];
}

/**
 * The status rows an anonymous visitor sees: the concept art for screen 12,
 * driven only by the page's own local state. It never claims real data.
 * The preview copy itself stays in the component so it keeps importing the
 * design's single source of truth (`storyTitle` / `storyParagraphs`).
 */
export function fixtureSteps({ text, verified } = {}) {
  return [
    { tone: 'green', title: '官方摘要已导入', desc: '已从知乎官方 API 获取标题、摘要等基础信息。', action: null },
    {
      tone: 'orange',
      title: text ? '原文片段已补充' : '原文片段待补充',
      desc: text ? '已补充原文片段，可继续生成回访。' : '当前暂无原回答正文。补充后可获得更深入、更贴近你原意的后续访谈。',
      action: '去粘贴原文',
    },
    {
      tone: 'gray',
      title: verified ? '作者身份已确认（演示）' : '作者身份待确认',
      desc: '我们将基于公开信息进行匹配。请确认是否为你本人的回答，以确保后续内容的准确性。',
      action: '确认这是我的回答',
    },
  ];
}
