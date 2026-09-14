import {eq,sql} from 'drizzle-orm';
import {storyReactions,siteComments} from '../../db/schema.js';
import type {Executor} from '../../db/client.js';
export async function siteCounts(db:Executor,sourceId:string):Promise<number[]>{
 const [reactions]=await db.select({likes:sql<number>`count(*) filter(where liked)::int`,saves:sql<number>`count(*) filter(where saved)::int`}).from(storyReactions).where(eq(storyReactions.sourceId,sourceId));
 const [comments]=await db.select({total:sql<number>`count(*)::int`}).from(siteComments).where(eq(siteComments.sourceId,sourceId));
 return [reactions?.likes??0,comments?.total??0,reactions?.saves??0];
}
