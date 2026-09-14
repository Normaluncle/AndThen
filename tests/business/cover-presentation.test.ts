import {it,expect} from 'vitest';
import {eq} from 'drizzle-orm';
import {auth,createHarness,seedUser,seedPublishedStory} from './helpers.js';
import {aiRuns,coverCatalog} from '../../src/db/schema.js';
import {keywordCategory,matchCover} from '../../src/modules/sources/presentation.js';
it('maps every imported catalogue slot and only exposes validated current-snapshot captions',async()=>{
 const h=await createHarness();try{const author=await seedUser(h,'author'),story=await seedPublishedStory(h,{author:author.user,verifyAuthor:true,excerpt:'辞职后我开始学习软件开发。'});
 const rows=await h.ctx.db.select().from(coverCatalog);expect(rows).toHaveLength(400);expect(new Set(rows.map(r=>r.id)).size).toBe(400);expect(rows.filter(r=>r.imageUrl)).toHaveLength(250);
 expect(keywordCategory('我辞职转行进入新的职场')).toBe('职场发展');expect(matchCover(rows,'学习成长',[],'same')?.category).toBe('学习成长');expect(matchCover(rows,'学习成长',[],'same')?.id).toBe(matchCover(rows,'学习成长',[],'same')?.id);
 const read=()=>h.app.inject({url:`/api/stories/${story.source.id}`});let result=(await read()).json().data.story;expect(result.cover_status).toBe('ready');expect(result.cover_url).toMatch(/^https:\/\/img\.cc0\.cn\//);expect(result.cover_caption).toBeNull();
 const insert=async(hash:string,caption:string)=>h.ctx.db.insert(aiRuns).values({sourceId:story.source.id,task:'ai_a_extract',status:'succeeded',modelId:'test-model',promptVersion:'test',output:{snapshot_hash:hash,presentation:{category:'职场发展',tags:['职场发展'],caption,evidence_refs:[`snapshot:${story.snapshot.id}`]}}});
 await insert('stale','辞职后');expect((await read()).json().data.story.cover_caption).toBeNull();
 await insert(story.snapshot.contentHash,'不存在的成功结果');expect((await read()).json().data.story.cover_caption).toBeNull();
 await h.ctx.db.delete(aiRuns).where(eq(aiRuns.sourceId,story.source.id));await insert(story.snapshot.contentHash,'开始学习软件开发');result=(await read()).json().data.story;expect(result.cover_caption).toBe('开始学习软件开发');
 const privateRead=await h.app.inject({url:`/api/sources/${story.source.id}`,headers:auth(author.token)});expect(privateRead.json().data.presentation.cover_id).toBe(result.cover_id);
 const catalogue=await h.app.inject({url:'/api/covers'});expect(catalogue.json().data.items).toHaveLength(400);
 }finally{await h.close();}
});
