import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {eq} from 'drizzle-orm';
import {sources,notifications} from '../../src/db/schema.js';
import {auth,createHarness,seedUser,seedPublishedStory} from './helpers.js';

it('keeps native counts separate, deduplicates actions, enforces identity and public visibility',async()=>{
 const h=await createHarness();try{
  const author=await seedUser(h,'author'),reader=await seedUser(h,'reader'),other=await seedUser(h,'reader');
  const story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});const id=story.source.id;
  const call=(method:'GET'|'POST'|'PUT'|'DELETE',url:string,payload?:unknown,token=reader.token)=>h.app.inject({method,url:'/api'+url,headers:auth(token),...(payload?{payload:payload as Record<string,unknown>}:{})});
  expect((await h.app.inject({method:'PUT',url:`/api/stories/${id}/community`,payload:{liked:true}})).statusCode).toBe(401);
  expect((await call('PUT',`/stories/${id}/community`,{liked:true,user_id:other.user.id})).statusCode).toBe(400);
  await Promise.all([call('PUT',`/stories/${id}/community`,{liked:true}),call('PUT',`/stories/${id}/community`,{liked:true})]);
  await call('PUT',`/stories/${id}/community`,{saved:true});
  let summary=(await call('GET',`/me/stories/${id}/community`)).json().data;expect(summary.likes).toBe(1);expect(summary.saves).toBe(1);expect(summary.comments).toBe(0);expect(summary.liked).toBe(true);
  const body={body:'本站测试评论',client_message_id:randomUUID(),confirms_publication:true};
  const comment=(await call('POST',`/stories/${id}/site-comments`,body)).json().data;
  expect((await call('POST',`/stories/${id}/site-comments`,body)).json().data.id).toBe(comment.id);
  expect((await call('POST',`/stories/${id}/site-comments`,{...body,body:'不同正文'})).statusCode).toBe(409);
  expect((await call('DELETE',`/site-comments/${comment.id}`,undefined,other.token)).statusCode).toBe(403);
  expect((await call('GET','/me/saved-stories')).json().data.items[0].source_id).toBe(id);
  expect((await call('GET','/me/saved-stories',undefined,other.token)).json().data.items).toEqual([]);
  const report={reason:'测试举报',client_message_id:randomUUID()};expect((await call('POST',`/stories/${id}/reports`,report)).statusCode).toBe(200);
  expect((await call('GET','/admin/site-reports')).statusCode).toBe(403);
  const admin=await seedUser(h,'admin');
  const receipt=(await call('POST',`/stories/${id}/reports`,report)).json().data;
  expect((await call('POST',`/stories/${id}/reports`,{...report,reason:'different reason'})).statusCode).toBe(409);
  expect((await call('GET','/admin/site-reports',undefined,admin.token)).json().data.items.map((r:{id:string})=>r.id)).toEqual([receipt.id]);
  await call('PUT',`/stories/${id}/community`,{liked:false,saved:false});
  await call('DELETE',`/site-comments/${comment.id}`);
  summary=(await call('GET',`/me/stories/${id}/community`)).json().data;expect([summary.likes,summary.saves,summary.comments]).toEqual([0,0,0]);
  await h.ctx.db.update(sources).set({permissionStatus:'revoked'}).where(eq(sources.id,id));
  expect((await call('GET',`/stories/${id}/community`)).statusCode).toBe(404);
  expect((await call('PUT',`/stories/${id}/community`,{liked:true})).statusCode).toBe(404);
 }finally{await h.close();}
});

it('searches only licensed internal stories and accepts date/sort pagination',async()=>{
 const h=await createHarness();try{
  const author=await seedUser(h,'author');const one=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});
  await h.ctx.db.update(sources).set({title:'职业选择独立开发'}).where(eq(sources.id,one.source.id));
  const two=await seedPublishedStory(h,{author:author.user,verifyAuthor:true,publishedAt:new Date('2023-06-01T00:00:00Z')});
  expect((await h.app.inject({url:'/api/stories?from=2022-01-01&to=2023-12-31'})).json().data.items.map((i:{source_id:string})=>i.source_id)).toEqual([two.source.id]);
  expect((await h.app.inject({url:'/api/stories?sort=oldest&limit=1&offset=1'})).json().data.items[0].source_id).toBe(two.source.id);
  const query=(q:string)=>h.app.inject({url:'/api/stories?limit=10&sort=newest&q='+encodeURIComponent(q)});
  expect((await query('职业选择')).json().data.total).toBe(1);
  expect((await query('不匹配')).json().data.total).toBe(0);
  expect((await h.app.inject({url:'/api/stories?from=not-a-date'})).statusCode).toBe(400);
  await h.ctx.db.update(sources).set({permissionStatus:'revoked'}).where(eq(sources.id,one.source.id));
  expect((await query('职业选择')).json().data.total).toBe(0);
 }finally{await h.close();}
});

it('reader activity erasure clears native interactions without deleting stories or another reader comments',async()=>{
 const h=await createHarness();try{const author=await seedUser(h,'author'),reader=await seedUser(h,'reader'),other=await seedUser(h,'reader');const story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});
 const write=(token:string,path:string,payload:Record<string,unknown>,method:'POST'|'PUT'='POST')=>h.app.inject({method,url:'/api'+path,headers:auth(token),payload});
 await write(reader.token,`/stories/${story.source.id}/community`,{liked:true,saved:true},'PUT');
 for(const token of [reader.token,other.token])await write(token,`/stories/${story.source.id}/site-comments`,{body:'测试评论',confirms_publication:true,client_message_id:randomUUID()});
 expect((await write(reader.token,'/me/data-deletion',{scope:'reader_activity',confirms_deletion:true,idempotency_key:randomUUID()})).statusCode).toBe(200);
 const data=(await h.app.inject({url:`/api/stories/${story.source.id}/community`})).json().data;expect([data.likes,data.saves,data.comments]).toEqual([0,0,1]);
 }finally{await h.close();}
});

it('supports in-story replies and anonymous product feedback without granting reader identity',async()=>{
 const h=await createHarness();try{const author=await seedUser(h,'author'),reader=await seedUser(h,'reader'),admin=await seedUser(h,'admin');const story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});
 const post=(source:string,body:Record<string,unknown>)=>h.app.inject({method:'POST',url:`/api/stories/${source}/site-comments`,headers:auth(reader.token),payload:body});
 const parent=(await post(story.source.id,{body:'父评论',client_message_id:randomUUID(),confirms_publication:true})).json().data;
 expect((await post(story.source.id,{body:'@本站读者 回复 🙂',client_message_id:randomUUID(),reply_to:parent.id,confirms_publication:true})).statusCode).toBe(200);
 const community=(await h.app.inject({url:`/api/stories/${story.source.id}/community`})).json().data;expect(community.items[0].reply_to).toBe(parent.id);expect(community.items[0].reply_body).toBe('父评论');
 const other=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});expect((await post(other.source.id,{body:'wrong source',client_message_id:randomUUID(),reply_to:parent.id,confirms_publication:true})).statusCode).toBe(404);
 const payload={body:'测试界面反馈',category:'interface',page:'/?screen=02&story=career',client_message_id:randomUUID()};
 const send=()=>h.app.inject({method:'POST',url:'/api/feedback',payload});const receipt=(await send()).json().data;expect((await send()).json().data.id).toBe(receipt.id);
 expect((await h.app.inject({url:'/api/admin/feedback'})).statusCode).toBe(401);expect((await h.app.inject({url:'/api/admin/feedback',headers:auth(admin.token)})).json().data.items[0].id).toBe(receipt.id);
 expect((await h.app.inject({url:'/api/discovery/search?q=test'})).statusCode).toBe(503);
 }finally{await h.close();}
});

it('notification titles follow public visibility and never expose another reader notifications',async()=>{
 const h=await createHarness();try{const author=await seedUser(h,'author'),reader=await seedUser(h,'reader'),other=await seedUser(h,'reader');const story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});
 await h.ctx.db.insert(notifications).values({readerKey:reader.user.id,caseId:story.followupCase.id,followupVersionId:story.versionId});
 const list=(token:string)=>h.app.inject({url:'/api/me/notifications',headers:auth(token)});
 expect((await list(reader.token)).json().data.items[0].title).toBe(story.source.title);expect((await list(other.token)).json().data.items).toEqual([]);
 await h.ctx.db.update(sources).set({permissionStatus:'revoked'}).where(eq(sources.id,story.source.id));
 const response=await list(reader.token);expect(response.statusCode).toBe(200);expect(response.json().data.items[0].title).toBe('故事暂不可用');
 }finally{await h.close();}
});

it('persists reading history per account, deduplicates it and projects native counts to discovery',async()=>{
 const h=await createHarness();try{const author=await seedUser(h,'author'),reader=await seedUser(h,'reader'),other=await seedUser(h,'reader');const story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});const source=story.source.id;
 const call=(method:'GET'|'PUT'|'POST',path:string,payload?:Record<string,unknown>,token=reader.token)=>h.app.inject({method,url:'/api'+path,headers:auth(token),...(payload?{payload}:{})});
 expect((await h.app.inject({method:'PUT',url:`/api/stories/${source}/read`,payload:{}})).statusCode).toBe(401);
 await call('PUT',`/stories/${source}/read`,{});await call('PUT',`/stories/${source}/read`,{});expect((await call('GET','/me/history')).json().data.items).toHaveLength(1);expect((await call('GET','/me/history',undefined,other.token)).json().data.items).toEqual([]);
 await call('PUT',`/stories/${source}/community`,{liked:true,saved:true});expect((await h.app.inject({url:`/api/stories/${source}`})).json().data.story.site_counts).toEqual([1,0,1]);
 await call('POST','/me/data-deletion',{scope:'reader_activity',confirms_deletion:true,idempotency_key:randomUUID()});expect((await call('GET','/me/history')).json().data.items).toEqual([]);
 }finally{await h.close();}
});
