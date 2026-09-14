import React,{useEffect,useState} from 'react';
import {api} from '../api.js';
import {Story} from './Story.jsx';
import {Panel,Button} from './shared.jsx';
export function CandidateDetail({route,navigate,user,onLogin}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[followed,setFollowed]=useState(false);
 useEffect(()=>{let active=true;api('/discovery/candidates/'+route.candidate).then(r=>{if(active)setData(r.candidate);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[route.candidate]);
 useEffect(()=>{let active=true;setFollowed(false);if(user)api('/discovery/following').then(r=>{if(active)setFollowed(r.items.some(i=>i.candidate_id===route.candidate));}).catch(()=>{});return()=>{active=false;};},[user?.id,route.candidate]);
 if(!data)return <Panel><p role={error?'alert':'status'}>{error||'正在读取故事…'}</p><Button onClick={()=>navigate('01')}>返回发现</Button></Panel>;
 const follow=<div className="d-interest"><h2>然后呢？</h2><p>这是知乎官方摘要，尚未有作者确认的后来。</p><Button disabled={busy} onClick={async()=>{if(!user){onLogin();return;}setBusy(true);try{await api(`/discovery/candidates/${route.candidate}/interest`,'PUT',{active:!followed});setFollowed(!followed);}catch(e){setError(e.message);}finally{setBusy(false);}}}>{followed?'取消关注':'关注后续'}</Button>{error&&<p role="alert">{error}</p>}</div>;
 return <Story story={{...data,source_id:route.candidate,author:data.author_name,original_url:data.url}} navigate={navigate} onSearchTopic={q=>navigate('01',{q})} followSlot={follow}/>;
}
