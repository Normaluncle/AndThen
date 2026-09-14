import React,{useEffect,useState} from 'react';
import {api,setToken} from '../api.js';
import {Button,Panel,Tabs} from './shared.jsx';
import {playgroundResetAllowed} from '../publish-chrome.js';
import {continueAsRealReader,continueAsGuest,sessionTabs,judgeEntry,DEVELOPER_TAB_COPY} from './session-flow.js';
export function SessionPanel({user,onUser,onClose}){
 const [mode,setMode]=useState('真实使用'),[consent,setConsent]=useState(false);
 const [credential,setCredential]=useState(''),[adminSecret,setAdminSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [demo,setDemo]=useState(false);
 useEffect(()=>{api('/auth/demo/status').then(data=>setDemo(!!data.enabled&&judgeEntry(location.search))).catch(()=>setDemo(false));},[]);
 async function run(fn){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function identify(path,body){const data=await api(path,'POST',body);setToken(data.session_token||true);onUser((await api('/me')).user);setCredential('');onClose?.();}
 // The reader session is only the pre-step for the Zhihu authorization, so the
 // panel stays open (and does not navigate to the account page) until the
 // browser leaves for the provider.
 function acceptReader(data){setToken(data.session_token||true);onUser(data.user);}
 async function resetPlayground(){if(!playgroundResetAllowed(user)){setError('刷新演示只适用于本地演示读者和模拟作者。');return;}const result=await api('/auth/demo/reset','POST',{});setNotice(`演示数据已刷新，共 ${result.stories} 则【演示】故事，可以重新体验关注和问询。`);}
 return <Panel><h2>{user?'当前登录账号':'选择使用方式'}</h2>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {user?<><p>{user.display_name||'当前账号'} · {{reader:'读者',author:'作者',researcher:'研究人员',admin:'管理员'}[user.role]||user.role}</p><p>身份由服务器确认。</p>
  {demo&&playgroundResetAllowed(user)&&<Button disabled={busy} kind="secondary" onClick={()=>run(resetPlayground)}>刷新演示数据</Button>}
  <Button disabled={busy} kind="secondary" onClick={()=>run(async()=>{await api('/auth/logout','POST');setToken(false);onUser(null);})}>退出登录</Button>
 </>:<>
  <Tabs items={sessionTabs(demo)} value={mode} onChange={setMode}/>
  {mode==='真实使用'?<><p>继续后会跳转到知乎授权页，用你的知乎账号登录本站。授权完成后昵称和头像都来自该账号，不是游客身份。</p><label className="d-consent-row"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>同意创建本站读者会话，用于保存我的关注和互动记录</label><Button disabled={busy||!consent} onClick={()=>run(()=>continueAsRealReader(api,{onReader:acceptReader,assign:url=>location.assign(url)}))}>以真实读者身份继续</Button><Button kind="ghost" disabled={busy||!consent} onClick={()=>run(async()=>{await continueAsGuest(api,{onReader:acceptReader});onClose?.();})}>暂不连接知乎，仅以访客浏览</Button></>
  :mode==='体验演示'?<><p>使用服务器预设的测试账号了解完整流程。内容均标记为【演示】，不能冒充知乎原作者。</p>
    <div className="d-actions">
      <Button kind="secondary" disabled={busy} onClick={()=>run(()=>identify('/auth/demo/reader',{}))}>演示读者</Button>
      <Button kind="secondary" disabled={busy} onClick={()=>run(()=>identify('/auth/demo/author',{}))}>模拟作者</Button>
    </div>
    <form onSubmit={e=>{e.preventDefault();run(()=>identify('/auth/demo/admin',{password:adminSecret}));}}>
      <label>管理员密码<input className="d-input" type="password" autoComplete="current-password" value={adminSecret} onChange={e=>setAdminSecret(e.target.value)}/></label>
      <Button disabled={busy||adminSecret.length<8} type="submit">进入管理后台</Button>
    </form>
    <p className="d-muted">评委可以反复体验关注和问询：点下方按钮会清空演示进度并重建三则完整示例。</p>
    <Button disabled={busy} kind="ghost" onClick={()=>run(resetPlayground)}>刷新演示数据</Button>
  </>
  :<form onSubmit={e=>{e.preventDefault();run(()=>identify('/auth/sessions',{login_token:credential}));}}><p>{DEVELOPER_TAB_COPY}</p><label>一次性登录凭证<input className="d-input" type="password" autoComplete="off" value={credential} onChange={e=>setCredential(e.target.value)}/></label><Button disabled={busy||credential.length<16} type="submit">登录</Button></form>}
 </>}</Panel>;
}
