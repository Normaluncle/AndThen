import React,{useEffect,useState} from 'react';
import {api} from '../api.js';
import {Panel,Button} from './shared.jsx';
export function ProfilePanel({user,navigate,onLogin}){
 const [profile,setProfile]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setProfile(null);setError('');if(user)api('/me/zhihu').then(data=>{if(active)setProfile(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[user?.id]);
 return <Panel><h1>我的主页</h1><h2>{profile?.display_name||user?.display_name||'体验访客'}</h2>{user?<><p>{profile?.authorized?'知乎资料已连接':'尚未连接知乎资料'}</p>{profile?.uid&&<p>知乎 ID：{profile.uid}</p>}<p className="d-muted">昵称来自授权账号。官方未提供的头像、简介和职业信息会保持空缺。</p>{error&&<p role="alert">{error}</p>}</>:<p>登录后可查看自己的资料与本站收藏。</p>}<Button onClick={()=>navigate('05')}>我的回答</Button><Button kind="secondary" onClick={()=>navigate('09',{tab:'settings'})}>设置与资料</Button>{!user&&<Button kind="ghost" onClick={onLogin}>登录</Button>}</Panel>;
}
