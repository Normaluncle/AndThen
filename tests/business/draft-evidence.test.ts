import {beforeAll,afterAll,it,expect} from 'vitest';
import {eq} from 'drizzle-orm';
import {auth,createHarness,seedPublishedStory,seedUser,type Harness} from './helpers.js';
import {followupVersions,interviewSessions,interviewMessages} from '../../src/db/schema.js';

let h:Harness;
beforeAll(async()=>{h=await createHarness();});
afterAll(async()=>{await h.close();});
it('returns only referenced evidence to the owner and rejects expired evidence even for published drafts',async()=>{
  const author=await seedUser(h,'author'),stranger=await seedUser(h,'author'),admin=await seedUser(h,'admin');
  const story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true});
  const [session]=await h.ctx.db.insert(interviewSessions).values({caseId:story.followupCase.id,ownerUserId:author.user.id,status:'finished',mode:'manual'}).returning();
  const messages=await h.ctx.db.insert(interviewMessages).values([
    {sessionId:session!.id,role:'author' as const,sequence:1,authorMessage:'fixture PRIVATE_REFERENCED',visibility:'private' as const},
    {sessionId:session!.id,role:'author' as const,sequence:2,authorMessage:'fixture PRIVATE_UNUSED',visibility:'private' as const},
  ]).returning();
  const refs=[`snapshot:${story.snapshot.id}`,`message:${messages[0]!.id}`,'author_edit:test','message:missing'];
  await h.ctx.db.update(followupVersions).set({interviewId:session!.id,snapshotId:story.snapshot.id,
    statements:refs.map((ref,index)=>({id:`s${index}`,text:'fixture statement',kind:'author_report',visibility:'private',evidence_refs:[ref]})),
    authorEdits:[{id:'author_edit:test',text:'fixture AUTHOR_EDIT',visibility:'private'}],
  }).where(eq(followupVersions.id,story.versionId));
  const url=`/api/drafts/${story.versionId}/evidence`;
  for(const headers of [undefined,auth(stranger.token),auth(admin.token)]){
    const denied=await h.app.inject({url,headers});expect([401,403]).toContain(denied.statusCode);expect(denied.body).not.toContain('PRIVATE_REFERENCED');
  }
  const allowed=await h.app.inject({url,headers:auth(author.token)});
  expect(allowed.statusCode,allowed.body).toBe(200);
  expect(allowed.json().data.items.map((x:{source_kind:string})=>x.source_kind)).toEqual(['original','interview','author_edit']);
  expect(allowed.body).toContain('PRIVATE_REFERENCED');expect(allowed.body).toContain('AUTHOR_EDIT');expect(allowed.body).not.toContain('PRIVATE_UNUSED');
  expect(allowed.json().data.missing_refs).toEqual(['message:missing']);
  await h.ctx.db.update(followupVersions).set({updatedAt:new Date('2020-01-01')}).where(eq(followupVersions.id,story.versionId));
  const expired=await h.app.inject({url,headers:auth(author.token)});expect(expired.statusCode).toBe(410);expect(expired.body).not.toContain('PRIVATE_REFERENCED');
});
