import React,{useEffect,useState} from 'react';
import {api} from '../api.js';
import {Home} from '../Home.jsx';
import {Panel,Modal,Button} from './shared.jsx';
import {poll} from '../workflow.js';

// Same home layout; local candidate status is explicit and never masquerades as publication.
export function DiscoveryPreview({children,query,onQuery,navigate,user,onLogin}){
 const [data,setData]=useState(null),[candidate,setCandidate]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;const load=async()=>{const [feed,stories]=await Promise.all([api('/discovery/local-preview'),api('/stories?limit=50')]);return {...feed,items:[...(stories.items||[]),...(feed.items||[]).filter(item=>!(stories.items||[]).some(story=>story.original_url===item.url))]};};const apply=value=>{if(active){setData(value);setError('');}};const fail=e=>{if(active)setError(e.message);};load().then(apply).catch(fail);const stop=poll(load,apply,fail,30000);return()=>{active=false;stop();};},[]);
 if(!data?.enabled)return <>{children}{error&&<Panel><p role="alert">自动发现预览暂不可用：{error}</p></Panel>}</>;
 return <><Home items={data.items||[]} query={query} onQuery={onQuery} onSearch={()=>{if(query.trim())navigate('01',{q:query.trim()});}} onFillImport={()=>navigate('12')} onOpen={source=>navigate('02',{source})} onInterest={item=>navigate('02',{candidate:item.candidate_id})} onUrl={()=>{}} asideExtra={<Panel><h3>{data.ai_enabled?'自动发现':'自动发现 · 本地验证'}</h3><p>{data.ai_enabled?'AI 从官方搜索摘要中筛选可回访的经历。':'定时从知乎官方搜索发现候选，按经历与时间线索筛选。'}当前显示官方摘要，尚未经过作者确认或 AI 回访。</p><p>{data.ai_enabled?'定期发现新内容；展示摘要不代表作者已参与回访。':'每 30 秒刷新候选列表；不会发布到公网。'}</p></Panel>}/>
 {error&&<p role="alert">{error}</p>}

 </>;
}
