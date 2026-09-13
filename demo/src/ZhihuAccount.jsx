import React, {useEffect,useState} from 'react';
import {api} from './api.js';
export function ZhihuAccount() {
 const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function run(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const refresh=async()=>setState(await api('/me/zhihu'));
 useEffect(()=>{run(refresh);},[]);
 return <section><h2>知乎账号授权</h2>{error&&<p role="alert">{error}</p>}
 <p>{state?.authorized?`已授权：${state.display_name||state.uid}，有效至 ${state.expires_at}`:state?.bound?'已绑定身份，当前授权已过期或断开。':'尚未绑定知乎账号。'}</p>
 {!state?.available&&<p>真实授权暂不可用，等待应用凭证、HTTPS 回调和官方 state 回传确认。本站演示流程仍可使用。</p>}
 <button disabled={busy||!state?.available} onClick={()=>run(async()=>{const d=await api('/auth/zhihu/start','POST',{});location.assign(d.authorization_url);})}>{state?.authorized?'切换知乎账号':'使用知乎登录'}</button>
 <button disabled={busy} onClick={()=>run(refresh)}>刷新授权状态</button>
 {state?.authorized&&<><p>资料同步只读取官方允许的首批最多 20 条本人摘要。下面的操作表示同意这些资料用于私有采访和外部模型处理，并启用作者记忆；不授予公开展示许可。</p><button disabled={busy} onClick={()=>run(async()=>{await api('/me/zhihu/sync','POST',{accept_material_processing:true});await refresh();})}>同意资料处理并同步作者记忆</button><p>最近同步：{state.last_sync_at||'尚未完成'}。后台完成后，刷新站内身份并进入资料与记忆页查看。</p></>}
 {state?.bound&&<button disabled={busy} onClick={()=>run(async()=>{await api('/me/zhihu','DELETE');await refresh();})}>断开知乎授权</button>}
 <p>绑定不会自动发布、发送私信或取得任意全文。断开后本站删除授权令牌；平台端撤销请使用知乎自己的授权管理。</p>
 </section>;
}
