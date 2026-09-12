import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createHarness, importSource, seedUser, type Harness } from './helpers.js';
import { jobs } from '../../src/db/schema.js';

let h: Harness;
beforeAll(async()=>{h=await createHarness();});
afterAll(async()=>{await h.close();});

it('limits operator source lists to permitted roles and responsible researchers',async()=>{
  const admin=await seedUser(h,'admin'),researcher=await seedUser(h,'researcher'),other=await seedUser(h,'researcher'),reader=await seedUser(h,'reader');
  const own=await importSource(h,researcher.token,{source_type:'researcher_import',original_url:'https://example.test/manage-own',title:'own fixture',material_level:'api_summary',body:'private fixture body'});
  const foreign=await importSource(h,other.token,{source_type:'researcher_import',original_url:'https://example.test/manage-other',title:'other fixture',material_level:'api_summary',body:'foreign private fixture body'});
  const unassigned=await importSource(h,reader.token,{source_type:'third_party_link',original_url:'https://example.test/manage-assigned',title:'assigned fixture',material_level:'api_summary',body:'reader imported fixture'});
  await h.app.inject({method:'POST',url:'/api/cases',headers:auth(researcher.token),payload:{source_id:unassigned.sourceId,launch_type:'reader_initiated'}});
  expect((await h.app.inject({url:'/api/operator/sources'})).statusCode).toBe(401);
  expect((await h.app.inject({url:'/api/operator/sources',headers:auth(reader.token)})).statusCode).toBe(403);
  const scoped=await h.app.inject({url:'/api/operator/sources',headers:auth(researcher.token)});
  expect(scoped.statusCode).toBe(200);
  expect(scoped.json().data.items.map((x:{source_id:string})=>x.source_id).sort()).toEqual([own.sourceId,unassigned.sourceId].sort());
  expect(scoped.body).not.toContain('private fixture body');
  const all=await h.app.inject({url:'/api/operator/sources',headers:auth(admin.token)});
  expect(all.json().data.items.map((x:{source_id:string})=>x.source_id)).toContain(foreign.sourceId);
  expect((await h.app.inject({url:'/api/operator/sources?offset=-1',headers:auth(admin.token)})).statusCode).toBe(400);
});

it('shows only safe failed-task metadata to admins',async()=>{
  const admin=await seedUser(h,'admin'),researcher=await seedUser(h,'researcher');
  const {job}=await h.moduleCtx.jobs.enqueue({kind:'test_fixture.failure',payload:{private_text:'DO_NOT_EXPOSE_PAYLOAD'}});
  await h.ctx.db.update(jobs).set({status:'failed',result:{secret:'DO_NOT_EXPOSE_RESULT'},lastError:'DO_NOT_EXPOSE_ERROR'}).where(eq(jobs.id,job.id));
  expect((await h.app.inject({url:'/api/operator/jobs',headers:auth(researcher.token)})).statusCode).toBe(403);
  const list=await h.app.inject({url:'/api/operator/jobs',headers:auth(admin.token)});
  expect(list.statusCode).toBe(200);expect(list.json().data.items).toHaveLength(1);
  expect(list.json().data.items[0]).toMatchObject({id:job.id,kind:'test_fixture.failure',status:'failed'});
  expect(list.body).not.toContain('DO_NOT_EXPOSE');
  const row=list.json().data.items[0];
  const retry={method:'POST' as const,url:`/api/operator/jobs/${job.id}/retry`,payload:{expected_updated_at:row.updated_at}};
  expect((await h.app.inject({...retry,headers:auth(researcher.token)})).statusCode).toBe(403);
  const restarted=await h.app.inject({...retry,headers:auth(admin.token)});
  expect(restarted.statusCode).toBe(200);expect(restarted.body).not.toContain('DO_NOT_EXPOSE');
  expect(restarted.json().data.job_id).not.toBe(job.id);
  expect((await h.app.inject({...retry,headers:auth(admin.token)})).statusCode).toBe(409);
});
