import { and, desc, eq } from 'drizzle-orm';
import { discoveryCandidates, interests, sources, type OfficialCandidate } from '../../db/schema.js';
import type { AuthContext, ModuleContext } from '../../shared/types.js';
import { AppError } from '../../http/errors.js';
import { importSource } from '../sources/service.js';
import { requestPreparation } from '../memory/preparation.js';

export async function storeCandidates(ctx:ModuleContext,items:OfficialCandidate[]) {
  const result=[];
  for(const data of items){
    const [row]=await ctx.db.insert(discoveryCandidates).values({url:data.url,data,updatedAt:ctx.now()}).onConflictDoUpdate({target:discoveryCandidates.url,set:{data,updatedAt:ctx.now()}}).returning();
    result.push({...data,candidate_id:row!.id,acquired_at:row!.updatedAt.toISOString()});
  }
  return result;
}
export async function candidateFeed(ctx:ModuleContext,auth:AuthContext,followingOnly=false) {
  const rows=followingOnly?(await ctx.db.select({candidate:discoveryCandidates}).from(discoveryCandidates).innerJoin(interests,and(eq(interests.sourceId,discoveryCandidates.sourceId),eq(interests.readerKey,auth.userId),eq(interests.active,true))).orderBy(desc(discoveryCandidates.updatedAt)).limit(100)).map(x=>x.candidate):await ctx.db.select().from(discoveryCandidates).orderBy(desc(discoveryCandidates.updatedAt)).limit(50);
  const result=[];
  for(const row of rows){
    if(row.sourceId){const [source]=await ctx.db.select().from(sources).where(eq(sources.id,row.sourceId));if(!source||source.deletedAt||['revoked','rejected'].includes(source.permissionStatus))continue;}
    const [interest]=row.sourceId?await ctx.db.select().from(interests).where(and(eq(interests.sourceId,row.sourceId),eq(interests.readerKey,auth.userId))):[];
    result.push({...row.data,candidate_id:row.id,linked_source_id:row.sourceId,interested:interest?.active??false,acquired_at:row.updatedAt.toISOString()});
  }
  return result;
}
export async function followCandidate(ctx:ModuleContext,auth:AuthContext,id:string,active:boolean) {
  const [candidate]=await ctx.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id,id));
  if(!candidate)throw AppError.notFound();
  if(!candidate.sourceId&&!active)return {active:false,source_id:null};
  const imported=active?await importSource(ctx,auth,{sourceType:'third_party_link',originalUrl:candidate.url,originalAccountRef:null,title:candidate.data.title,
    materialLevel:'api_summary',body:candidate.data.text,excerpt:null,excerptLocation:null,publishedAt:null,upstreamUpdatedAt:candidate.data.upstream_updated_at?new Date(candidate.data.upstream_updated_at):null,notes:'Official discovery candidate; author ownership not established',provenance:'official_api'}):null;
  const sourceId=imported?.source.id??candidate.sourceId!;
  await ctx.db.transaction(async tx=>{
    const [source]=await tx.select().from(sources).where(eq(sources.id,sourceId)).for('update');
    if(!source||source.deletedAt||['revoked','rejected'].includes(source.permissionStatus))throw AppError.withdrawn();
    if(imported)await tx.update(discoveryCandidates).set({sourceId,snapshotId:imported.snapshot.id}).where(eq(discoveryCandidates.id,id));
    await tx.insert(interests).values({sourceId,readerKey:auth.userId,active,cohort:auth.cohort,excluded:true,cancelledAt:active?null:ctx.now()})
      .onConflictDoUpdate({target:[interests.readerKey,interests.sourceId],set:{active,cancelledAt:active?null:ctx.now(),updatedAt:ctx.now()}});
    if(active)await requestPreparation(ctx,tx,sourceId);
  });
  return {active,source_id:sourceId};
}
