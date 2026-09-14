import { describe,it,expect } from 'vitest';
import { createHarness } from './helpers.js';
import { createUser, createSession } from '../../src/modules/identity/service.js';
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
 it('mints a local admin session without a login token body',async()=>{
  const h=await createHarness();
  try {
   h.ctx.env.LOCAL_DEMO_LOGIN=true;
   h.ctx.env.PUBLIC_BASE_URL='http://127.0.0.1:5174';
   const res=await h.app.inject({method:'POST',url:'/api/auth/demo/admin',payload:{}});
   expect(res.statusCode,res.body).toBe(200);
   expect(res.json().data.user.role).toBe('admin');
   expect(res.json().data.user.cohort).toBe('local_demo_fixture');
  }finally{await h.close();}
 });
 it('playground reset rebuilds fixture stories and refuses a real reader',async()=>{
  const h=await createHarness();
  try {
   h.ctx.env.LOCAL_DEMO_LOGIN=true;
   h.ctx.env.PUBLIC_BASE_URL='http://127.0.0.1:5174';
   const ok=await h.app.inject({method:'POST',url:'/api/auth/demo/reset',payload:{}});
   expect(ok.statusCode,ok.body).toBe(200);
   expect(ok.json().data.stories).toBe(3);
   const again=await h.app.inject({method:'POST',url:'/api/auth/demo/reset',payload:{}});
   expect(again.statusCode).toBe(200);
   const outsider=await createUser(h.ctx.db,{role:'reader',cohort:'anonymous_reader'});
   const session=await createSession(h.ctx.db,{userId:outsider.id,ttlSeconds:3600,cohort:outsider.cohort});
   const refused=await h.app.inject({method:'POST',url:'/api/auth/demo/reset',payload:{},headers:{authorization:`Bearer ${session.token}`}});
   expect(refused.statusCode).toBe(403);
  }finally{await h.close();}
 });
});
