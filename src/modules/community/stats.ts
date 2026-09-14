import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { followupCases, interests, siteVisits, sourceSnapshots, sources, storyReads, zhihuAccounts } from '../../db/schema.js';
import type { Executor } from '../../db/client.js';
import { sourcePresentation } from '../sources/presentation.js';
import { HEAT_FORMULA_ZH, storyHeat } from './heat.js';

function followupLabel(status: string | null): string {
  if (status === 'published') return '已回访';
  if (status && ['interviewing', 'accepted', 'paused', 'eligible'].includes(status)) return '回访中';
  return '待回访';
}

export async function siteOverview(db: Executor, now: Date) {
  const [visitors] = await db.select({ n: sql<number>`count(distinct ${siteVisits.visitorKey})::int` }).from(siteVisits);
  const [authorized] = await db.select({ n: sql<number>`count(*)::int` }).from(zhihuAccounts).where(isNull(zhihuAccounts.revokedAt));
  const [reads] = await db.select({ n: sql<number>`count(*)::int` }).from(storyReads)
    .innerJoin(zhihuAccounts, eq(zhihuAccounts.userId, storyReads.userId))
    .where(isNull(zhihuAccounts.revokedAt));
  const rows = await db.select({
    id: sources.id,
    title: sources.title,
    provenance: sources.provenance,
    updatedAt: sources.updatedAt,
    caseStatus: followupCases.status,
  }).from(sources)
    .leftJoin(followupCases, eq(followupCases.sourceId, sources.id))
    .where(sql`${sources.deletedAt} is null`)
    .orderBy(desc(sources.updatedAt))
    .limit(80);
  const visits = await db.select().from(siteVisits);
  const authReads = await db.select({ sourceId: storyReads.sourceId, readAt: storyReads.readAt })
    .from(storyReads)
    .innerJoin(zhihuAccounts, eq(zhihuAccounts.userId, storyReads.userId))
    .where(isNull(zhihuAccounts.revokedAt));
  const visitsBySource = new Map<string, typeof visits>();
  for (const visit of visits) {
    if (!visit.sourceId) continue;
    const list = visitsBySource.get(visit.sourceId) ?? [];
    list.push(visit);
    visitsBySource.set(visit.sourceId, list);
  }
  const readsBySource = new Map<string, { createdAt: Date }[]>();
  for (const row of authReads) {
    const list = readsBySource.get(row.sourceId) ?? [];
    list.push({ createdAt: row.readAt });
    readsBySource.set(row.sourceId, list);
  }
  const samples = [];
  let published = 0;
  let pending = 0;
  for (const row of rows) {
    if (row.caseStatus === 'published') published += 1;
    else pending += 1;
    const [snapshot] = await db.select().from(sourceSnapshots).where(eq(sourceSnapshots.sourceId, row.id)).orderBy(desc(sourceSnapshots.version)).limit(1);
    const presentation = await sourcePresentation(db, row.id, row.title, snapshot);
    const [follow] = await db.select({ n: sql<number>`count(*)::int` }).from(interests).where(and(eq(interests.sourceId, row.id), eq(interests.active, true)));
    const heat = storyHeat({
      now,
      visits: (visitsBySource.get(row.id) ?? []).map((visit) => ({ visitorKey: visit.visitorKey, dwellMs: visit.dwellMs, createdAt: visit.createdAt })),
      authorizedReads: readsBySource.get(row.id) ?? [],
    });
    samples.push({
      id: row.id,
      title: row.title,
      provenance: row.provenance,
      year: presentation.cover_year,
      category: presentation.category,
      status: followupLabel(row.caseStatus),
      followers: follow?.n ?? 0,
      heat,
      updated_at: row.updatedAt.toISOString().slice(0, 10),
    });
  }
  return {
    visitors: visitors?.n ?? 0,
    authorized_users: authorized?.n ?? 0,
    authorized_reads: reads?.n ?? 0,
    heat_score: Math.round(samples.reduce((sum, item) => sum + item.heat, 0) * 10) / 10,
    heat_formula: HEAT_FORMULA_ZH,
    stories: rows.length,
    published_followups: published,
    pending_followups: pending,
    samples,
  };
}
