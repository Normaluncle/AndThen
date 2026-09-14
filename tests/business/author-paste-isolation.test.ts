import {it,expect} from 'vitest';
import {createHarness,seedUser,auth} from './helpers.js';
it('keeps two authors same-title pasted materials separate and deduplicates each owner replay',async()=>{
 const h=await createHarness();try{
 const a=await seedUser(h,'author'),b=await seedUser(h,'author');
 const body={source_type:'author_paste',title:'【test_fixture】同名回答',material_level:'exact_excerpt',excerpt:'【test_fixture】我的独立经历',excerpt_location:'fixture',provenance:'test_fixture'};
 const create=(token:string)=>h.app.inject({method:'POST',url:'/api/sources',headers:auth(token),payload:body});
 const first=await create(a.token),second=await create(b.token),replay=await create(a.token);
 expect(first.statusCode).toBe(200);expect(second.statusCode).toBe(200);
 expect(first.json().data.source_id).not.toBe(second.json().data.source_id);
 expect(first.json().data.source_id).toBe(replay.json().data.source_id);
 }finally{await h.close();}
});
