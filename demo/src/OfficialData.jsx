import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import {poll} from './workflow.js';

export function OfficialData(){
 const [list,setList]=useState(null),[url,setUrl]=useState(''),[content,setContent]=useState(null),[comments,setComments]=useState(null),[source,setSource]=useState(''),[job,setJob]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function run(fn){setError('');setBusy(true);try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 useEffect(()=>{
  if(!job?.job_id||!['queued','running'].includes(job.status))return;
  return poll(()=>api('/jobs/'+job.job_id),setJob,e=>setError(e.message));
 },[job?.job_id,job?.status]);
 return <section><h1>官方数据读取与同步</h1><p>这些操作只读取当前配置的知乎凭证所属账号。这里的全文、评论能力不会自动转移给其他 OAuth 用户，也不会替账号发文或评论。</p>
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">读取中…</p>}
 <button disabled={busy} onClick={()=>run(async()=>setList(await api('/integrations/zhihu/creator/contents')))}>读取本人前 20 条内容摘要</button>
 {list&&<><p>{list.items.length?`本页可用内容 ${list.items.length} 条。`:'这一页没有可导入的回答或文章。'}{list.paging.is_end?'已到列表末尾。':''}{list.paging.stopped_reason?'官方分页游标异常，已停止。':''}</p>{list.items.map(x=><article key={x.url}><h2>{x.title}</h2><p>{x.text}</p><a href={x.url} target="_blank" rel="noreferrer">在知乎查看</a><button onClick={()=>{setUrl(x.url);setContent(null);setComments(null);}}>选择这篇内容</button></article>)}{list.paging.next_offset&&<button disabled={busy} onClick={()=>run(async()=>setList(await api('/integrations/zhihu/creator/contents?offset='+list.paging.next_offset)))}>下一页摘要</button>}</>}
 <label>本人内容链接<input value={url} onChange={e=>{setUrl(e.target.value);setContent(null);setComments(null);}}/></label>
 <button disabled={busy||!url} onClick={()=>run(async()=>setContent(await api('/integrations/zhihu/creator/content?url='+encodeURIComponent(url))))}>读取官方全文</button>
 <button disabled={busy||!url} onClick={()=>run(async()=>setComments(await api('/integrations/zhihu/creator/comments?url='+encodeURIComponent(url))))}>读取第一页评论</button>
 {content&&<article><h2>{content.title}</h2><p>官方原始正文。为避免执行上游代码，此操作页以纯文本显示 HTML。</p><p className="body">{content.body}</p></article>}
 {comments&&<article><h2>官方评论</h2><p>按页读取根评论；附带回复不保证覆盖全部楼中楼。</p>{comments.items.map(x=><div key={x.id}><p>{x.text}</p>{x.author_url&&<a href={x.author_url} target="_blank" rel="noreferrer">评论作者的知乎主页</a>}{x.children.map(c=><p key={c.id}>回复：{c.text}</p>)}</div>)}{comments.paging.next_offset&&<button disabled={busy} onClick={()=>run(async()=>setComments(await api('/integrations/zhihu/creator/comments?url='+encodeURIComponent(comments.url)+'&offset='+comments.paging.next_offset)))}>下一页评论</button>}{comments.paging.stopped_reason&&<p>分页游标异常，已停止。</p>}</article>}
 <h2>把评论单向同步到本站故事</h2><p>每次处理一页，重复的评论按官方 ID 更新。来源必须是凭证账号本人的知乎内容；正文的公开授权规则仍然有效。</p><label>本站来源编号<input value={source} onChange={e=>setSource(e.target.value)}/></label>
 <button disabled={busy||!source||['queued','running'].includes(job?.status)} onClick={()=>run(async()=>{const result=await api(`/sources/${source}/zhihu/comments/sync`,'POST');setJob({...result,status:'queued'});})}>同步下一页评论</button>
 {job&&<p role="status">任务状态：{job.status}{job.result?.is_end?'，已读取到当前末页。':''}{job.result?.stopped_reason?'，官方游标异常，已停止。':''}{job.status==='failed'?'。本页未记为成功，可检查权限或额度后重试。':''}</p>}
 </section>;
}
