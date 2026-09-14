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

export function coverCaption(item){
 const caption=(item.cover_caption||'').trim();
 const yearMatch=/^(\d{4})(?:年|[.-]\d{2})/.exec(caption);
 const year=Number.isInteger(item.cover_year)?item.cover_year:(yearMatch?Number(yearMatch[1]):null);
 const text=caption.replace(/^\d{4}(?:年|[.-]\d{2})\s*/,'');
 if(!year&&!text)return [];
 return [year?`${year}年`:'',text];
}

export function storySharePath({sourceId,fixtureId='career',followupId,screen='02'}){return followupId?'/?screen=08&followup='+encodeURIComponent(followupId):`/?screen=${screen==='08'?'08':'02'}&${sourceId?'source='+encodeURIComponent(sourceId):'story='+encodeURIComponent(fixtureId)}`;}
