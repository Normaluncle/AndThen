/**
 * Upstream popularity of an official candidate.
 *
 * This is deliberately NOT the site's own heat. `community/heat.ts` measures what
 * happens on this site (visits, dwell, reads); this measures what happened on the
 * platform. Folding the two together would present Zhihu engagement as our own
 * statistic, so they stay separate numbers and the card labels them apart.
 *
 * Only numbers the official search response actually returned are used. When both
 * counts are missing the heat is null and the UI shows no heat rather than a zero.
 * `RankingScore` is the official result ordering, not popularity, so it is carried
 * for reference and never folded into the heat.
 */
export const UPSTREAM_HEAT_FORMULA = '热度 = 点赞 + 评论 × 2（官方搜索接口的 VoteUpCount / CommentCount）';

function known(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function upstreamHeat(input: { vote_up_count?: number | null; comment_count?: number | null }): number | null {
  const votes = known(input.vote_up_count);
  const comments = known(input.comment_count);
  if (votes === null && comments === null) return null;
  // A comment costs more effort than a like, so it weighs twice.
  return (votes ?? 0) + (comments ?? 0) * 2;
}

/** The engagement fields a candidate DTO exposes, with the heat derived from them. */
export function engagementFields(input: {
  vote_up_count?: number | null;
  comment_count?: number | null;
  ranking_score?: number | null;
}) {
  return {
    vote_up_count: known(input.vote_up_count),
    comment_count: known(input.comment_count),
    ranking_score: known(input.ranking_score),
    heat: upstreamHeat(input),
  };
}
