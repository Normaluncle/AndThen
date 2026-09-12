import { beforeAll,afterAll,afterEach,it,expect,vi } from 'vitest';
import { and,eq } from 'drizzle-orm';
import { auth,createHarness,seedUser,type Harness } from './helpers.js';
import { authorMemories,authorVerifications,consents,discoveryCandidates,interests,jobs,sourcePreparations,sourceSnapshots,users } from '../../src/db/schema.js';
import { runJob } from '../helpers/run-job.js';
import { requestRefresh } from '../../src/modules/memory/service.js';
import { storeCandidates } from '../../src/modules/zhihu/discovery.js';

let h:Harness;
beforeAll(async()=>{h=await createHarness();Object.assign(h.moduleCtx.env,{ZHIHU_ACCESS_SECRET:'fixture',MEMORY_SERVICE_URL:'http://memory.test',MEMORY_SERVICE_TOKEN:'fixture',LLM_BASE_URL:'http://llm.test/v1',LLM_MODEL:'fixture'});});
afterEach(()=>vi.restoreAllMocks());
afterAll(async()=>{await h.close();});
it('prepares only followed official material once and adopts it only after verified author consent',async()=>{
 const reader=await seedUser(h,'reader'),reader2=await seedUser(h,'reader'),author=await seedUser(h,'author'),other=await seedUser(h,'author'),admin=await seedUser(h,'admin');
 for(const person of [author,other])await h.ctx.db.update(users).set({displayName:'同名测试作者'}).where(eq(users.id,person.user.id));
 let llmCalls=0;const indexOwners:string[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,options)=>{
  const url=String(input);
  if(url.includes('developer.zhihu.com'))return new Response(JSON.stringify({Code:0,Data:{Items:[1,2].map(id=>({Url:`https://www.zhihu.com/answer/${id}`,Title:'测试官方摘要'+id,ContentText:'测试资料：学习八个月后找到工作。',AuthorName:'同名测试作者'}))}}));
  if(url.includes('llm.test')){llmCalls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:[{summary:'八个月后找到工作',quote:'学习八个月后找到工作',preference:false}]})}}]}));}
  if(options?.method==='PUT')indexOwners.push(new URL(url).pathname.split('/')[2]!);
  return new Response('{}');
 });
 const search=await h.app.inject({url:'/api/discovery/search?q=fixture',headers:auth(reader.token)});
 expect(search.statusCode).toBe(200);const [candidate,otherCandidate]=search.json().data.items;
 expect(candidate.candidate_id).toBeTruthy();
 expect(await h.ctx.db.select().from(sourcePreparations)).toHaveLength(0);expect(llmCalls).toBe(0);
 const endpoint=`/api/discovery/candidates/${candidate.candidate_id}/interest`;
 expect((await h.app.inject({method:'PUT',url:endpoint,headers:auth(reader.token),payload:{active:true,text:'forged'}})).statusCode).toBe(400);
 const first=await h.app.inject({method:'PUT',url:endpoint,headers:auth(reader.token),payload:{active:true}});
 expect(first.statusCode).toBe(200);const sourceId=first.json().data.source_id;
 for(const token of [reader.token,reader2.token])expect((await h.app.inject({method:'PUT',url:endpoint,headers:auth(token),payload:{active:true}})).statusCode).toBe(200);
 expect(await h.ctx.db.select().from(interests).where(eq(interests.sourceId,sourceId))).toHaveLength(2);
 expect(await h.ctx.db.select().from(jobs).where(eq(jobs.kind,'memory.prepare'))).toHaveLength(1);
 await runJob(h.moduleCtx,'memory.prepare');expect(llmCalls).toBe(1);expect(indexOwners).toEqual([sourceId]);
 const [prepared]=await h.ctx.db.select().from(sourcePreparations).where(eq(sourcePreparations.sourceId,sourceId));
 expect(prepared!.status).toBe('ready');expect(await h.ctx.db.select().from(authorMemories)).toHaveLength(0);
 const unselected=await h.ctx.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id,otherCandidate.candidate_id));expect(unselected[0]!.sourceId).toBeNull();
 const following=await h.app.inject({url:'/api/discovery/following',headers:auth(reader2.token)});expect(following.json().data.items).toHaveLength(1);
 // A login or a matching display name alone cannot adopt the post's preparation.
 await h.app.inject({method:'PUT',url:'/api/me/memory/consent',headers:auth(other.token),payload:{enabled:true}});await runJob(h.moduleCtx,'memory.refresh');
 expect((await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId,other.user.id)))[0]!.records).toEqual([]);
 await h.ctx.db.insert(authorVerifications).values({sourceId,userId:author.user.id,status:'verified',method:'manual',verifierUserId:admin.user.id,evidenceRef:'fixture://verified-owner'});
 await h.app.inject({method:'PUT',url:'/api/me/memory/consent',headers:auth(author.token),payload:{enabled:true}});await runJob(h.moduleCtx,'memory.refresh');
 expect((await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId,author.user.id)))[0]!.records).toEqual([]);
 await h.ctx.db.insert(consents).values(['private_interview','external_model_processing'].map(purpose=>({sourceId,userId:author.user.id,purpose:purpose as 'private_interview'|'external_model_processing'})));
 await requestRefresh(h.moduleCtx,author.user.id);await runJob(h.moduleCtx,'memory.refresh');
 const [memory]=await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId,author.user.id));
 expect(memory!.records).toEqual(prepared!.records);expect(llmCalls).toBe(1);
 expect(indexOwners.at(-1)).toBe(author.user.id);
 await h.app.inject({method:'PUT',url:endpoint,headers:auth(reader.token),payload:{active:false}});
 expect((await h.app.inject({url:'/api/discovery/following',headers:auth(reader.token)})).json().data.items).toEqual([]);
 await h.app.inject({method:'DELETE',url:`/api/sources/${sourceId}`,headers:auth(admin.token)});
 const cleanup=await h.ctx.db.select().from(jobs).where(eq(jobs.kind,'memory.delete'));
 expect(cleanup.some(x=>x.payload.user_id===sourceId&&x.payload.generation===prepared!.generation)).toBe(true);
});

it('discards preparation after consent revocation during index storage and does not rebuild it on another follow',async()=>{
 const reader=await seedUser(h,'reader'),author=await seedUser(h,'author'),admin=await seedUser(h,'admin');
 const [candidate]=await storeCandidates(h.moduleCtx,[{url:'https://www.zhihu.com/answer/991',title:'fixture revoke',text:'测试资料：八个月后找到工作。',author_name:'测试',author_avatar:null,author_url:null,material_level:'api_summary',comments:[],comments_coverage:'selected'}]);
 const first=await h.app.inject({method:'PUT',url:`/api/discovery/candidates/${candidate!.candidate_id}/interest`,headers:auth(reader.token),payload:{active:true}});
 const sourceId=first.json().data.source_id;
 await h.ctx.db.insert(authorVerifications).values({sourceId,userId:author.user.id,status:'verified',method:'manual',verifierUserId:admin.user.id,evidenceRef:'fixture://owner'});
 await h.ctx.db.insert(consents).values(['private_interview','external_model_processing'].map(purpose=>({sourceId,userId:author.user.id,purpose:purpose as 'private_interview'|'external_model_processing'})));
 const [before]=await h.ctx.db.select().from(sourcePreparations).where(eq(sourcePreparations.sourceId,sourceId));
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,options)=>{
  if(String(input).includes('llm.test'))return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:[{summary:'八个月后找到工作',quote:'八个月后找到工作',preference:false}]})}}]}));
  if(options?.method==='PUT'){
   const revoked=await h.app.inject({method:'DELETE',url:`/api/sources/${sourceId}/consents/external_model_processing`,headers:auth(author.token)});
   expect(revoked.statusCode).toBe(200);
  }
  return new Response('{}');
 });
 await expect(runJob(h.moduleCtx,'memory.prepare')).rejects.toThrow();
 const [after]=await h.ctx.db.select().from(sourcePreparations).where(eq(sourcePreparations.sourceId,sourceId));
 expect(after!.status).toBe('invalidated');expect(after!.records).toEqual([]);expect(after!.generation).not.toBe(before!.generation);
 const repeated=await h.app.inject({method:'PUT',url:`/api/discovery/candidates/${candidate!.candidate_id}/interest`,headers:auth(reader.token),payload:{active:true}});
 expect(repeated.statusCode).toBe(200);
 const preparationJobs=await h.ctx.db.select().from(jobs).where(eq(jobs.kind,'memory.prepare'));
 expect(preparationJobs.filter(j=>j.payload.source_id===sourceId)).toHaveLength(1);
 expect((await h.ctx.db.select().from(jobs).where(eq(jobs.kind,'memory.delete'))).some(j=>j.payload.generation===before!.generation)).toBe(true);
});

it('marks a partial index failure as error, retries with a new generation, and invalidates it when material changes',async()=>{
 const reader=await seedUser(h,'reader');
 const [candidate]=await storeCandidates(h.moduleCtx,[{url:'https://www.zhihu.com/answer/992',title:'fixture retry',text:'测试：经历八个月。',author_name:'测试',author_avatar:null,author_url:null,material_level:'api_summary',comments:[],comments_coverage:'selected'}]);
 const endpoint=`/api/discovery/candidates/${candidate!.candidate_id}/interest`;
 const first=await h.app.inject({method:'PUT',url:endpoint,headers:auth(reader.token),payload:{active:true}});
 const sourceId=first.json().data.source_id;
 let failIndex=true;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,options)=>{
  if(String(input).includes('llm.test'))return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:[{summary:'经历八个月',quote:'经历八个月',preference:false}]})}}]}));
  if(options?.method==='PUT'&&failIndex)throw new Error('fixture interrupted after provisional index write');
  return new Response('{}');
 });
 await expect(runJob(h.moduleCtx,'memory.prepare')).rejects.toThrow('fixture interrupted');
 const [failed]=await h.ctx.db.select().from(sourcePreparations).where(eq(sourcePreparations.sourceId,sourceId));expect(failed!.status).toBe('error');expect(failed!.records).toEqual([]);
 // The test runner does not transition failures like the real worker. A new
 // generation can queue, but cannot run until the prior owner's lease is released.
 failIndex=false;
 expect((await h.app.inject({method:'PUT',url:endpoint,headers:auth(reader.token),payload:{active:true}})).statusCode).toBe(200);
 expect(await h.moduleCtx.jobs.claim({workerId:'fixture-overlap',leaseSeconds:60,kinds:['memory.prepare']})).toBeNull();
 const oldClaim=(await h.ctx.db.select().from(jobs).where(eq(jobs.kind,'memory.prepare'))).find(j=>j.payload.generation===failed!.generation)!;
 await h.ctx.db.update(jobs).set({status:'failed',leaseOwner:null,leaseExpiresAt:null}).where(eq(jobs.id,oldClaim.id));
 await runJob(h.moduleCtx,'memory.prepare');
 const [ready]=await h.ctx.db.select().from(sourcePreparations).where(eq(sourcePreparations.sourceId,sourceId));expect(ready!.status).toBe('ready');expect(ready!.generation).not.toBe(failed!.generation);
 const changed=await h.app.inject({method:'POST',url:'/api/sources',headers:auth(reader.token),payload:{source_type:'third_party_link',original_url:candidate!.url,title:'fixture retry',material_level:'api_summary',body:'测试：已修正为九个月。',provenance:'test_fixture'}});
 expect(changed.statusCode).toBe(200);
 expect((await h.ctx.db.select().from(sourcePreparations).where(eq(sourcePreparations.sourceId,sourceId)))[0]!.status).toBe('invalidated');
 const snapshots=await h.ctx.db.select().from(sourceSnapshots).where(eq(sourceSnapshots.sourceId,sourceId));expect(snapshots).toHaveLength(2);
 await h.app.inject({method:'PUT',url:endpoint,headers:auth(reader.token),payload:{active:true}});
 expect((await h.ctx.db.select().from(sourcePreparations).where(eq(sourcePreparations.sourceId,sourceId)))[0]!.status).toBe('invalidated');
 await h.ctx.db.update(jobs).set({status:'cancelled'}).where(and(eq(jobs.kind,'memory.prepare'),eq(jobs.status,'running')));
});
