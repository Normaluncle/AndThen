import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ModuleContext } from '../../shared/types.js';
import type { JobHandlerContext } from '../../jobs/types.js';
import { sources, users, zhihuCommentSyncs, type ZhihuComment } from '../../db/schema.js';
import { AppError } from '../../http/errors.js';
import { withJobFence, fenceOf } from '../../jobs/transaction.js';
import { ownComments } from './creator.js';

export function mergeComments(existing: ZhihuComment[], incoming: ZhihuComment[]): ZhihuComment[] {
  const records = new Map(existing.map(x => [x.id, x]));
  for (const value of incoming) records.set(value.id, value);
  if (records.size > 2000) throw AppError.sourceIncomplete('本次演示的评论缓存已达 2000 条上限');
  return [...records.values()];
}

export async function syncCommentPage(ctx: ModuleContext, job: JobHandlerContext, transport: typeof fetch = fetch) {
  const p = z.object({source_id:z.string().uuid(),owner_user_id:z.string().uuid()}).parse(job.payload);
  const [owner] = await ctx.db.select().from(users).where(eq(users.id,p.owner_user_id));
  if (!owner || owner.role !== 'admin') throw AppError.forbidden();
  const [source] = await ctx.db.select().from(sources).where(eq(sources.id,p.source_id));
  if (!source || source.deletedAt) throw AppError.withdrawn();
  if (!source.originalUrl) throw AppError.sourceIncomplete();
  const [previous] = await ctx.db.select().from(zhihuCommentSyncs).where(eq(zhihuCommentSyncs.sourceId,source.id));
  const offset = previous?.offset ?? '0';
  await job.heartbeat();
  const page = await ownComments(ctx.env.ZHIHU_ACCESS_SECRET,source.originalUrl,offset,(url,options)=>transport(url,{...options,
    signal:AbortSignal.any([job.signal,...(options?.signal ? [options.signal] : [])]),
  }));
  await ctx.db.transaction(async tx=>{
    const [current] = await tx.select().from(sources).where(eq(sources.id,source.id)).for('update');
    if (!current || current.deletedAt) throw AppError.withdrawn();
    await withJobFence(tx,fenceOf(job.job),async fenced=>{
    const [state] = await fenced.select().from(zhihuCommentSyncs).where(eq(zhihuCommentSyncs.sourceId,source.id));
    if (state?.revision !== previous?.revision) throw AppError.conflict('评论同步已更新，请从新游标继续');
    const items = mergeComments(state?.items ?? [],page.items.flatMap(({children,...root})=>[root,...children]));
    const value = {sourceId:source.id,revision:(state?.revision ?? 0)+1,items,
      // Re-read the terminal page next time to pick up new comments. Existing IDs
      // are upserted; absence never implies deletion of upstream comments.
      offset:page.paging.next_offset ?? offset,isEnd:page.paging.is_end,stoppedReason:page.paging.stopped_reason,updatedAt:ctx.now()};
    await fenced.insert(zhihuCommentSyncs).values(value).onConflictDoUpdate({target:zhihuCommentSyncs.sourceId,set:value});
    });
  });
  return {data:{synced:true,is_end:page.paging.is_end,stopped_reason:page.paging.stopped_reason}};
}
