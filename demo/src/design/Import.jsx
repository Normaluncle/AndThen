import React,{useRef,useState} from 'react';
import {Art,Avatar,Button,Panel,Tag,Icon,Modal,storyTitle,storyParagraphs} from './shared.jsx';
import {validZhihuUrl} from './logic.js';
import {api} from '../api.js';
import {startImportedInterview} from './connected-actions.js';
import {claimError,claimNotice,claimState,emptyPreview,emptySteps,fixtureSteps,importPreview,latestSnapshot,resolveNotice,verificationSteps} from './import-flow.js';

/** The design preview: what an anonymous visitor sees. No data, no side effects. */
const fixturePreview={title:storyTitle,text:`${storyParagraphs[0]} ${storyParagraphs[1]}`,sourceLabel:'知乎公开回答',publishedLabel:'2021-06-12',authorName:'林下的风',authorNote:'前互联网产品，现独立创作者',originalUrl:null};

export function Import({navigate,toast,user,onLogin}){
 const [url,setUrl]=useState('https://www.zhihu.com/question/523456789/answer/987654321'),[text,setText]=useState(''),[error,setError]=useState(''),[confirm,setConfirm]=useState(false),[verified,setVerified]=useState(false),[expanded,setExpanded]=useState(true);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[loaded,setLoaded]=useState(null);
 const field=useRef(null);
 const preview=loaded?importPreview(loaded):(user?emptyPreview:fixturePreview);
 const steps=loaded?verificationSteps({...loaded,userId:user?.id}):(user?emptySteps():fixtureSteps({text,verified}));
 const author=preview.authorName,authorNote=preview.authorNote;
 const claimed=loaded?claimState({verifications:loaded.verifications,userId:user?.id}):null;
 function openOriginal(){if(preview.originalUrl){window.open(preview.originalUrl,'_blank','noopener,noreferrer');return;}toast(user?'请先导入并核验链接，再查看原链接。':'当前链接是设计稿示例，不会打开虚构知乎页面');}
 async function resolve(){
  if(!user){if(!validZhihuUrl(url)){setError('请填写有效的 HTTPS 知乎问题或回答链接。');return;}setError('');toast('已展示设计稿导入预览（演示，未请求知乎）');return;}
  if(!validZhihuUrl(url)){setError('请填写有效的 HTTPS 知乎问题或回答链接。');return;}
  setError('');setBusy(true);
  try{
   const result=await api('/sources/resolve','POST',{url});
   const detail=await api('/sources/'+result.source_id);
   const verifications=await api(`/sources/${result.source_id}/author-verifications`).catch(()=>({items:[]}));
   setLoaded({source:detail.source,snapshot:latestSnapshot(detail.snapshots),presentation:detail.presentation,candidate:result.candidate,verifications:verifications.items||[]});
   const message=resolveNotice(result);setNotice(message);toast(message);
  }catch(err){setError(err.message);}
  finally{setBusy(false);}
 }
 function askToConfirm(){if(!user){setConfirm(true);return;}if(!loaded){setError('请先粘贴并核验知乎链接。');return;}setConfirm(true);}
 async function confirmClaim(){
  const problem=claimError(text);
  if(problem){setError(problem);setConfirm(false);return;}
  setConfirm(false);setError('');setBusy(true);
  try{
   const result=await api(`/sources/${loaded.source.id}/author-claim`,'POST',{excerpt:text.trim(),confirms_own_content:true});
   setLoaded({...loaded,source:result.source,snapshot:result.snapshot,verifications:[...loaded.verifications,result.verification]});
   setExpanded(true);
   const message=claimNotice(result.analysis_status);setNotice(message);toast(message);
  }catch(err){setError(err.message);}
  finally{setBusy(false);}
 }
 async function continueFollowup(){
  if(!loaded){setError('请先粘贴并核验知乎链接。');return;}
  if(!user){onLogin();return;}
  if(claimed!=='claimed'&&claimed!=='verified'){setConfirm(true);return;}
  setError('');setBusy(true);
  try{
   const data=await startImportedInterview(api,loaded.source.id,{ownsContent:true,privateInterview:true,modelProcessing:true});
   navigate('06',{interview:data.session.id});
  }catch(err){setError(err.message);}
  finally{setBusy(false);}
 }
 function rowAction(index){if(index===1){setExpanded(true);requestAnimationFrame(()=>field.current?.focus());return;}askToConfirm();}
 return <div className="d-import" data-screen="12"><section className="d-import-hero"><div className="d-import-hero-copy"><h1><Icon name="link"/><span className="d-import-desktop-copy">从知乎链接导入一段过去的回答</span><span className="d-import-mobile-copy">从知乎链接导入回答</span></h1><p>粘贴知乎的问题或回答链接，导入内容并核验来源边界，然后继续创建回访。</p><form onSubmit={e=>{e.preventDefault();resolve();}}><input aria-label="知乎回答链接" value={url} onChange={e=>{setUrl(e.target.value);setVerified(false);}}/><button type="button" className="d-clear-url" aria-label="清空链接" onClick={()=>{setUrl('');setVerified(false);}}>×</button><Button disabled={busy} onClick={resolve}>导入并核验</Button></form><small>{error||notice||<><span className="d-import-desktop-copy">支持知乎的问题或回答链接，例如：https://www.zhihu.com/question/xxx/answer/xxx</span><span className="d-import-mobile-copy">支持知乎的问题或回答链接</span></>}</small></div><Art sheet="12" crop={[663,179,393,175]} label="从过去的知乎回答，走向新的后来"/></section><div className="d-two d-import-columns"><div><Panel className="d-import-preview"><h3 className="d-between">导入的内容预览<button className="d-link" onClick={openOriginal}>在知乎中查看原链接 ↗</button></h3><div className="d-import-story"><Art sheet="12" crop={[68,442,136,113]} label="原回答封面"/><div><h2>{preview.title}</h2><p>{preview.text}</p><div className="d-import-mobile-meta"><small>{preview.publishedLabel} · {preview.sourceLabel}</small><div><Avatar small/><b>{author}</b></div></div></div></div><div className="d-import-meta"><div><small>来源</small><Tag>{preview.sourceLabel}</Tag></div><div><small>发布时间</small><p>{preview.publishedLabel}</p></div><div><small>作者</small><p><Avatar small/><span>{author}<small>{authorNote}</small></span></p></div><div><small>原问题</small><button className="d-link" onClick={openOriginal}>{preview.title} ↗</button></div></div></Panel><Panel className={`d-supplement ${expanded?'expanded':'collapsed'}`}><h3><span className="d-import-desktop-copy">补充原文内容（可选）</span><button className="d-import-mobile-copy" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>补充原文内容（可选）<span>{expanded?'⌄':'›'}</span></button></h3><p>当前通过官方 API 获取到的是标题和摘要。为了生成更深入的回访，我们建议你粘贴原回答的完整内容或关键片段。</p><div><textarea ref={field} className="d-input" aria-label="原回答全文或选段" maxLength={5000} value={text} onChange={e=>setText(e.target.value)} placeholder="在这里粘贴原回答的全文或选段……"/><small>{text.length}/5000</small></div><p className="d-import-tip"><Icon name="bulb"/><span className="d-import-desktop-copy">提示：你可以从知乎页面复制回答内容粘贴到这里。我们仅用于生成此次回访，不会公开发布。</span><span className="d-import-mobile-copy">仅用于本次回访创作，不会公开发布。</span></p></Panel></div><Panel className="d-import-status"><h3>来源核验状态</h3>{steps.map((step,i)=><div className={`d-source-check ${step.tone}`} key={i}><span><Icon name={i===0?'checkCircle':i===1?'clock':'me'}/></span><div><b>{step.title}</b><p>{step.desc}</p>{step.action&&<Button kind="secondary" onClick={()=>rowAction(i)}><span className="d-import-desktop-copy">{step.action}</span><span className="d-import-mobile-copy">{i===1?'去粘贴':'确认身份'}</span></Button>}</div></div>)}<div className="d-blue-box"><h3><Icon name="info"/> 关于来源与使用</h3><p>我们通过知乎公开 API 获取公开内容，仅用于你个人的回访创作。请尊重原作者的版权与平台规则。</p></div></Panel></div><div className="d-import-actions"><Button kind="secondary" onClick={openOriginal}>查看原链接 ↗</Button><Button disabled={busy} onClick={()=>{if(!user){if(verified)navigate('11');else setConfirm(true);return;}continueFollowup();}}>继续创建回访 →</Button></div>{confirm&&<Modal title="确认这是你的回答？" onClose={()=>setConfirm(false)} actions={<><Button kind="ghost" onClick={()=>setConfirm(false)}>取消</Button><Button disabled={busy} onClick={()=>{if(!user){setVerified(true);setConfirm(false);toast('已确认演示身份；真实归属仍须服务器核验');return;}confirmClaim();}}>确认</Button></>}><p>{user?'确认后，服务器会把这则回答记为你本人的材料，并仅用于你个人的回访创作。核验通过前不会公开展示。':'本页展示设计稿示例，点击确认只改变演示状态，不会取得任何真实作者权限。'}</p>{user&&claimError(text)&&<p role="alert">{claimError(text)}</p>}</Modal>}</div>;
}
