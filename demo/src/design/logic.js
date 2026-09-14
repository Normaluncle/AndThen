export function designScreen(search){const id=new URLSearchParams(search).get('screen');return /^(0[1-9]|1[0-5])$/.test(id)?id:'01';}
export function filterSamples(rows,query,year,category,status){return rows.filter(r=>(!query||`${r[1]} ${r[2]}`.includes(query))&&(year==='全部年份'||r[3]===year)&&(category==='全部分类'||r[4]===category)&&(status==='全部状态'||r[5]===status));}
export function validZhihuUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&['www.zhihu.com','zhihu.com','zhuanlan.zhihu.com'].includes(url.hostname)&&(/^\/(question|answer|p)\/\d+(?:\/answer\/\d+)?\/?$/).test(url.pathname);}catch{return false;}}
export function restoreDraft(raw,fallback){try{const value=JSON.parse(raw);return Object.fromEntries(Object.entries(fallback).map(([key,text])=>[key,typeof value?.[key]==='string'?value[key]:text]));}catch{return fallback;}}

export function mobileReadingExcerpt(text,index){if(index===0)return text.replaceAll('\n','');if(index===1)return text.split('\n').slice(0,2).join('');return text.split('\n').slice(0,2).join('')+'它不是一条轻松的路，但它让我重新认识了自己……';}
