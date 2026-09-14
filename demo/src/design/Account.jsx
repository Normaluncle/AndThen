import React,{useState,useEffect} from 'react';
import {personalTabs} from './navigation.js';
import {Avatar,Icon,Modal} from './shared.jsx';
import {ProfileAvatar} from '../Home.jsx';
export function Toggle({label,value,onChange}){return <button role="switch" aria-label={label} aria-checked={value} className={`d-toggle ${value?'on':''}`} onClick={()=>onChange(!value)}><span/></button>;}
export function Account({navigate,tab='settings',children,user}){
 const [drawer,setDrawer]=useState(false);
 useEffect(()=>{setDrawer(false);},[tab]);
 useEffect(()=>{const media=window.matchMedia('(min-width:768px)');const close=()=>{if(media.matches)setDrawer(false);};media.addEventListener('change',close);return()=>media.removeEventListener('change',close);},[]);
 const links=mobile=>personalTabs.map(([id,icon,title])=><button aria-current={tab===id?'page':undefined} className={tab===id?'active':''} key={id} onClick={()=>{setDrawer(false);navigate('09',{tab:id});}}><Icon name={icon}/><span>{title}</span>{mobile&&tab===id&&<small>当前页面</small>}</button>);
 return <div className="d-account" data-screen="09">
 <nav className="d-account-nav"><div className="d-account-user">{user?<ProfileAvatar user={user} className="d-profile-initial"/>:<Avatar/>}<span><b>{user?.display_name||'体验访客'}</b><small>把经历写成礼物</small></span></div>{links(false)}<p>有些回答，<br/>不该只停留在过去。<br/>—— 然后呢？</p></nav>
 <div className="d-account-main"><button className="d-account-drawer-handle" aria-label="打开个人中心菜单" aria-expanded={drawer} onClick={()=>setDrawer(true)}><span aria-hidden="true">☰</span><span>个人中心</span></button>{children}</div>
 {drawer&&<Modal kind="account-drawer" title="个人中心" onClose={()=>setDrawer(false)}><nav className="d-account-drawer-nav" aria-label="个人中心页面">{links(true)}</nav></Modal>}
 </div>;
}
