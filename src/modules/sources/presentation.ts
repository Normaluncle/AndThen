import {and,desc,eq} from 'drizzle-orm';
import {aiRuns,coverCatalog,type SourceSnapshotRow} from '../../db/schema.js';
import type {Executor} from '../../db/client.js';
import {coverAnalysisSchema,type Presentation} from './presentation-schema.js';
import {coverCaptionAcceptable} from './cover-caption.js';
const words:Record<string,string[]>={职场发展:['工作','职场','转行','辞职','职业','大厂','通勤'],学习成长:['学习','考研','读研','大学','备考','考试','留学'],情感关系:['分手','相恋','恋爱','伴侣','结婚'],创业思考:['创业','副业','独立开发','生意'],家庭生活:['家庭','父母','孩子','育儿','烘焙'],健康恢复:['康复','恢复','锻炼','健康'],自我反思:['反思','回看','自我'],迁移生活:['搬家','迁居','旅行','远方'],人生选择:['选择','决定','人生']};
export function keywordCategory(text:string){let category='通用留白',score=0;for(const [name,keys] of Object.entries(words)){const next=keys.filter(word=>text.includes(word)).length;if(next>score){category=name;score=next;}}return category;}
export function matchCover<T extends {id:string;category:string;tags:string[];imageUrl:string|null}>(rows:T[],category:string,tags:string[],key:string):T|null{
 const eligible=rows.some(row=>row.imageUrl)?rows.filter(row=>row.imageUrl):rows;
 let best=-1,candidates:T[]=[];for(const row of eligible){const score=(row.category===category?100:row.category==='通用留白'?1:0)+row.tags.filter(t=>tags.includes(t)).length*5+(row.imageUrl?2:0);if(score>best){best=score;candidates=[row];}else if(score===best)candidates.push(row);}
 candidates.sort((a,b)=>a.id.localeCompare(b.id));let hash=0;for(const char of key)hash=(hash*31+char.charCodeAt(0))>>>0;return candidates.length?candidates[hash%candidates.length]!:null;
}
/** Only consume AI metadata bound to the current snapshot; never expose private AI analysis itself. */
export async function sourcePresentation(db:Executor,sourceId:string,title:string|null,snapshot?:SourceSnapshotRow):Promise<Presentation>{
 const text=snapshot?.materialLevel==='exact_excerpt'?snapshot.excerpt||'':snapshot?.body||snapshot?.excerpt||'';
 let category=keywordCategory((title||'')+' '+text),tags=[category],caption:string|null=null,year:number|null=null;
 if(snapshot){const runs=await db.select({output:aiRuns.output}).from(aiRuns).where(and(eq(aiRuns.sourceId,sourceId),eq(aiRuns.task,'ai_a_extract'),eq(aiRuns.status,'succeeded'))).orderBy(desc(aiRuns.createdAt)).limit(20);
 const output=runs.find(r=>r.output?.snapshot_hash===snapshot.contentHash)?.output;const parsed=coverAnalysisSchema.safeParse(output?.presentation);
 if(parsed.success&&coverCaptionAcceptable(text,parsed.data.caption,parsed.data.year,snapshot.publishedAt)&&parsed.data.evidence_refs.every(ref=>ref===`snapshot:${snapshot.id}`)){category=parsed.data.category;tags=parsed.data.tags;caption=parsed.data.caption;year=parsed.data.year;}}
 const cover=matchCover(await db.select().from(coverCatalog),category,tags,sourceId+':'+(snapshot?.contentHash||''));
 return {category,tags,cover_id:cover?.id??null,cover_url:cover?.imageUrl??null,cover_year:year,cover_caption:caption,cover_status:cover?.imageUrl?'ready':'pending_asset'};
}
