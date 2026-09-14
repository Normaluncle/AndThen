import React,{useEffect,useState} from 'react';
import {api} from '../api.js';
import {Home} from '../Home.jsx';
import {Panel} from './shared.jsx';
import {poll} from '../workflow.js';
import {discoveryAside} from './discovery-copy.js';

// Same home layout; local candidate status is explicit and never masquerades as publication.
export function DiscoveryPreview({children,query,onQuery,navigate,user,onLogin}){
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;const load=()=>api('/discovery/local-preview');const apply=value=>{if(active){setData(value);setError('');}};const fail=e=>{if(active)setError(e.message);};load().then(apply).catch(fail);const stop=poll(load,apply,fail,30000);return()=>{active=false;stop();};},[]);
 if(!data?.enabled)return <>{children}{error&&<Panel><p role="alert">自动发现预览暂不可用：{error}</p></Panel>}</>;
 const aside=discoveryAside(!!data.ai_enabled);
 return <><Home items={data.items||[]} query={query} onQuery={onQuery} onSearch={()=>{if(query.trim())navigate('01',{q:query.trim()});}} onFillImport={()=>navigate('12')} onNavigate={navigate} onUrl={()=>{}} asideExtra={<Panel><h3>{aside.title}</h3><p>{aside.body}</p><p>{aside.note}</p></Panel>}/>
 {error&&<p role="alert">{error}</p>}
 </>;
}
