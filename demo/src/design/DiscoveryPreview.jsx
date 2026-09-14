import React,{useEffect,useState} from 'react';
import {api} from '../api.js';
import {Home} from '../Home.jsx';
import {Panel,Modal,Button} from './shared.jsx';
import {poll} from '../workflow.js';

// Same home layout; local candidate status is explicit and never masquerades as publication.
export function DiscoveryPreview({children,query,onQuery,navigate,user,onLogin}){
 const [data,setData]=useState(null),[candidate,setCandidate]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;const load=()=>api('/discovery/local-preview');const apply=value=>{if(active){setData(value);setError('');}};const fail=e=>{if(active)setError(e.message);};load().then(apply).catch(fail);const stop=poll(load,apply,fail,30000);return()=>{active=false;stop();};},[]);
 if(!data?.enabled)return <>{children}{error&&<Panel><p role="alert">自动发现预览暂不可用：{error}</p></Panel>}</>;
 return <><Home items={data.items||[]} query={query} onQuery={onQuery} onSearch={()=>{if(query.trim())navigate('01',{q:query.trim()});}} onFillImport={()=>navigate('12')} onInterest={setCandidate} onUrl={()=>{}} asideExtra={<Panel><h3>自动发现 · 本地验证</h3><p>定时从知乎官方搜索发现候选，按经历与时间线索筛选。当前显示官方摘要，尚未经过作者确认或 AI 回访。</p><p>每 30 秒刷新候选列表；不会发布到公网。</p></Panel>}/>
 {error&&<p role="alert">{error}</p>}
 {candidate&&<Modal title="官方摘要 · 待回访候选" onClose={()=>setCandidate(null)} actions={<><a className="d-button secondary" href={candidate.url} target="_blank" rel="noreferrer">查看知乎原帖</a><Button disabled={busy} onClick={async()=>{if(!user){onLogin();return;}setBusy(true);try{await api(`/discovery/candidates/${candidate.candidate_id}/interest`,'PUT',{active:true});setCandidate(null);navigate('03');}catch(e){setError(e.message);}finally{setBusy(false);}}}>{user?'关注后续':'登录后关注'}</Button></>}><h2>{candidate.title}</h2><p>{candidate.author_name}</p><p className="d-prose">{candidate.text}</p><p className="d-muted">仅为官方搜索摘要，不是全文，也不是作者发布的后来。</p>{error&&<p role="alert">{error}</p>}</Modal>}
 </>;
}
