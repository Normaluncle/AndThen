import {workbenchBucket} from '../ui14.js';

export function liveWorkbenchCard(item) {
  const bucket=workbenchBucket(item);
  return {
    id:item.id,
    source_id:item.source_id,category:item.category,tags:item.tags,cover_id:item.cover_id,cover_url:item.cover_url,cover_year:item.cover_year,cover_caption:item.cover_caption,date:item.published_at?.slice(0,10),excerpt:item.text,
    title:item.title||'未命名回答',
    meta:{waiting:'等待回应',writing:'正在写后来',published:'已发布后来'}[bucket],
    interestCount:Number.isFinite(item.interest_count)?item.interest_count:null,
    reasons:(item.reader_interests?.tags||[]).filter(tag=>typeof tag.tag==='string').map(tag=>({
      label:tag.tag,
      percentage:Number.isFinite(tag.percentage)?tag.percentage:null,
    })),
    action:item.draft_id?{label:'查看草稿与发布记录',screen:'07',options:{draft:item.draft_id}}
      :item.interview_id?{label:'继续写后来',screen:'06',options:{interview:item.interview_id}}
      :{label:'愿意讲讲后来吗？',invite:true},
  };
}
