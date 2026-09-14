import {and, desc, eq, gte, sql} from 'drizzle-orm';
import {z} from 'zod';
import type {ZodTypeProvider} from 'fastify-type-provider-zod';
import type {AppInstance, ModuleContext} from '../../shared/types.js';
import type {JobHandlerContext} from '../../jobs/types.js';
import {discoveryRuns, discoverySelections, discoveryCandidates, sources, type OfficialCandidate} from '../../db/schema.js';
import {success, AppError} from '../../http/errors.js';
import {envelopeSchema} from '../../http/envelope.js';
import {officialSearch, canonicalZhihuUrl} from './client.js';
import {reviewDiscovery} from './discovery-analysis.js';
import {sourcePresentation} from '../sources/presentation.js';

export const discoveryKind = 'zhihu.discovery.scan';
export function localDiscoveryEnabled(ctx: ModuleContext) {
  return ctx.env.DISCOVERY_AI_ENABLED || ctx.env.LOCAL_DISCOVERY_PREVIEW && ['localhost','127.0.0.1','[::1]'].includes(new URL(ctx.env.PUBLIC_BASE_URL).hostname);
}
export function discoveryWindow(now: Date, minutes: number) {
  const interval = minutes * 60000;
  return {slot: String(Math.floor(now.getTime()/interval)), next: new Date((Math.floor(now.getTime()/interval)+1)*interval),
    dayStart: new Date(Math.floor((now.getTime()+8*3600000)/86400000)*86400000-8*3600000)};
}
/** Conservative local rules; this is not an AI judgement or permission to publish. */
export function screenCandidate(item: OfficialCandidate) {
  const text = `${item.title} ${item.text}`;
  try { canonicalZhihuUrl(item.url); } catch { return {decision:'held',reason:'invalid_source_url'}; }
  if (!item.title.trim() || item.text.trim().length < 30) return {decision:'held',reason:'insufficient_summary'};
  if (/自杀|自残|身份证|手机号|性侵|未成年人/.test(text)) return {decision:'held',reason:'sensitive_manual_review'};
  if (!/我|亲身|经历|辞职|转行|考研|创业|搬家/.test(text)) return {decision:'held',reason:'no_experience_signal'};
  if (!/后来|当时|现在|之后|那年|\d{4}年|几年|过去|开始|曾经/.test(text)) return {decision:'held',reason:'no_time_signal'};
  return {decision:'preview',reason:'experience_and_time_signals'};
}

export async function seedDiscovery(ctx: ModuleContext) {
  if (!localDiscoveryEnabled(ctx)) return;
  const {slot} = discoveryWindow(ctx.now(),ctx.env.DISCOVERY_INTERVAL_MINUTES);
  return ctx.jobs.enqueue({kind:discoveryKind,dedupeKey:`discovery:${ctx.env.DISCOVERY_AI_ENABLED?'ai:':''}${slot}`,maxAttempts:1});
}

export async function scanDiscovery(ctx: ModuleContext, job: JobHandlerContext, search = officialSearch) {
  if (!localDiscoveryEnabled(ctx)) return {data:{disabled:true}};
  const now=ctx.now(), window=discoveryWindow(now,ctx.env.DISCOVERY_INTERVAL_MINUTES);
  // Persist the successor before external IO: provider failure must not stop future ticks.
  const run=await job.withFence(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('andthen-discovery-admission'))`);
    await ctx.jobs.enqueue({kind:discoveryKind,dedupeKey:`discovery:${ctx.env.DISCOVERY_AI_ENABLED?'ai:':''}${discoveryWindow(window.next,ctx.env.DISCOVERY_INTERVAL_MINUTES).slot}`,runAt:window.next,maxAttempts:1},tx);
    const previous=await tx.select().from(discoveryRuns).where(gte(discoveryRuns.startedAt,window.dayStart));
    if(previous.some(r=>r.slot===`${ctx.env.DISCOVERY_AI_ENABLED?'ai:':''}${window.slot}`))return null;
    const selected=await tx.select({id:discoverySelections.id}).from(discoverySelections).where(and(gte(discoverySelections.createdAt,window.dayStart),eq(discoverySelections.decision,'preview')));
    if(previous.length>=ctx.env.DISCOVERY_DAILY_SEARCH_LIMIT || selected.length>=ctx.env.DISCOVERY_DAILY_LIMIT)return null;
    const queries=ctx.env.DISCOVERY_QUERIES.split('|').map(q=>q.trim().slice(0,300)).filter(Boolean);
    const query=queries[previous.length%queries.length];
    if(!query)return null;
    const [row]=await tx.insert(discoveryRuns).values({slot:`${ctx.env.DISCOVERY_AI_ENABLED?'ai:':''}${window.slot}`,query,status:'running',startedAt:now}).onConflictDoNothing().returning();
    return row;
  });
  if(!run)return {data:{skipped:true}};
  try {
    if(job.signal.aborted)throw AppError.conflict('Discovery cancelled');
    await job.heartbeat();
    const items=await search(ctx.env.ZHIHU_ACCESS_SECRET,run.query);
    await job.heartbeat();
    if(job.signal.aborted)throw AppError.conflict('Discovery cancelled');
    const reviews=new Map<string,Awaited<ReturnType<typeof reviewDiscovery>>|{decision:string;reason:string;analysis:null}>();
    if(ctx.env.DISCOVERY_AI_ENABLED){
      for(const item of items){
        if(reviews.has(item.url)||screenCandidate(item).decision!=='preview')continue;
        const [old]=await ctx.db.select({id:discoverySelections.id}).from(discoverySelections).where(eq(discoverySelections.url,item.url));
        if(old)continue;
        try{reviews.set(item.url,await reviewDiscovery(ctx,job,item));}catch(error){if(job.signal.aborted)throw error;reviews.set(item.url,{decision:'held',reason:'ai_review_failed',analysis:null});}
      }
    }
    const counts=await job.withFence(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('andthen-discovery-admission'))`);
      const selected=await tx.select({id:discoverySelections.id}).from(discoverySelections).where(and(gte(discoverySelections.createdAt,window.dayStart),eq(discoverySelections.decision,'preview')));
      let remaining=ctx.env.DISCOVERY_DAILY_LIMIT-selected.length;
      const result={fetched:items.length,preview:0,held:0,duplicate:0,capped:0};
      for(const item of items){
        const [old]=await tx.select({id:discoverySelections.id}).from(discoverySelections).where(eq(discoverySelections.url,item.url));
        if(old){result.duplicate++;continue;}
        const review=reviews.get(item.url)||screenCandidate(item);
        if(review.decision==='preview' && remaining<=0){result.capped++;continue;}
        let candidateId: string|null=null;
        if(review.decision==='preview'){
          // Freeze the selected summary separately; later interactive searches may update the candidate.
          await tx.insert(discoveryCandidates).values({url:item.url,data:item,updatedAt:now}).onConflictDoNothing();
          const [candidate]=await tx.select().from(discoveryCandidates).where(eq(discoveryCandidates.url,item.url));
          candidateId=candidate!.id;
          remaining--;result.preview++;
        }else result.held++;
        await tx.insert(discoverySelections).values({url:item.url,runId:run.id,candidateId,data:item,...review,createdAt:now});
      }
      await tx.update(discoveryRuns).set({status:'completed',counts:result,finishedAt:ctx.now()}).where(eq(discoveryRuns.id,run.id));
      return result;
    });
    return {data:{run_id:run.id,...counts}};
  } catch(error) {
    await job.withFence(tx=>tx.update(discoveryRuns).set({status:'failed',errorCode:error instanceof AppError?error.code:'discovery_failed',finishedAt:ctx.now()}).where(eq(discoveryRuns.id,run.id)));
    throw error;
  }
}

export async function registerDiscoveryRoutes(app: AppInstance,ctx: ModuleContext) {
  const r=app.withTypeProvider<ZodTypeProvider>();
  const response={200:envelopeSchema(z.record(z.unknown()))};
  r.get('/discovery/local-preview',{schema:{tags:['zhihu'],response}},async request=>{
    if(!localDiscoveryEnabled(ctx))return success(request.id,{enabled:false,items:[]});
    const rows=await ctx.db.select().from(discoverySelections).where(eq(discoverySelections.decision,'preview')).orderBy(desc(discoverySelections.createdAt)).limit(50);
    const items=[];
    for(const row of rows){
      if(!row.candidateId||(ctx.env.DISCOVERY_AI_ENABLED&&!row.analysis))continue;
      const [candidate]=await ctx.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id,row.candidateId));
      if(!candidate)continue;
      if(candidate.sourceId){const [source]=await ctx.db.select().from(sources).where(eq(sources.id,candidate.sourceId));if(!source||source.deletedAt||['revoked','rejected'].includes(source.permissionStatus))continue;}
      items.push({...row.data,comments:[],candidate_id:row.candidateId,provenance:'official_api',discovery_reason:row.reason,
        display_status:ctx.env.DISCOVERY_AI_ENABLED?'official_candidate':'local_candidate_preview',analysis_status:row.analysis?'ai_reviewed':'awaiting_model_consent',
        ...await sourcePresentation(ctx.db,row.url,row.data.title+' '+row.data.text),...(row.analysis?.caption?{cover_caption:row.analysis.caption}:{})});
    }
    return success(request.id,{enabled:true,ai_enabled:ctx.env.DISCOVERY_AI_ENABLED,items});
  });
  const guard=[app.authenticate,app.requireRole('admin')];
  r.post('/admin/discovery/run',{preHandler:guard,schema:{tags:['zhihu'],body:z.object({}).strict(),response}},async request=>{
    if(!localDiscoveryEnabled(ctx))throw AppError.serviceUnavailable('Local discovery preview is disabled');
    const result=await seedDiscovery(ctx);
    return success(request.id,{job_id:result?.job.id,deduped:result?.deduped});
  });
  r.get('/admin/discovery/runs',{preHandler:guard,schema:{tags:['zhihu'],response}},async request=>success(request.id,{
    enabled:localDiscoveryEnabled(ctx),interval_minutes:ctx.env.DISCOVERY_INTERVAL_MINUTES,daily_limit:ctx.env.DISCOVERY_DAILY_LIMIT,
    runs:await ctx.db.select().from(discoveryRuns).orderBy(desc(discoveryRuns.startedAt)).limit(30)}));
}
