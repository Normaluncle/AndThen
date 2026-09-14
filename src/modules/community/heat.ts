export const HEAT_FORMULA_ZH =
  '近14天半衰期：每次点进故事 +4，授权用户阅读 +6，停留 ln(1+秒)×2，同一访客再次进入 +3。越新的访问权重越高。';

function recency(ageDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / 14);
}

export function visitWeight(input: { dwellMs: number; returning: boolean; ageDays: number }): number {
  const click = 4;
  const dwell = Math.log1p(Math.max(0, input.dwellMs) / 1000) * 2;
  const repeat = input.returning ? 3 : 0;
  return (click + dwell + repeat) * recency(input.ageDays);
}

export function authorizedReadWeight(ageDays: number): number {
  return 6 * recency(ageDays);
}

export function storyHeat(input: {
  visits: { visitorKey: string; dwellMs: number; createdAt: Date }[];
  authorizedReads: { createdAt: Date }[];
  now: Date;
}): number {
  const firstSeen = new Map<string, number>();
  let score = 0;
  const visits = [...input.visits].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const visit of visits) {
    const ageDays = (input.now.getTime() - visit.createdAt.getTime()) / 86400000;
    const returning = firstSeen.has(visit.visitorKey);
    if (!returning) firstSeen.set(visit.visitorKey, visit.createdAt.getTime());
    score += visitWeight({ dwellMs: visit.dwellMs, returning, ageDays });
  }
  for (const read of input.authorizedReads) {
    score += authorizedReadWeight((input.now.getTime() - read.createdAt.getTime()) / 86400000);
  }
  return Math.round(score * 10) / 10;
}
