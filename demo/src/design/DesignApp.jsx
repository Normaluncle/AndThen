import {DiscoveryPreview} from './DiscoveryPreview.jsx';
import {SettingsPage} from './SettingsPage.jsx';
import React,{useState,useReducer,useEffect,useCallback} from 'react';
import {Engagement,emptyEngagement} from './Engagement.jsx';
import {SearchPage} from './SearchPage.jsx';
import {ReportsPanel} from './ReportsPanel.jsx';
import {ProfilePanel} from './ProfilePanel.jsx';
import {ConnectedSaved} from './ConnectedSaved.jsx';
import {api,setToken} from '../api.js';
import {poll} from '../workflow.js';
import {Home,HomeHeader} from '../Home.jsx';
import {MobileTabBar} from '../chrome.jsx';
import {Story} from './Story.jsx';
import {Following} from './Following.jsx';
import {Notifications} from './Notifications.jsx';
import {Workbench} from './Workbench.jsx';
import {Interview} from './Interview.jsx';
import {Publish} from './Publish.jsx';
import {Reading} from './Reading.jsx';
import {Account} from './Account.jsx';
import {Admin} from './Admin.jsx';
import {Invite} from './Invite.jsx';
import {Import} from './Import.jsx';
import {States} from './States.jsx';
import {Overlays} from './Overlays.jsx';
import {Components} from './Components.jsx';
import {initialDesignState,designReducer} from './state.js';
import './design.css';
import {readRoute,routeUrl,nextRoute,mayOpenRoute,canUseDeveloperPages} from './navigation.js';
import {storyParagraphs,Panel,Button,Modal,Tag} from './shared.jsx';
import {followedStories} from './Following.jsx';
import {SessionPanel} from './SessionPanel.jsx';
import {ConnectedHome,ConnectedPersonal,ConnectedDetail,ConnectedImport,ConnectedSettings} from './Connected.jsx';
import {DesignMobileNav} from './shared.jsx';
import {unreadNotificationCount} from './notification-data.js';
export const screenNames={'01':'发现首页','02':'故事详情','03':'我的关注','04':'通知','05':'写下后来','06':'AI 回访采访','07':'确认与发布','08':'公开后来','09':'我的资料与设置','10':'管理后台','11':'作者邀请','12':'链接导入与核验','13':'状态与空态','14':'弹窗与抽屉','15':'组件总览'};
const navIds={'发现':'01','我的关注':'03','作者工作台':'05','我的回答':'05','通知':'04','账号':'09'};
export default function DesignApp({user,onUser,connectionError}){
 const [route,setRoute]=useState(()=>readRoute(location.search));
 const screen=route.screen;
 useEffect(()=>{setQuery(route.q||'');},[route.q]);
 const [query,setQuery]=useState(''),[toastText,setToastText]=useState(''),[loginOpen,setLoginOpen]=useState(false);
 const [interactions,setInteractions]=useState({});
 const [fixtureFollows,setFixtureFollows]=useState(()=>followedStories.map(item=>item.id));
 const [personalFilters,setPersonalFilters]=useState({});
 const [liveUnread,setLiveUnread]=useState(0);
 useEffect(()=>{if(!user){setLiveUnread(0);return;}let active=true;const apply=data=>{if(active)setLiveUnread((data.items||[]).filter(item=>!item.readAt&&!item.read_at&&item.status!=='withdrawn').length);};const fail=e=>{if(active&&e.status===401){setToken(false);onUser(null);}};api('/me/notifications').then(apply).catch(fail);const stop=poll(()=>api('/me/notifications'),apply,fail,2000);return()=>{active=false;stop();};},[user?.id]);
 const [state,dispatch]=useReducer(designReducer,initialDesignState);
 const [saved,setSaved]=useState([]),[visited,setVisited]=useState([]),[selection,setSelection]=useState(null);
 const navigate=useCallback((id,options={},mode={})=>{
   const next=nextRoute(route,id,options);if(next.screen==='01'&&!next.q)setQuery('');if(routeUrl(next)===routeUrl(route))return;
   if(mode.replace)history.replaceState(history.state,'',routeUrl(next));
   else history.pushState({andthen:true,from:routeUrl(route)},'',routeUrl(next));
   setRoute(next);if(!mode.replace)window.scrollTo({top:0});
 },[route]);
 useEffect(()=>{const back=()=>setRoute(readRoute(location.search));window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 useEffect(()=>{if(!toastText)return;const timer=setTimeout(()=>setToastText(''),2200);return()=>clearTimeout(timer);},[toastText]);
 useEffect(()=>{if(route.story)setVisited(items=>[route.story,...items.filter(id=>id!==route.story)]);},[route.story]);
 useEffect(()=>{setSaved([]);setVisited([]);setInteractions({});setPersonalFilters({});},[user?.id]);
 const developer=canUseDeveloperPages(user),allowed=mayOpenRoute(route,user);
 const story=followedStories.find(s=>s.id===route.story);
 const openStory=(title,target='02')=>{const item=followedStories.find(s=>s.title===title);if(item)navigate(target,{story:item.id});else setSelection({title});};
 const engagementFor=id=><Engagement screen={screen} fixtureId={id} user={user} onLogin={()=>setLoginOpen(true)} fixtureState={interactions[id]||emptyEngagement} onFixtureChange={value=>{setInteractions(all=>({...all,[id]:value}));setSaved(items=>value.saved?[...new Set([...items,id])]:items.filter(item=>item!==id));}}/>;
 const shared={navigate,interactions,state:{...state,followed:fixtureFollows.includes(route.story||'career')},dispatch:action=>{if(action.type==='follow'||action.type==='unfollow'){const id=route.story||'career';setFixtureFollows(ids=>action.type==='follow'?[...new Set([...ids,id])]:ids.filter(value=>value!==id));}dispatch(action);},toast:setToastText,openStory,engagement:engagementFor(route.story||'career'),onSearchTopic:q=>navigate('01',{q})};
 const personal=screen==='09';
 const active=personal&&route.tab==='notifications'?'04':personal&&route.tab==='following'?'03':personal&&route.tab==='answers'?'05':screen;
 const page=active==='05'?'作者工作台':active==='03'?'我的关注':personal?'账号':screen==='01'?'发现':'内容';
 const back=()=>{if(history.state?.andthen&&history.state.from)history.back();else navigate(['06','07','11'].includes(screen)?'05':'01');};
 const toggleSave=id=>{setSaved(items=>items.filter(item=>item!==id));setInteractions(all=>({...all,[id]:{...(all[id]||emptyEngagement),saved:false,saves:Math.max(0,(all[id]?.saves||0)-1)}}));};
 function collection(ids,title){return <Panel><h1>{title}</h1>{!ids.length?<p className="d-muted">{title==='我的收藏'?'还没有收藏回答。阅读回答时可点击收藏。':'本次浏览还没有记录。'}</p>:ids.map(id=>{const item=followedStories.find(s=>s.id===id);return item&&<article className="d-personal-list" key={id}><button className="d-story-title" onClick={()=>navigate('02',{story:id})}><h2>{item.title}</h2></button><p>{item.text}</p>{title==='我的收藏'&&<Button kind="ghost" onClick={()=>toggleSave(id)}>取消收藏</Button>}</article>;})}<p className="d-muted">仅保留本次打开期间的记录，尚未同步到账号。</p></Panel>;}
 const fixtureDetail=story&&story.id!=='career'&&['06','07','11'].includes(screen);
 return <div data-provenance={user?'account':'mixed_preview'} className={`design-shell screen-${screen} ${screen==='01'?'home-shell':''}`}><HomeHeader showWrite={true} showSearch={screen!=='01'||!!route.q} onLogin={()=>setLoginOpen(true)} user={user} notificationActive={active==='04'} unread={user?liveUnread:unreadNotificationCount(state.read)} onBack={['02','06','07','08','11','12'].includes(screen)?back:undefined} internal={screen==='10'&&allowed} page={page} onEnter={p=>navIds[p]?navigate(navIds[p],p==='账号'?{tab:'profile'}:{}):setToastText('该管理功能请在后台选择')} query={query} onQuery={setQuery} onSearch={()=>{if(query.trim())navigate('01',{...(screen==='01'?route:{}),q:query.trim(),page:undefined});}}/>
 <main className={screen==='01'?'shell-body':'d-content'}>
 {connectionError&&<Panel><p role="alert">{connectionError}</p><Button onClick={()=>location.reload()}>重新连接</Button></Panel>}
 {!allowed?<Panel><h1>此页面仅限管理员</h1><p>请使用已由服务器授予管理员权限的账号登录。</p><Button onClick={()=>setLoginOpen(true)}>登录账号</Button><Button kind="ghost" onClick={()=>navigate('01')}>返回发现</Button></Panel>:<>
 {screen==='01'&&(route.q?<SearchPage route={route} navigate={navigate} user={user} onLogin={()=>setLoginOpen(true)}/>:<DiscoveryPreview query={query} onQuery={setQuery} navigate={navigate} user={user} onLogin={()=>setLoginOpen(true)}>{user?<ConnectedHome query={query} onQuery={setQuery} navigate={navigate}/>:<Home preview interactions={interactions} items={[]} query={query} onQuery={setQuery} onSearch={filters=>{if(query.trim())navigate('01',{...filters,q:query.trim()});}} onFillImport={()=>navigate('12')} onUrl={()=>{}} onDesignOpen={item=>navigate('02',{story:item.id.replace('design-','')})}/>}</DiscoveryPreview>)}
 {personal&&<Account {...shared} tab={route.tab} user={user} onUser={onUser}>
 {route.tab==='profile'&&<ProfilePanel user={user} navigate={navigate} onLogin={()=>setLoginOpen(true)}/>}
 {route.tab==='saved'&&(user?<ConnectedSaved user={user} navigate={navigate}/>:collection(saved,'我的收藏'))}{route.tab==='history'&&(user?<ConnectedSaved history user={user} navigate={navigate}/>:collection(visited,'浏览历史'))}
 {user?(['following','notifications','answers'].includes(route.tab)&&<ConnectedPersonal key={user.id+route.tab} tab={route.tab} navigate={navigate} user={user} filter={personalFilters[route.tab]||'全部'} onFilter={value=>setPersonalFilters(filters=>({...filters,[route.tab]:value}))}/>):<><div hidden={route.tab!=='following'}><Following {...shared} items={followedStories.filter(item=>fixtureFollows.includes(item.id))} onUnfollow={item=>setFixtureFollows(ids=>ids.filter(id=>id!==item.id))}/></div><div hidden={route.tab!=='notifications'}><Notifications {...shared} embedded/></div><div hidden={route.tab!=='answers'}><Workbench {...shared}/></div></>}
 {route.tab==='settings'&&<SettingsPage user={user} onUser={onUser} onLogin={()=>setLoginOpen(true)} navigate={navigate}/>}
 </Account>}
 {personal&&developer&&<Panel><h3>开发者工具</h3>{['10','13','14','15'].map(id=><Button kind="ghost" key={id} onClick={()=>navigate(id)}>{screenNames[id]}</Button>)}</Panel>}
 {['02','06','07','08','11'].includes(screen)&&<>
 {route.source||route.followup||route.interview||route.draft||route.case||(user&&!route.story)?<ConnectedDetail key={routeUrl(route)} route={route} navigate={navigate} user={user} onLogin={()=>setLoginOpen(true)}/>:route.story&&!story?<Panel><h1>未找到这则故事</h1><Button onClick={back}>返回</Button></Panel>:fixtureDetail?<Panel><Tag>{story.category}</Tag><h1>{story.title}</h1><p>{story.author} · {story.date}</p><p className="d-prose">{story.text}</p><p className="d-muted">{screen==='02'?'这是设计示例中的回答摘要。':'这则示例尚未提供完整后续或回访材料。'}</p>{engagementFor(story.id)}<Button kind="ghost" onClick={back}>返回</Button></Panel>:<>{screen==='02'&&<Story key={route.story||'career'} {...shared} story={story?.id==='career'?{...story,text:storyParagraphs.join('\n\n'),tags:['职业选择','个人成长','独立开发']}:story}/>}{screen==='06'&&<Interview {...shared}/>} {screen==='07'&&<Publish {...shared}/>} {screen==='08'&&(story&&story.id!=='career'?<Story key={story.id} {...shared} story={story}/>:<Reading {...shared}/>)} {screen==='11'&&<Invite {...shared}/>}</>}
 </>}
 {screen==='10'&&<><ReportsPanel navigate={navigate}/><ReportsPanel feedback navigate={navigate}/><Admin {...shared}/></>} {screen==='12'&&(user?<ConnectedImport navigate={navigate} user={user}/>:<Import {...shared}/>)} {screen==='13'&&<States {...shared}/>} {screen==='14'&&<Overlays {...shared}/>} {screen==='15'&&<Components {...shared}/>}
 </>}
 </main><footer className="d-footer"><span>然后呢？　And Then? · {user?'已连接当前账号':'访客浏览 · 设计示例单独标识'}</span>{developer&&<label>开发预览 <select aria-label="演示页面" value={screen} onChange={e=>navigate(e.target.value)}>{Object.entries(screenNames).sort(([a],[b])=>a.localeCompare(b)).map(([id,name])=><option value={id} key={id}>{id} {name}</option>)}</select></label>}<button className="d-link" onClick={()=>setLoginOpen(true)}>{user?'切换账号':'登录账号'}</button></footer>
 {['01','09'].includes(screen)&&<DesignMobileNav screen={active} navigate={navigate} unread={user?liveUnread:unreadNotificationCount(state.read)}/>}
 {loginOpen&&<Modal title="账号登录" onClose={()=>setLoginOpen(false)}><SessionPanel user={user} onUser={onUser} onClose={()=>setLoginOpen(false)}/></Modal>}
 {selection&&<Modal title="故事摘要" onClose={()=>setSelection(null)}><h2>{selection.title}</h2><p>当前示例尚未提供这则故事的完整内容。</p></Modal>}
 {toastText&&<div role="status" className="d-toast">✓　{toastText}</div>}</div>;
}
