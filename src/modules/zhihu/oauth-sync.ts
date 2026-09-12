import {and,eq,isNull} from 'drizzle-orm';
import {z} from 'zod';
import type {Database} from '../../db/client.js';
import type {ModuleContext,AuthContext} from '../../shared/types.js';
import type {JobHandlerContext} from '../../jobs/types.js';
import {users,zhihuAccounts,authorVerifications,authorMemories,followupCases,sources} from '../../db/schema.js';
import {AppError} from '../../http/errors.js';
import {ownContents} from './creator.js';
import {readOAuthToken} from './oauth-accounts.js';
import {importSource,grantConsent} from '../sources/service.js';
import {requestRefresh} from '../memory/service.js';

export async function queueOAuthSync(ctx:ModuleContext,userId:string,force=false) {
 return ctx.db.transaction(async tx=>{
  const [account]=await tx.select().from(zhihuAccounts).where(eq(zhihuAccounts.userId,userId)).for('update');
  if(!account?.syncConsentAt||account.revokedAt||!account.tokenCiphertext||account.expiresAt<=ctx.now())throw AppError.consentRequired('Active Zhihu authorization and material processing consent are required');
  if(!force&&account.lastSyncAt&&ctx.now().getTime()-account.lastSyncAt.getTime()<86400000)return {queued:false};
  const {job}=await ctx.jobs.enqueue({kind:'zhihu.author.sync',payload:{user_id:userId,authorization_version:account.updatedAt.toISOString()},dedupeKey:`zhihu:author:${userId}`},tx);
  return {queued:true,job_id:job.id};
 });
}

export async function syncOAuthAuthor(ctx:ModuleContext,job:JobHandlerContext) {
 const p=z.object({user_id:z.string().uuid(),authorization_version:z.string()}).parse(job.payload);
 const token=await readOAuthToken(ctx.db,p.user_id,ctx.env.ZHIHU_TOKEN_ENCRYPTION_KEY!,ctx.now());
 const data=await ownContents(ctx.env.ZHIHU_ACCESS_SECRET,'0',fetch,token);
 return job.withFence(async tx=>{
  const [user]=await tx.select().from(users).where(eq(users.id,p.user_id)).for('update');
  const [account]=await tx.select().from(zhihuAccounts).where(eq(zhihuAccounts.userId,p.user_id)).for('update');
  if(!user||user.disabledAt||!account?.syncConsentAt||account.revokedAt||account.expiresAt<=ctx.now()||account.updatedAt.toISOString()!==p.authorization_version)throw AppError.conflict('Zhihu authorization changed during sync');
  const nested={...ctx,db:tx as unknown as Database};
  const auth:AuthContext={userId:user.id,role:user.role,cohort:user.cohort,sessionId:job.job.id,expiresAt:account.expiresAt};
  let imported=0;
  for(const item of data.items.slice(0,20)) {
   // Existing strong attribution is checked before any new snapshot can be written.
   const existing=await tx.select({owner:authorVerifications.userId}).from(sources).innerJoin(authorVerifications,eq(authorVerifications.sourceId,sources.id))
    .where(and(eq(sources.originalUrl,item.url),eq(authorVerifications.status,'verified')));
   if(existing.some(x=>x.owner!==user.id))throw AppError.conflict('Official content conflicts with an existing verified owner');
   const result=await importSource(nested,auth,{sourceType:'third_party_link',originalUrl:item.url,originalAccountRef:`zhihu:${account.uid}`,title:item.title,materialLevel:'api_summary',body:item.text,excerpt:null,excerptLocation:null,publishedAt:null,upstreamUpdatedAt:null,notes:'Official OAuth user contents; summary only',provenance:'official_api'});
   await tx.select().from(sources).where(eq(sources.id,result.source.id)).for('update');
   const links=await tx.select().from(authorVerifications).where(and(eq(authorVerifications.sourceId,result.source.id),eq(authorVerifications.status,'verified')));
   if(links.some(x=>x.userId!==user.id))throw AppError.conflict('Source attribution changed during sync');
   if(!links.some(x=>x.userId===user.id))await tx.insert(authorVerifications).values({sourceId:result.source.id,userId:user.id,method:'oauth',status:'verified',evidenceRef:`official:user-contents:${account.uid}`,verifiedAt:ctx.now(),scope:'official content list ownership'});
   await tx.update(followupCases).set({authorUserId:user.id,updatedAt:ctx.now()}).where(and(eq(followupCases.sourceId,result.source.id),isNull(followupCases.authorUserId)));
   await grantConsent(nested,auth,result.source.id,'private_interview','oauth-materials-v1');
   await grantConsent(nested,auth,result.source.id,'external_model_processing','oauth-materials-v1');
   imported++;
  }
  if(imported&&user.role==='reader')await tx.update(users).set({role:'author',updatedAt:ctx.now()}).where(eq(users.id,user.id));
  await requestRefresh(nested,user.id);
  await tx.update(zhihuAccounts).set({lastSyncAt:ctx.now()}).where(eq(zhihuAccounts.userId,user.id));
  return {data:{imported,scope:'first_20_official_summaries',has_more:!data.paging.is_end}};
 });
}
