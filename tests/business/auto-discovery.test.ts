import {it,expect,vi} from 'vitest';
import {eq} from 'drizzle-orm';
import {createHarness,auth,seedUser,seedPublishedStory} from './helpers.js';
import {aiRuns,discoveryRuns,discoverySelections,discoveryCandidates,sources,jobs,type OfficialCandidate} from '../../src/db/schema.js';
import {scanDiscovery,seedDiscovery,screenCandidate,discoveryKind,discoveryWindow} from '../../src/modules/zhihu/auto-discovery.js';
import type {ModuleContext} from '../../src/shared/types.js';
import type {officialSearch} from '../../src/modules/zhihu/client.js';

const item=(id:number,text='我曾经辞职转行，开始学习新的技能。现在回想这几年的经历，有很多值得记录和分享的事情。'):OfficialCandidate=>({url:`https://www.zhihu.com/answer/${id}`,title:'【test_fixture】转行后的经历',text,author_name:'测试作者',author_avatar:null,author_url:null,material_level:'api_summary',comments:[],comments_coverage:'selected'});
async function execute(ctx:ModuleContext,search:typeof officialSearch){
 const queued=await seedDiscovery(ctx);
 // Advance the durable due time alongside the injected logical clock.
 if(queued)await ctx.db.update(jobs).set({runAt:new Date(0)}).where(eq(jobs.id,queued.job.id));
 const job=await ctx.jobs.claim({workerId:'test_fixture',leaseSeconds:60,kinds:[discoveryKind]});
 if(!job)throw new Error('no job');
 try{
 const result=await scanDiscovery(ctx,{job,payload:job.payload,attempt:job.attempts,maxAttempts:job.maxAttempts,signal:new AbortController().signal,logger:ctx.logger,heartbeat:async()=>{await ctx.jobs.heartbeat(job.id,job.fencingToken,60);},withFence:fn=>ctx.jobs.withFence({jobId:job.id,fencingToken:job.fencingToken},fn)},search);
 await ctx.jobs.complete(job.id,job.fencingToken,result.data);return result;
 }catch(error){await ctx.jobs.complete(job.id,job.fencingToken,null);throw error;}
}
it('uses conservative evidence rules and a Shanghai calendar day',()=>{
 expect(screenCandidate(item(1)).decision).toBe('preview');
 expect(screenCandidate(item(1,'短摘要')).reason).toBe('insufficient_summary');
 expect(screenCandidate(item(1,'自杀'+item(1).text)).reason).toBe('sensitive_manual_review');
 expect(screenCandidate({...item(1),url:'https://example.com/answer/1'}).reason).toBe('invalid_source_url');
 expect(screenCandidate({...item(1),title:'知识',text:'这是一篇纯知识解释文章，讲解基础理论与方法，不包含个人时间线以及具体实践记录。'}).decision).toBe('held');
 expect(discoveryWindow(new Date('2026-09-14T16:01:00Z'),60).dayStart.toISOString()).toBe('2026-09-14T16:00:00.000Z');
});
it('shows the official engagement as heat on the card, separate from site counters',async()=>{
 const h=await createHarness();try{
 Object.assign(h.moduleCtx.env,{DISCOVERY_AI_ENABLED:true,LLM_BASE_URL:'http://llm.test/v1',LLM_MODEL:'fixture'});
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({decision:'candidate',reasons:['具体经历与时间线'],year:null,caption:'我辞职转行学新技能'})}}]})));
 // The counts the official search response returns next to the summary.
 await execute(h.moduleCtx,async()=>[{...item(51),vote_up_count:18,comment_count:3,ranking_score:1.39}]);
 const card=(await h.app.inject({url:'/api/discovery/local-preview'})).json().data.items[0];
 expect(card).toMatchObject({vote_up_count:18,comment_count:3,ranking_score:1.39,heat:24});
 // The heat is the platform's number. This candidate is not a story on this site, so
 // it carries no site counters — the card must not copy the heat into them.
 expect(card.site_counts).toBeUndefined();
 // Every card can be dated: the preview records when it was captured.
 expect(typeof card.acquired_at).toBe('string');
 }finally{vi.restoreAllMocks();await h.close();}
});
it('leaves the heat unknown instead of inventing a zero when no counts came back',async()=>{
 const h=await createHarness();try{
 Object.assign(h.moduleCtx.env,{DISCOVERY_AI_ENABLED:true,LLM_BASE_URL:'http://llm.test/v1',LLM_MODEL:'fixture'});
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({decision:'candidate',reasons:['具体经历与时间线'],year:null,caption:'我辞职转行学新技能'})}}]})));
 await execute(h.moduleCtx,async()=>[item(52)]);
 const card=(await h.app.inject({url:'/api/discovery/local-preview'})).json().data.items[0];
 expect(card.heat).toBeNull();
 expect(card.vote_up_count).toBeNull();
 }finally{vi.restoreAllMocks();await h.close();}
});
it('publishes only model-approved summaries, records real usage, and never creates an author story',async()=>{
 const h=await createHarness();try{
 const ctx=h.moduleCtx;Object.assign(ctx.env,{DISCOVERY_AI_ENABLED:true,PUBLIC_BASE_URL:'https://example.com',LLM_BASE_URL:'http://llm.test/v1',LLM_MODEL:'fixture'});
 const mock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({model:'fixture',usage:{prompt_tokens:20,completion_tokens:10},choices:[{message:{content:JSON.stringify({decision:'candidate',reasons:['具体经历与时间线'],year:null,caption:'我辞职转行学新技能'})}}]})));
 await execute(ctx,async()=>[item(31)]);
 expect(mock).toHaveBeenCalledTimes(1);
 const feed=(await h.app.inject({url:'/api/discovery/local-preview'})).json().data;
 expect(feed.ai_enabled).toBe(true);expect(feed.items).toHaveLength(1);expect(feed.items[0].cover_caption).toBe('我辞职转行学新技能');expect(feed.items[0].cover_year).toBeNull();
 expect((await h.app.inject({url:'/api/discovery/candidates/'+feed.items[0].candidate_id})).statusCode).toBe(200);
 expect(await ctx.db.select().from(sources)).toHaveLength(0);
 const runs=await ctx.db.select().from(aiRuns);expect(runs[0]?.status).toBe('succeeded');expect(runs[0]?.inputTokens).toBe(20);
 }finally{vi.restoreAllMocks();await h.close();}
});
it('rejects invented AI captions and leaves the public feed empty',async()=>{
 const h=await createHarness();try{
 Object.assign(h.moduleCtx.env,{DISCOVERY_AI_ENABLED:true,LLM_BASE_URL:'http://llm.test/v1',LLM_MODEL:'fixture'});
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({decision:'candidate',reasons:['经历'],year:null,caption:'后来赚了100万'})}}]})));
 await execute(h.moduleCtx,async()=>[item(32)]);
 expect((await h.app.inject({url:'/api/discovery/local-preview'})).json().data.items).toHaveLength(0);
 expect((await h.ctx.db.select().from(aiRuns))[0]?.status).toBe('failed');
 }finally{vi.restoreAllMocks();await h.close();}
});
it('deduplicates slots and URLs, caps daily admission, keeps publication separate and gates local exposure',async()=>{
 const h=await createHarness({enableDocs:true});try{
 const ctx=h.moduleCtx;ctx.env.LOCAL_DISCOVERY_PREVIEW=true;ctx.env.DISCOVERY_DAILY_LIMIT=2;
 let now=new Date();ctx.now=()=>now;
 const search=vi.fn(async()=>[item(1),item(1),item(2,'缺少内容'),item(3),item(4)]);
 await execute(ctx,search);
 expect(search).toHaveBeenCalledTimes(1);
 const runs=await ctx.db.select().from(discoveryRuns);expect(runs[0]?.counts).toEqual({fetched:5,preview:2,held:1,duplicate:1,capped:1});
 expect(await ctx.db.select().from(sources)).toHaveLength(0);
 const preview=()=>h.app.inject({url:'/api/discovery/local-preview'});
 expect((await preview()).json().data.items).toHaveLength(2);
 expect((await preview()).json().data.items[0].analysis_status).toBe('awaiting_model_consent');
 await execute(ctx,search);expect(search).toHaveBeenCalledTimes(1);
 now=new Date(now.getTime()+3600000);await execute(ctx,search);expect(search).toHaveBeenCalledTimes(1);
 const reader=await seedUser(h,'reader');expect((await h.app.inject({method:'POST',url:'/api/admin/discovery/run',headers:auth(reader.token),payload:{}})).statusCode).toBe(403);
 const author=await seedUser(h,'author');const story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});
 await ctx.db.update(discoveryCandidates).set({sourceId:story.source.id}).where(eq(discoveryCandidates.url,item(1).url));
 await ctx.db.update(sources).set({permissionStatus:'revoked'}).where(eq(sources.id,story.source.id));
 expect((await preview()).json().data.items).toHaveLength(1);
 ctx.env.PUBLIC_BASE_URL='https://example.com';expect((await preview()).json().data).toEqual({enabled:false,items:[]});
 expect((await h.app.inject({url:'/openapi.json'})).statusCode).toBe(200);
 }finally{await h.close();}
});
it('keeps the next tick after provider failure, persists safe error and applies the search budget',async()=>{
 const h=await createHarness();try{
 const ctx=h.moduleCtx;ctx.env.LOCAL_DISCOVERY_PREVIEW=true;ctx.env.DISCOVERY_DAILY_SEARCH_LIMIT=1;
 let now=new Date();ctx.now=()=>now;
 const search=vi.fn(async()=>{throw new Error('provider detail must not enter audit');});
 await expect(execute(ctx,search)).rejects.toThrow();
 const runs=await ctx.db.select().from(discoveryRuns);expect(runs[0]?.status).toBe('failed');expect(runs[0]?.errorCode).toBe('discovery_failed');
 expect((await ctx.db.select().from(jobs)).some(j=>j.kind===discoveryKind&&j.status==='queued')).toBe(true);
 now=new Date(now.getTime()+3600000);await execute(ctx,search);expect(search).toHaveBeenCalledTimes(1);
 now=new Date(now.getTime()+86400000);const good=vi.fn(async()=>[item(8)]);await execute(ctx,good);expect(good).toHaveBeenCalledTimes(1);
 expect(await ctx.db.select().from(discoverySelections)).toHaveLength(1);
 }finally{await h.close();}
});
