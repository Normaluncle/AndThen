import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createHarness, seedUser, seedPublishedStory, auth, type Harness } from './helpers.js';
import { authorMemories, consents, followupVersions, jobs, type AuthorMemoryRecord } from '../../src/db/schema.js';
import { recallMemory, requestRefresh } from '../../src/modules/memory/service.js';
import { seedMaintenance } from '../../src/modules/followups/maintenance.js';
import { runJob } from '../helpers/run-job.js';

let h: Harness;
beforeAll(async()=>{h=await createHarness();Object.assign(h.moduleCtx.env,{MEMORY_SERVICE_URL:'http://memory.test',MEMORY_SERVICE_TOKEN:'fixture',LLM_BASE_URL:'http://llm.test/v1',LLM_MODEL:'fixture',LLM_MAX_RETRIES:0});});
afterEach(()=>vi.restoreAllMocks());
afterAll(async()=>{await h.close();});
async function seed(){
 const author=await seedUser(h,'author');
 const story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true,excerpt:'测试材料：八个月后找到工作，不讨论工资。'});
 await h.ctx.db.insert(consents).values(['private_interview','external_model_processing'].map(purpose=>({userId:author.user.id,sourceId:story.source.id,purpose:purpose as 'private_interview'|'external_model_processing'})));
 return {author,story};
}
function record(s: Awaited<ReturnType<typeof seed>>,index:number,preference=false):AuthorMemoryRecord {
 return {name:'fixture-'+index,description:'记忆',content:preference?'不讨论工资':'八个月后找到工作',preference,evidenceText:preference?'不讨论工资':'八个月后找到工作',sourceId:s.story.source.id,snapshotId:s.story.snapshot.id,contentHash:s.story.snapshot.contentHash};
}
it('loads every explicit boundary separately from five semantic hits, even if vector retrieval fails',async()=>{
 const s=await seed(),generation=randomUUID();const preferences=Array.from({length:7},(_,i)=>record(s,i,true));const fact=record(s,8);
 await h.ctx.db.insert(authorMemories).values({userId:s.author.user.id,enabled:true,status:'ready',generation,records:[...preferences,fact]});
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({files:[{name:fact.name,score:1}]})));
 const result=await recallMemory(h.moduleCtx,s.author.user.id,'工作');
 expect(result.preferences).toHaveLength(7);expect(result.records).toEqual([fact]);
 vi.mocked(fetch).mockResolvedValue(new Response('',{status:503}));
 const failed=await recallMemory(h.moduleCtx,s.author.user.id,'工作');
 expect(failed.status).toBe('unavailable');expect(failed.preferences).toHaveLength(7);expect(failed.records).toEqual([]);
});
it('hides superseded confirmation-derived memories on both the page and recall',async()=>{
 const s=await seed();const r={...record(s,1),confirmedVersionId:s.story.versionId};
 await h.ctx.db.insert(authorMemories).values({userId:s.author.user.id,enabled:true,status:'ready',records:[r]});
 await h.ctx.db.update(followupVersions).set({status:'withdrawn'}).where(eq(followupVersions.id,s.story.versionId));
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({files:[{name:r.name,score:1}]})));
 expect((await recallMemory(h.moduleCtx,s.author.user.id,'工作')).records).toEqual([]);
 const page=await h.app.inject({url:'/api/me/memory',headers:auth(s.author.token)});
 expect(page.json().data.records).toEqual([]);
});
it('reuses unchanged material without another model/index call and refreshes its check timestamp',async()=>{
 const s=await seed();let llmCalls=0,indexCalls=0;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,options)=>{
  if(String(input).includes('llm.test')){llmCalls++;const text=JSON.parse(String(options?.body)).messages[1].content as string;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:[{summary:'测试摘要',quote:text.slice(0,10),preference:false}]})}}]}));}
  if(options?.method==='PUT')indexCalls++;
  return new Response('{}');
 });
 await h.app.inject({method:'PUT',url:'/api/me/memory/consent',headers:auth(s.author.token),payload:{enabled:true}});
 await runJob(h.moduleCtx,'memory.refresh');
 // seedPublishedStory includes a confirmed version, so both source + confirmation are processed once.
 const beforeCalls=llmCalls;expect(beforeCalls).toBe(2);expect(indexCalls).toBe(1);
 const [before]=await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId,s.author.user.id));
 await h.ctx.db.update(authorMemories).set({updatedAt:new Date(0)}).where(eq(authorMemories.userId,s.author.user.id));
 await requestRefresh(h.moduleCtx,s.author.user.id);await runJob(h.moduleCtx,'memory.refresh');
 const [after]=await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId,s.author.user.id));
 expect(llmCalls).toBe(beforeCalls);expect(indexCalls).toBe(1);expect(after!.generation).toBe(before!.generation);expect(after!.updatedAt.getTime()).toBeGreaterThan(0);
});
it('revocation during index build prevents activation and schedules cleanup of the provisional index',async()=>{
 const s=await seed();await h.ctx.db.update(followupVersions).set({status:'withdrawn'}).where(eq(followupVersions.id,s.story.versionId));
 let provisional:string|undefined;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,options)=>{
  if(String(input).includes('llm.test'))return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:[{summary:'工作',quote:'八个月后找到工作',preference:false}]})}}]}));
  if(options?.method==='PUT'){
    provisional=String(input).split('/').at(-1);
    await h.app.inject({method:'PUT',url:'/api/me/memory/consent',headers:auth(s.author.token),payload:{enabled:false}});
  }
  return new Response('{}');
 });
 await h.app.inject({method:'PUT',url:'/api/me/memory/consent',headers:auth(s.author.token),payload:{enabled:true}});
 await runJob(h.moduleCtx,'memory.refresh');
 const [profile]=await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId,s.author.user.id));
 expect(profile!.enabled).toBe(false);expect(profile!.records).toEqual([]);
 const cleanup=await h.ctx.db.select().from(jobs).where(eq(jobs.kind,'memory.delete'));
 expect(cleanup.some(x=>x.payload.generation===provisional)).toBe(true);
});

it('scheduled consent expiry invalidates memory immediately and queues physical index cleanup',async()=>{
 const s=await seed(),generation=randomUUID();
 await h.ctx.db.insert(authorMemories).values({userId:s.author.user.id,enabled:true,status:'ready',generation,records:[record(s,1)]});
 await h.ctx.db.update(consents).set({expiresAt:new Date(0)}).where(eq(consents.sourceId,s.story.source.id));
 expect((await recallMemory(h.moduleCtx,s.author.user.id,'工作')).records).toEqual([]);
 await seedMaintenance(h.moduleCtx);await runJob(h.moduleCtx,'maintenance.consents');
 const [profile]=await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId,s.author.user.id));
 expect(profile!.generation).not.toBe(generation);expect(profile!.records).toEqual([]);
 const cleanup=await h.ctx.db.select().from(jobs).where(eq(jobs.kind,'memory.delete'));
 expect(cleanup.some(x=>x.payload.generation===generation)).toBe(true);
});

it('author return after 24 hours schedules one refresh while keeping existing memory available',async()=>{
 const s=await seed();await h.ctx.db.insert(authorMemories).values({userId:s.author.user.id,enabled:true,status:'ready',records:[record(s,1)],updatedAt:new Date(0)});
 for(let i=0;i<2;i++)expect((await h.app.inject({url:'/api/me/workbench',headers:auth(s.author.token)})).statusCode).toBe(200);
 const pending=await h.ctx.db.select().from(jobs).where(eq(jobs.kind,'memory.refresh'));
 expect(pending.filter(x=>x.payload.user_id===s.author.user.id&&x.status==='queued')).toHaveLength(1);
 const [profile]=await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId,s.author.user.id));
 expect(profile!.status).toBe('ready');expect(profile!.records).toHaveLength(1);
});
