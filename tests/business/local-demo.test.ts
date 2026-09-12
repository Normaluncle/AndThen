import { describe,it,expect } from 'vitest';
import { createHarness } from './helpers.js';
import { users } from '../../src/db/schema.js';
import { DEMO_ACCOUNTS } from '../../src/modules/identity/local-demo.js';
describe('local demo login',()=>{
 it('defaults closed, checks origin and server-owned fixture identity, and preserves account across sessions',async()=>{
  const h=await createHarness();
  try {
   const req={method:'POST' as const,url:'/api/auth/demo/reader',payload:{}};
   expect((await h.app.inject(req)).statusCode).toBe(404);
   h.ctx.env.LOCAL_DEMO_LOGIN=true;
   h.ctx.env.PUBLIC_BASE_URL='http://127.0.0.1:5174';
   expect((await h.app.inject(req)).statusCode).toBe(403);
   await h.ctx.db.insert(users).values({id:DEMO_ACCOUNTS[0].id,role:'reader',cohort:'local_demo_fixture',displayName:'演示读者'});
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
});
