// Run in the isolated demo API container, working directory /app.
// Idempotent: does not reset user progress or alter existing stories.
import {connect} from '../dist/db/client.js';
import {users,sources,sourceSnapshots,authorVerifications,consents,followupCases} from '../dist/db/schema.js';
import {snapshotContentHash} from '../dist/modules/sources/service.js';
import {eq} from 'drizzle-orm';
if(process.env.LOCAL_DEMO_LOGIN!=='true'||process.env.PUBLIC_BASE_URL!=='http://127.0.0.1:5174')throw new Error('Only run in the configured loopback demo');
const db=await connect({connectionString:process.env.DATABASE_URL});
const reader='c04bfed0-818f-4628-a3d9-b991bdfc8001',author='c04bfed0-818f-4628-a3d9-b991bdfc8002';
try {await db.db.transaction(async tx=>{
 for(const [id,role,displayName] of [[reader,'reader','演示读者'],[author,'author','模拟作者（非知乎原作者）']]){
  await tx.insert(users).values({id,role,displayName,cohort:'local_demo_fixture'}).onConflictDoNothing();
  const [u]=await tx.select().from(users).where(eq(users.id,id));
  if(u.role!==role||u.cohort!=='local_demo_fixture')throw new Error('Fixture identity collision');
 }
 const fixtures=[
  ['c04bfed0-818f-4628-a3d9-b991bdfc8011','【演示】从车辆工程转行，后来适应了吗？','【虚构演示，非知乎原作者经历】2021年，我从车辆工程转向软件开发，给自己半年学习。我想记录第一份工作和适应团队的过程。你可以扮演作者补充后来，不讨论收入。'],
  ['c04bfed0-818f-4628-a3d9-b991bdfc8012','【演示】毕业五年，我想重新选择生活','【虚构演示，非知乎原作者经历】毕业时我去了大城市，想先工作几年再决定在哪里生活。五年后，我想重新看看当时的决定。请你扮演作者，写下一个用于测试的后来。'],
  ['c04bfed0-818f-4628-a3d9-b991bdfc8013','【演示】学烘焙的半年计划','【虚构演示】我计划用半年学会烤面包，每周练习一次，并记下配方和失败原因。现在半年过去了，可以聊聊发生了哪些变化。'],
 ];
 for(const [id,title,excerpt] of fixtures){
  const [existing]=await tx.select().from(sources).where(eq(sources.id,id));if(existing)continue;
  await tx.insert(sources).values({id,title,sourceType:'author_paste',createdByUserId:author,provenance:'test_fixture',permissionStatus:'public_approved'});
  await tx.insert(sourceSnapshots).values({sourceId:id,version:1,materialLevel:'exact_excerpt',excerpt,contentHash:snapshotContentHash({materialLevel:'exact_excerpt',excerpt,body:null,excerptLocation:null}),createdByUserId:author});
  await tx.insert(authorVerifications).values({sourceId:id,userId:author,method:'manual',status:'verified',evidenceRef:'fixture:local-playground-not-real-author',verifiedAt:new Date()});
  await tx.insert(consents).values(['private_interview','external_model_processing','demo_public_display'].map(purpose=>({sourceId:id,userId:author,purpose,version:'local-demo-fixture-v1'})));
  await tx.insert(followupCases).values({sourceId:id,authorUserId:author,createdByUserId:author,status:'eligible',reviewerRequired:false});
 }
});console.log('Local playground ready: 2 fixed accounts, 3 clearly labeled stories; existing progress preserved.');}finally{await db.close();}
