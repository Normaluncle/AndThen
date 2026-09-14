import React,{useEffect,useState} from 'react';
import {api} from '../api.js';
import {Home} from '../Home.jsx';
import {Panel} from './shared.jsx';
import {poll} from '../workflow.js';

// Same home layout; local candidate status is explicit and never masquerades as publication.
export function DiscoveryPreview({children,query,onQuery,navigate,user,onLogin}){
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;const load=()=>api('/discovery/local-preview');const apply=value=>{if(active){setData(value);setError('');}};const fail=e=>{if(active)setError(e.message);};load().then(apply).catch(fail);const stop=poll(load,apply,fail,30000);return()=>{active=false;stop();};},[]);
 if(!data?.enabled)return <>{children}{error&&<Panel><p role="alert">自动发现预览暂不可用：{error}</p></Panel>}</>;
 return <><Home items={data.items||[]} query={query} onQuery={onQuery} onSearch={()=>{if(query.trim())navigate('01',{q:query.trim()});}} onFillImport={()=>navigate('12')} onNavigate={navigate} onUrl={()=>{}} asideExtra={<Panel><h3>自动发现 · 本地验证</h3><p>定时从知乎官方搜索发现候选，按经历与时间线索筛选。当前显示官方摘要，尚未经过作者确认或 AI 回访。</p><p>每 30 秒刷新候选列表；不会发布到公网。</p></Panel>}/>
 {error&&<p role="alert">{error}</p>}
 </>;
}
