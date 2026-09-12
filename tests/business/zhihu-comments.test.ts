import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createHarness, seedUser, seedPublishedStory, auth, type Harness } from './helpers.js';
import { sources, consents, zhihuCommentSyncs } from '../../src/db/schema.js';
import { runJob } from '../helpers/run-job.js';

let h: Harness;
beforeAll(async()=>{h=await createHarness();h.moduleCtx.env.ZHIHU_ACCESS_SECRET='fixture-key';});
afterEach(()=>vi.restoreAllMocks());
afterAll(async()=>{await h.close();});
const comment=(text='旧评论')=>({ID:'2079528466408654123',Type:'comment',Content:text,CreatedAt:1,LikeCount:0,DislikeCount:0});
async function seed(){
  const admin=await seedUser(h,'admin'),author=await seedUser(h,'author');
  const data=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});
  await h.ctx.db.update(sources).set({originalUrl:'https://www.zhihu.com/answer/2079528466408654123'}).where(eq(sources.id,data.source.id));
  return {...data,admin,author};
}
it('deduplicates sync jobs, merges comments by exact ID, and uses the provided cursor even after an empty page',async()=>{
  const s=await seed();const path=`/api/sources/${s.source.id}/zhihu/comments/sync`;
  let request=0;const offsets:string[]=[];
  vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{
    offsets.push(new URL(String(input)).searchParams.get('Offset')!);request++;
    return new Response(JSON.stringify({Code:0,Data:{Items:request===1?[]:[{Comment:comment(request===2?'旧评论':'修改后的评论'),Children:[]}],Paging:request===1?{IsEnd:false,NextOffset:'35'}:{IsEnd:true}}}));
  });
  const one=await h.app.inject({method:'POST',url:path,headers:auth(s.admin.token)});
  const two=await h.app.inject({method:'POST',url:path,headers:auth(s.admin.token)});
  expect(one.json().data.job_id).toBe(two.json().data.job_id);
  await runJob(h.moduleCtx,'zhihu.comments.sync');
  for(let i=0;i<2;i++){await h.app.inject({method:'POST',url:path,headers:auth(s.admin.token)});await runJob(h.moduleCtx,'zhihu.comments.sync');}
  expect(offsets).toEqual(['0','35','35']);
  const read=await h.app.inject({url:`/api/stories/${s.source.id}/comments`});
  expect(read.statusCode).toBe(200);
  expect(read.json().data.items).toHaveLength(1);
  expect(read.json().data.items[0].text).toBe('修改后的评论');
  await h.ctx.db.update(consents).set({status:'revoked'}).where(eq(consents.sourceId,s.source.id));
  expect((await h.app.inject({url:`/api/stories/${s.source.id}/comments`})).statusCode).not.toBe(200);
  await h.ctx.db.delete(sources).where(eq(sources.id,s.source.id));
  expect(await h.ctx.db.select().from(zhihuCommentSyncs).where(eq(zhihuCommentSyncs.sourceId,s.source.id))).toHaveLength(0);
});
it('leaves no half-written page on provider failure',async()=>{
  const s=await seed();vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({Code:30002,Message:'fixture-key'})));
  await h.app.inject({method:'POST',url:`/api/sources/${s.source.id}/zhihu/comments/sync`,headers:auth(s.admin.token)});
  await expect(runJob(h.moduleCtx,'zhihu.comments.sync')).rejects.toMatchObject({code:'quota_exhausted'});
  expect(await h.ctx.db.select().from(zhihuCommentSyncs).where(eq(zhihuCommentSyncs.sourceId,s.source.id))).toHaveLength(0);
});
it('does not repopulate comments when the source is deleted during the official request',async()=>{
  const s=await seed();
  vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{
    await h.ctx.db.update(sources).set({deletedAt:new Date()}).where(eq(sources.id,s.source.id));
    return new Response(JSON.stringify({Code:0,Data:{Items:[{Comment:comment(),Children:[]}],Paging:{IsEnd:true}}}));
  });
  await h.app.inject({method:'POST',url:`/api/sources/${s.source.id}/zhihu/comments/sync`,headers:auth(s.admin.token)});
  await expect(runJob(h.moduleCtx,'zhihu.comments.sync')).rejects.toMatchObject({code:'withdrawn'});
  expect(await h.ctx.db.select().from(zhihuCommentSyncs).where(eq(zhihuCommentSyncs.sourceId,s.source.id))).toHaveLength(0);
});

