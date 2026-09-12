import {it,expect,vi} from 'vitest';
import {auth,createHarness,seedUser,seedPublishedStory} from './helpers.js';
import {runJob} from '../helpers/run-job.js';
import {reasonSummary} from '../../src/modules/sources/reasons.js';
import {interests} from '../../src/db/schema.js';
import {and,eq} from 'drizzle-orm';
it('counts one active choice per reader, reuses semantic tags, excludes cancelled votes and isolates sources',async()=>{
 const h=await createHarness();
 try{
  const author=await seedUser(h,'author'),a=await seedUser(h,'reader'),b=await seedUser(h,'reader');
  const story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});const id=story.source.id;
  const put=(token:string,body:Record<string,unknown>)=>h.app.inject({method:'PUT',url:`/api/sources/${id}/interest-reason`,headers:auth(token),payload:body});
  expect((await put(a.token,{choice:'journey'})).statusCode).toBe(409);
  for(const r of [a,b])await h.app.inject({method:'PUT',url:`/api/stories/${id}/interest`,headers:auth(r.token),payload:{active:true}});
  expect((await put(a.token,{choice:'journey'})).statusCode).toBe(200);await put(a.token,{choice:'journey'});
  expect((await reasonSummary(h.ctx.db,id)).total).toBe(1);
  expect((await put(b.token,{choice:'other',text:'x'.repeat(21),allow_model_processing:true})).statusCode).toBe(400);
  expect((await put(b.token,{choice:'other',text:'遇到了什么困难'})).statusCode).toBe(400);
  await put(b.token,{choice:'other',text:'遇到了什么困难',allow_model_processing:true});
  Object.assign(h.moduleCtx.env,{LLM_BASE_URL:'http://llm.test/v1',LLM_MODEL:'fixture'});
  let calls=0;vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{"tag":"过程中的转折与经历"}'}}]}));});
  await runJob(h.moduleCtx,'interest.classify');
  expect((await reasonSummary(h.ctx.db,id)).tags).toEqual([{tag:'过程中的转折与经历',count:2,percentage:100}]);
  await put(a.token,{choice:'other',text:'遇到了什么困难',allow_model_processing:true});expect(calls).toBe(1);
  await h.app.inject({method:'PUT',url:`/api/stories/${id}/interest`,headers:auth(b.token),payload:{active:false}});
  expect((await reasonSummary(h.ctx.db,id)).total).toBe(1);
  await h.ctx.db.delete(interests).where(and(eq(interests.readerKey,a.user.id),eq(interests.sourceId,id)));
  expect((await reasonSummary(h.ctx.db,id)).total).toBe(0);
  const other=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});expect((await reasonSummary(h.ctx.db,other.source.id)).tags).toEqual([]);
 }finally{vi.restoreAllMocks();await h.close();}
});
