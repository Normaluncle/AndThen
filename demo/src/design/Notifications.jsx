import {NoticeList} from './NoticeList.jsx';
import {notifications} from './notification-data.js';
import React,{useState} from 'react';
import {Art,Button,Panel,Tabs,Icon} from './shared.jsx';
import {groupNotifications,isUnreadNotification,unreadNotificationCount} from './notification-data.js';
export function LeftMenu({active,navigate,unread=3}){return <nav className="d-left-menu" aria-label="个人导航">{[['heart','我的关注','03'],['bell','通知','04'],['comment','我发表的','05'],['star','我的收藏','03'],['clock','浏览历史','03'],['settings','账号设置','09']].map(([icon,label,id])=><button key={label} className={active===label?'active':''} onClick={()=>navigate(id)}><Icon name={icon}/>{label}{label==='通知'&&unread>0&&<i>{unread}</i>}</button>)}</nav>;}
export function Notifications({navigate,state,dispatch,toast,openStory}){const [tab,setTab]=useState('全部');return <NoticeList filter={tab} onFilter={setTab} items={notifications.map(([id,label,title,excerpt,time])=>({id,label,title,excerpt,time,readAt:isUnreadNotification(id,state.read)?null:true}))} onRead={item=>dispatch({type:'read',id:item.id})} onOpen={item=>{dispatch({type:'read',id:item.id});openStory(item.title,'08');}}/>;}
