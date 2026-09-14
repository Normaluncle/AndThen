import {Management} from '../Management.jsx';
import React,{useState,useEffect,useCallback} from 'react';
import {api,setToken} from '../api.js';
import {HomeHeader} from '../Home.jsx';
import {poll} from '../workflow.js';
import {SearchPage} from './SearchPage.jsx';
import {DiscoveryPreview} from './DiscoveryPreview.jsx';
import {CandidateDetail} from './CandidateDetail.jsx';
import {Account} from './Account.jsx';
import {SettingsPage} from './SettingsPage.jsx';
import {ProfilePanel} from './ProfilePanel.jsx';
import {ConnectedSaved} from './ConnectedSaved.jsx';
import {ConnectedHome,ConnectedPersonal,ConnectedDetail,ConnectedImport} from './Connected.jsx';
import {SessionPanel} from './SessionPanel.jsx';
import {ReportsPanel} from './ReportsPanel.jsx';
import {Panel,Button,Modal,DesignMobileNav} from './shared.jsx';
import {readRoute,routeUrl,nextRoute,mayOpenRoute} from './navigation.js';
import './design.css';
export default function DesignApp({user,onUser,connectionError}){
 const [route,setRoute]=useState(()=>readRoute(location.search));
 const [query,setQuery]=useState(route.q||''),[login,setLogin]=useState(false),[unread,setUnread]=useState(0);
 useEffect(()=>setQuery(route.q||''),[route.q]);
 const navigate=useCallback((id,options={},mode={})=>{const next=nextRoute(route,id,options);if(next.screen==='01'&&!next.q)setQuery('');if(routeUrl(next)===routeUrl(route))return;history[mode.replace?'replaceState':'pushState']({andthen:true,from:routeUrl(route)},'',routeUrl(next));setRoute(next);if(!mode.replace)window.scrollTo({top:0});},[route]);
 useEffect(()=>{const back=()=>setRoute(readRoute(location.search));window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 useEffect(()=>{if(!user){setUnread(0);return;}let active=true;const apply=data=>{if(active)setUnread((data.items||[]).filter(n=>!n.readAt&&!n.read_at&&n.status!=='withdrawn').length);};const fail=e=>{if(active&&e.status===401){setToken(false);onUser(null);}};api('/me/notifications').then(apply).catch(fail);const stop=poll(()=>api('/me/notifications'),apply,fail,5000);return()=>{active=false;stop();};},[user?.id]);
 const screen=route.screen,personal=screen==='09',active=personal&&route.tab==='notifications'?'04':personal&&route.tab==='following'?'03':personal&&route.tab==='answers'?'05':screen;
 const page=active==='05'?'作者工作台':active==='03'?'我的关注':personal?'账号':screen==='01'?'发现':'内容';
 const back=()=>history.state?.andthen&&history.state.from?history.back():navigate('01');
 const nav={'发现':'01','我的关注':'03','作者工作台':'05','我的回答':'05','通知':'04','账号':'09'};
 const loginPrompt=<Panel><p>登录后查看和管理自己的内容。</p><Button onClick={()=>setLogin(true)}>登录账号</Button></Panel>;
 return <div className={`design-shell screen-${screen} ${screen==='01'?'home-shell':''}`}>
 <HomeHeader user={user} onLogin={()=>setLogin(true)} showWrite showSearch={screen!=='01'||!!route.q} page={page} query={query} onQuery={setQuery} onSearch={()=>{if(query.trim())navigate('01',{q:query.trim()});}} onEnter={p=>navigate(nav[p]||'01',p==='账号'?{tab:'profile'}:{})} notificationActive={active==='04'} unread={unread} onBack={['02','06','07','08','11','12'].includes(screen)?back:undefined}/>
 <main className={screen==='01'?'shell-body':'d-content'}>
 {connectionError&&<Panel><p role="alert">{connectionError}</p><Button onClick={()=>location.reload()}>重新连接</Button></Panel>}
 {!mayOpenRoute(route,user)?<Panel><h1>此页面仅限管理员</h1><Button onClick={()=>setLogin(true)}>登录账号</Button></Panel>:<>
 {screen==='01'&&(route.q?<SearchPage route={route} navigate={navigate} user={user} onLogin={()=>setLogin(true)}/>:<DiscoveryPreview query={query} onQuery={setQuery} navigate={navigate} user={user}><ConnectedHome query={query} onQuery={setQuery} navigate={navigate}/></DiscoveryPreview>)}
 {personal&&<Account navigate={navigate} tab={route.tab} user={user}>
 {route.tab==='profile'&&<ProfilePanel user={user} navigate={navigate} onLogin={()=>setLogin(true)}/>}
 {['following','notifications','answers'].includes(route.tab)&&<ConnectedPersonal key={`${user?.id||'guest'}:${route.tab}`} tab={route.tab} navigate={navigate} user={user} onLogin={()=>setLogin(true)}/>}
 {['saved','history'].includes(route.tab)&&<ConnectedSaved history={route.tab==='history'} navigate={navigate} user={user} onLogin={()=>setLogin(true)}/>}
 {route.tab==='settings'&&<SettingsPage user={user} onUser={onUser} navigate={navigate} onLogin={()=>setLogin(true)}/>}
 {user?.role==='admin'&&<Panel><Button kind="secondary" onClick={()=>navigate('10')}>管理后台</Button></Panel>}
 </Account>}
 {screen==='02'&&route.candidate?<CandidateDetail route={route} navigate={navigate} user={user} onLogin={()=>setLogin(true)}/>:['02','06','07','08','11'].includes(screen)&&<ConnectedDetail key={routeUrl(route)} route={route} navigate={navigate} user={user} onLogin={()=>setLogin(true)}/>}
 {screen==='12'&&(user?<ConnectedImport navigate={navigate} user={user}/>:loginPrompt)}
 {screen==='10'&&<><Panel><Management role={user?.role}/></Panel><ReportsPanel navigate={navigate}/><ReportsPanel feedback navigate={navigate}/></>}
 </>}
 </main><footer className="d-footer"><span>然后呢？ And Then? · 内容由作者确认后在本站发布</span><button className="d-link" onClick={()=>setLogin(true)}>{user?'账号管理':'登录账号'}</button></footer>
 {['01','09'].includes(screen)&&<DesignMobileNav screen={active} navigate={navigate} unread={unread}/>}
 {login&&<Modal title="账号登录" onClose={()=>setLogin(false)}><SessionPanel user={user} onUser={onUser} onClose={()=>setLogin(false)}/></Modal>}
 </div>;
}
