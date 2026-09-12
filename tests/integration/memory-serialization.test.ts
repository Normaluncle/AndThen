import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {createTestContext} from '../helpers/testdb.js';
import {JobQueue} from '../../src/jobs/queue.js';
import {jobs} from '../../src/db/schema.js';

it('serializes memory work per owner across workers and generations while other owners proceed',async()=>{
  const ctx=await createTestContext('memory_serialization');
  try {
    const queues=[new JobQueue(ctx.db,4),new JobQueue(ctx.db,4)];
    const owner=randomUUID(),other=randomUUID();
    for(const kind of ['memory.refresh','memory.refresh','memory.delete'])await queues[0]!.enqueue({kind,payload:{user_id:owner,generation:randomUUID()}});
    await queues[0]!.enqueue({kind:'memory.prepare',payload:{source_id:other,generation:randomUUID()}});
    const claims=await Promise.all(Array.from({length:8},(_,i)=>queues[i%2]!.claim({workerId:`fixture_${i}`,leaseSeconds:60,kinds:['memory.refresh','memory.prepare','memory.delete']})));
    const active=claims.filter(x=>x!==null);
    expect(active).toHaveLength(2);
    expect(active.filter(x=>x!.payload.user_id===owner)).toHaveLength(1);
    expect(active.some(x=>x!.payload.source_id===other)).toBe(true);
    const held=active.find(x=>x!.payload.user_id===owner)!;
    await queues[0]!.complete(held.id,held.fencingToken);
    const next=await queues[1]!.claim({workerId:'fixture_next',leaseSeconds:60,kinds:['memory.refresh','memory.delete']});
    expect(next?.payload.user_id).toBe(owner);
    await ctx.db.update(jobs).set({leaseExpiresAt:new Date('2020-01-01')}).where(eq(jobs.id,next!.id));
    expect((await queues[0]!.claim({workerId:'fixture_expired',leaseSeconds:60,kinds:['memory.refresh','memory.delete']}))?.payload.user_id).toBe(owner);
  }finally{await ctx.close();}
});

it('shares model concurrency between interviews and memory without blocking unrelated cleanup',async()=>{
  const ctx=await createTestContext('memory_model_limit');
  try {
    const queue=new JobQueue(ctx.db,1);
    const memory=await queue.enqueue({kind:'memory.refresh',payload:{user_id:randomUUID(),generation:randomUUID()}});
    await queue.enqueue({kind:'ai.interview.next'});
    await queue.enqueue({kind:'memory.prepare',payload:{source_id:randomUUID(),generation:randomUUID()}});
    expect((await queue.claim({workerId:'fixture_memory',leaseSeconds:60,kinds:['memory.refresh']}))?.id).toBe(memory.job.id);
    expect(await queue.claim({workerId:'fixture_ai',leaseSeconds:60,kinds:['ai.interview.next','memory.prepare']})).toBeNull();
    await queue.enqueue({kind:'memory.delete',payload:{user_id:randomUUID(),generation:randomUUID()}});
    expect((await queue.claim({workerId:'fixture_cleanup',leaseSeconds:60,kinds:['memory.delete']}))?.kind).toBe('memory.delete');
  }finally{await ctx.close();}
});
