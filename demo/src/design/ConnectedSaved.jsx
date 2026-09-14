import React,{useEffect,useState} from 'react';
import {api} from '../api.js';
import {Panel,Button} from './shared.jsx';
export function ConnectedSaved({user,navigate,history=false,onLogin}){
 const path=history?'/me/history':'/me/saved-stories';
 const [items,setItems]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=()=>api(path).then(data=>setItems(data.items));
 useEffect(()=>{let active=true;if(!user){setItems([]);return;}api(path).then(data=>{if(active)setItems(data.items);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[user?.id,path]);
 return <Panel><h1>{history?'浏览历史':'我的收藏'}</h1><p>{history?'最近阅读的本站回答。':'保存值得再读的回答，与关注后续分开。'}</p>{!user&&<Button onClick={onLogin}>登录账号</Button>}{error&&<p role="alert">{error}</p>}{items===null?<p>正在读取…</p>:items.length?items.map(item=><article className="d-personal-list" key={item.source_id}><button className="d-story-title" onClick={()=>navigate('02',{source:item.source_id})}><h2>{item.title}</h2></button><p>{item.text}</p>{!history&&<Button kind="ghost" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api(`/stories/${item.source_id}/community`,'PUT',{saved:false});await load();}catch(e){setError(e.message);}finally{setBusy(false);}}}>取消收藏</Button>}</article>):<p>{history?'还没有浏览记录。':'还没有收藏的回答。阅读时点击星标即可保存。'}</p>}</Panel>;
}
