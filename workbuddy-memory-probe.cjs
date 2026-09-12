const {run,root}=require('./workbuddy-cli-probe.cjs');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const final=r=>r.events.findLast(e=>e.value.type==='result')?.value;
(async()=>{
 const marker='WB-'+randomBytes(12).toString('hex');
 const workspace='memory-'+Date.now();
 const first=await run('seed',`Remember this test-only project code for the rest of this conversation: ${marker}. Its associated number is 731. Reply only STORED. Do not use tools.`,{persist:true,workspace});
 const session=final(first)?.session_id;
 if(final(first)?.subtype!=='success'||!session)throw new Error('Seed failed');
 const question='What is the exact test-only project code I gave you earlier, and its associated number? Reply with both. If they are absent from this conversation, reply only UNKNOWN. Do not use tools or read files.';
 const [resumed,control]=await Promise.all([
 run('recall',question,{persist:true,resume:session,workspace}),
 run('control',question,{workspace:workspace+'-control'})
 ]);
 const summary={session,workspace,seed:final(first)?.subtype,recall:final(resumed),control:final(control),recallPass:final(resumed)?.result?.includes(marker)&&final(resumed)?.result?.includes('731'),controlPass:final(control)?.result?.trim()==='UNKNOWN',toolCalls:[first,resumed,control].flatMap(r=>r.events.flatMap(e=>(e.value.message?.content||[]).filter(c=>c.type==='tool_use')))};
 fs.writeFileSync(path.join(root,'memory-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
})();
