export function searchOptions(options={}){
 const result={};
 if(typeof options.q==='string'&&options.q.trim())result.q=options.q.trim().slice(0,300);
 for(const key of ['from','to'])if(/^\d{4}-\d{2}-\d{2}$/.test(options[key]||''))result[key]=options[key];
 if(['relevance','newest','oldest'].includes(options.sort))result.sort=options.sort;
 const page=Number(options.page);if(Number.isInteger(page)&&page>1)result.page=String(page);
 return result;
}
export function internalSearchUrl(route){const query=new URLSearchParams({limit:'10',offset:String(((Number(route.page)||1)-1)*10)});for(const key of ['q','from','to','sort'])if(route[key])query.set(key,route[key]);return '/stories?'+query;}
export function selectCover(item,pool=[]){const matches=pool.filter(asset=>!asset.tags?.length||asset.tags.includes(item.category)||asset.tags.some(tag=>item.tags?.includes(tag)));if(!matches.length)return null;let seed=0;for(const ch of String(item.source_id||item.id||item.title||''))seed=(seed*31+ch.charCodeAt(0))>>>0;return matches[seed%matches.length];}

export function coverCaption(item){const raw=item.date||item.published_at;const match=/^(\d{4})[-.年](\d{2})/.exec(raw||item.cover_caption||'');const date=match?`${match[1]}年${Number(match[2])}月`:'';const text=item.cover_caption?.replace(/^\d{4}[-.]\d{2}\s*/, '')||'原回答';return date?[date,text]:item.cover_caption?['',item.cover_caption]:[];}

export function storySharePath({sourceId,fixtureId='career',followupId,screen='02'}){return followupId?'/?screen=08&followup='+encodeURIComponent(followupId):`/?screen=${screen==='08'?'08':'02'}&${sourceId?'source='+encodeURIComponent(sourceId):'story='+encodeURIComponent(fixtureId)}`;}
