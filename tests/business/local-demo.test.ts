import { describe,it,expect } from 'vitest';
import { createHarness } from './helpers.js';
import { createUser, createSession } from '../../src/modules/identity/service.js';
import { FIXTURE_STORIES } from '../../src/modules/identity/playground.js';
import { followupVersions } from '../../src/db/schema.js';
describe('local demo login',()=>{
 it('defaults closed, checks origin and server-owned fixture identity, and preserves account across sessions',async()=>{
  const h=await createHarness();
  try {
   const req={method:'POST' as const,url:'/api/auth/demo/reader',payload:{}};
   expect((await h.app.inject(req)).statusCode).toBe(404);
   h.ctx.env.LOCAL_DEMO_LOGIN=true;
   h.ctx.env.PUBLIC_BASE_URL='http://127.0.0.1:5174';
   expect((await h.app.inject({...req,headers:{origin:'https://other.example'}})).statusCode).toBe(403);
   expect((await h.app.inject({...req,payload:{role:'admin'}})).statusCode).toBe(400);
   const first=await h.app.inject(req),second=await h.app.inject(req);
   expect(first.statusCode).toBe(200);expect(second.json().data.user.id).toBe(first.json().data.user.id);
   expect(second.json().data.session_token).not.toBe(first.json().data.session_token);
   expect(first.headers['cache-control']).toBe('no-store');
   h.ctx.env.PUBLIC_BASE_URL='https://public.example';
   expect((await h.app.inject(req)).statusCode).toBe(404);
  }finally{await h.close();}
 });
 it('mints a local admin session only with the console password',async()=>{
  const h=await createHarness();
  try {
   h.ctx.env.LOCAL_DEMO_LOGIN=true;
   h.ctx.env.PUBLIC_BASE_URL='http://127.0.0.1:5174';
   expect((await h.app.inject({method:'POST',url:'/api/auth/demo/admin',payload:{}})).statusCode).toBe(400);
   expect((await h.app.inject({method:'POST',url:'/api/auth/demo/admin',payload:{password:'wrong-password'}})).statusCode).toBe(401);
   const res=await h.app.inject({method:'POST',url:'/api/auth/demo/admin',payload:{password:'QAZWSXEDCRFVTGB..1'}});
   expect(res.statusCode,res.body).toBe(200);
   expect(res.json().data.user.role).toBe('admin');
   expect(res.json().data.user.cohort).toBe('local_demo_fixture');
  }finally{await h.close();}
 });
 it('serves the demo accounts on a public review host only with the explicit opt-in',async()=>{
  const h=await createHarness();
  try {
   const req={method:'POST' as const,url:'/api/auth/demo/reader',payload:{}};
   h.ctx.env.LOCAL_DEMO_LOGIN=true;
   h.ctx.env.PUBLIC_BASE_URL='https://39.105.229.217';
   // The public host stays closed even with the local flag on, so switching the flag on a
   // laptop can never expose the demo accounts on a deployed site by itself.
   expect((await h.app.inject(req)).statusCode).toBe(404);
   expect((await h.app.inject({url:'/api/auth/demo/status'})).json().data.enabled).toBe(false);
   h.ctx.env.PUBLIC_DEMO_LOGIN=true;
   expect((await h.app.inject({url:'/api/auth/demo/status'})).json().data.enabled).toBe(true);
   expect((await h.app.inject(req)).statusCode).toBe(200);
   h.ctx.env.LOCAL_DEMO_LOGIN=false;
   expect((await h.app.inject(req)).statusCode).toBe(404);
  }finally{await h.close();}
 });
 it('seeds the demo samples on login so a reviewer never lands in an empty workspace',async()=>{
  const h=await createHarness();
  try {
   h.ctx.env.LOCAL_DEMO_LOGIN=true;
   h.ctx.env.PUBLIC_BASE_URL='http://127.0.0.1:5174';
   const login=await h.app.inject({method:'POST',url:'/api/auth/demo/reader',payload:{}});
   expect(login.statusCode,login.body).toBe(200);
   const following=await h.app.inject({url:'/api/me/following',headers:{authorization:`Bearer ${login.json().data.session_token}`}});
   const items=following.json().data.items as Array<{source_id:string;update:{status:string}|null}>;
   expect(items).toHaveLength(FIXTURE_STORIES.length);
   const finished=items.filter(item=>item.update?.status==='published');
   expect(finished.length).toBeGreaterThan(0);
   // The finished sample is readable end to end and the reader received the notification.
   const story=await h.app.inject({url:`/api/stories/${finished[0]!.source_id}`});
   const versionId=story.json().data.story.published_followup?.version_id;
   expect(versionId).toBeTruthy();
   expect((await h.app.inject({url:`/api/followups/${versionId}`})).statusCode).toBe(200);
   const notices=await h.app.inject({url:'/api/me/notifications',headers:{authorization:`Bearer ${login.json().data.session_token}`}});
   expect(notices.json().data.items.length).toBeGreaterThan(0);
   // Idempotent: logging in again adds nothing and keeps what is already there.
   const again=await h.app.inject({method:'POST',url:'/api/auth/demo/reader',payload:{}});
   expect(again.statusCode).toBe(200);
   const after=await h.app.inject({url:'/api/me/following',headers:{authorization:`Bearer ${again.json().data.session_token}`}});
   expect(after.json().data.items).toHaveLength(FIXTURE_STORIES.length);
   const published=await h.ctx.db.select().from(followupVersions);
   expect(published.filter(row=>row.status==='published')).toHaveLength(finished.length);
  }finally{await h.close();}
 });
 it('playground reset rebuilds fixture stories and refuses a real reader',async()=>{
  const h=await createHarness();
  try {
   h.ctx.env.LOCAL_DEMO_LOGIN=true;
   h.ctx.env.PUBLIC_BASE_URL='http://127.0.0.1:5174';
   const ok=await h.app.inject({method:'POST',url:'/api/auth/demo/reset',payload:{}});
   expect(ok.statusCode,ok.body).toBe(200);
   expect(ok.json().data.stories).toBe(FIXTURE_STORIES.length);
   const reader=await h.app.inject({method:'POST',url:'/api/auth/demo/reader',payload:{}});
   const following=await h.app.inject({url:'/api/me/following',headers:{authorization:`Bearer ${reader.json().data.session_token}`}});
   expect(following.json().data.items).toHaveLength(FIXTURE_STORIES.length);
   expect(following.json().data.items.every((item:{available:boolean})=>item.available)).toBe(true);
   const again=await h.app.inject({method:'POST',url:'/api/auth/demo/reset',payload:{}});
   expect(again.statusCode).toBe(200);
   const outsider=await createUser(h.ctx.db,{role:'reader',cohort:'anonymous_reader'});
   const session=await createSession(h.ctx.db,{userId:outsider.id,ttlSeconds:3600,cohort:outsider.cohort});
   const refused=await h.app.inject({method:'POST',url:'/api/auth/demo/reset',payload:{},headers:{authorization:`Bearer ${session.token}`}});
   expect(refused.statusCode).toBe(403);
  }finally{await h.close();}
 });
});
