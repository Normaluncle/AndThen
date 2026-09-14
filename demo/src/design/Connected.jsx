import {followingItems} from './following-items.js';
import {Story} from './Story.jsx';
import {StoryCover} from '../StoryCover.jsx';
import {Following} from './Following.jsx';
import {NoticeList} from './NoticeList.jsx';
import React,{useState,useEffect} from 'react';
import {api} from '../api.js';
import {internalSearchUrl} from './search-model.js';
import {Engagement} from './Engagement.jsx';
import {draftVersionRoute} from './navigation.js';
import {startOwnInterview,publishOwnDraft,notificationTarget} from './connected-actions.js';
import {SourceMaterials} from '../SourceMaterials.jsx';
import {Home} from '../Home.jsx';
import {InterviewPage,DraftPage} from '../WorkflowPages.jsx';
import {Article} from '../Article.jsx';
import {ReasonPicker} from '../ReasonPicker.jsx';
import {ZhihuAccount} from '../ZhihuAccount.jsx';
import {MemoryMaterials} from '../MemoryMaterials.jsx';
import {draftActions,interviewActions,poll} from '../workflow.js';
import {workbenchTabs} from '../ui14.js';
import {Panel,Button,Tabs,Modal,Tag} from './shared.jsx';
import {ParticipationDialog} from './ParticipationDialog.jsx';
import {Workbench} from './Workbench.jsx';
import {WorkbenchCard} from './WorkbenchCard.jsx';
import {liveWorkbenchCard} from './workbench-card.js';
import {Toggle} from './Account.jsx';

function useResource(path,refreshMs=0){
 const [value,setValue]=useState(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setValue(null);setError('');if(!path)return;
 const load=()=>api(path);const apply=data=>{if(active){setValue(data);setError('');}};const fail=e=>{if(active){setValue(null);setError(e.message);}};
 load().then(apply).catch(fail);const stop=refreshMs?poll(load,apply,fail,refreshMs):()=>{};
 return()=>{active=false;stop();};},[path,refreshMs,revision]);
 return {value,error,reload:()=>setRevision(n=>n+1)};
}
function ResourceStatus({resource}){return resource.error?<Panel><p role="alert">{resource.error}</p><Button onClick={resource.reload}>重试</Button></Panel>:<Panel><p role="status">正在读取…</p></Panel>;}
function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,run:async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}};}
function ActionError({action}){return action.error?<p role="alert">{action.error}</p>:null;}

export function ConnectedHome({query,onQuery,navigate}){
 const [filters,setFilters]=useState({}),[candidate,setCandidate]=useState(null);
 const resource=useResource(internalSearchUrl(filters));
 const action=useAction();
 return <><Home items={resource.value?.items||[]} query={query} onQuery={onQuery} filterOptions={filters} onFilters={setFilters} onSearch={()=>{if(query.trim())navigate('01',{...filters,q:query.trim()});}} onOpen={source=>navigate('02',{source})} onInterest={item=>navigate('02',{candidate:item.candidate_id})} onFillImport={()=>navigate('12')} onUrl={()=>{}} busy={!resource.value&&!resource.error}/>{!resource.value&&<ResourceStatus resource={resource}/>}<ActionError action={action}/>{candidate&&<Modal title="关注这则故事的后来" onClose={()=>setCandidate(null)} actions={<Button disabled={action.busy} onClick={()=>action.run(async()=>{await api(`/discovery/candidates/${candidate.candidate_id}/interest`,'PUT',{active:true});setCandidate(null);navigate('03');})}>关注后续</Button>}><p>{candidate.title}</p><ActionError action={action}/></Modal>}</>;
}

export function ConnectedPersonal({tab,navigate,user,onLogin}){
 const [filter,setFilter]=useState('全部');
 const loaded=useResource(user?(tab==='following'?'/me/following':tab==='notifications'?'/me/notifications':'/me/workbench'):null,tab==='following'?0:2000);
 const resource=user?loaded:{value:{items:[]}};
 const candidates=useResource(tab==='following'&&user?'/discovery/following':null);
 const [invite,setInvite]=useState(null),[consents,setConsents]=useState({}),[confirmed,setConfirmed]=useState(false);
 const action=useAction();
 if(!resource.value)return <ResourceStatus resource={resource}/>;
 const rows=resource.value.items||[];
 if(tab==='following'){const merged=followingItems(rows,candidates.value?.items||[]);const entries=[...merged.stories.map(item=>({...item,id:item.source_id,source_id:item.source_id,title:item.title||'暂不可用的故事',date:item.published_at?.slice(0,10),author:'原回答作者',text:item.text||'',updated:item.update?.status==='published',followup:item.update?.status==='published'?item.update.version_id:null,status:item.available===false?'暂不可用':item.update?.status==='published'?'已有后来':'等待作者回应',tone:item.update?.status==='published'?'green':'orange',reason:'查看故事与后续',fixture:false})),...merged.candidates.map(item=>({...item,id:item.candidate_id,source_id:item.linked_source_id,author:item.author_name,status:'等待作者回应',tone:'orange',reason:'等待收录后续',fixture:false}))];return <><Following items={entries} navigate={navigate} busy={action.busy} onOpen={item=>item.followup?navigate('08',{followup:item.followup}):item.candidate_id?navigate('02',{candidate:item.candidate_id}):item.source_id?navigate('02',{source:item.source_id}):window.open(item.url,'_blank','noopener,noreferrer')} onUnfollow={item=>action.run(async()=>{await api(item.candidate_id?`/discovery/candidates/${item.candidate_id}/interest`:`/stories/${item.source_id}/interest`,'PUT',{active:false});resource.reload();candidates.reload();})}/><ActionError action={action}/></>;}
 if(tab==='notifications')return <><NoticeList items={rows} filter={filter} onFilter={setFilter} onRead={item=>action.run(async()=>{await api(`/notifications/${item.id}/read`,'POST');resource.reload();})} onOpen={item=>action.run(async()=>{const target=notificationTarget(item);await api(`/notifications/${item.id}/read`,'POST');navigate('08',target);})}/><ActionError action={action}/></>;
 const tabs=workbenchTabs(rows),selected=tabs.find(item=>item.label===filter)||tabs[0];
 return <><Workbench interestCount={user?rows.reduce((sum,item)=>sum+(item.interest_count||0),0):undefined} content={<><Tabs items={tabs.map(item=>item.label)} value={selected.label} onChange={setFilter}/>{selected.items.map(item=>{const card=liveWorkbenchCard(item);return <WorkbenchCard key={item.id} card={card} onAction={()=>{if(card.action.invite){setConsents({});setConfirmed(false);setInvite(item);}else navigate(card.action.screen,card.action.options);}}/>;})}{!selected.items.length&&<p>这一栏暂时没有回答。</p>}<Button kind="secondary" onClick={()=>user?navigate('12'):onLogin()}>导入我的回答</Button><ActionError action={action}/></>}/>{invite&&<ParticipationDialog title={invite.title} busy={action.busy} onClose={()=>{if(!action.busy)setInvite(null);}} onStart={()=>action.run(async()=>{
  const data=await startOwnInterview(api,invite,{ownsContent:confirmed,privateInterview:consents.private_interview,modelProcessing:consents.external_model_processing});
  setInvite(null);navigate('06',{interview:data.session.id});
 })}><label className="d-consent-row"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>确认这是我本人的回答，且已核对当时的内容</label>{[['private_interview','同意私有采访'],['external_model_processing','同意将相关资料交给模型处理']].map(([purpose,label])=><label className="d-consent-row" key={purpose}><input type="checkbox" checked={!!consents[purpose]} onChange={e=>setConsents({...consents,[purpose]:e.target.checked})}/>{label}</label>)}<ActionError action={action}/></ParticipationDialog>}</>;
}

export function ConnectedDetail({route,navigate,user,onLogin}){
 const path=route.draft?'/drafts/'+route.draft:route.interview?'/interviews/'+route.interview:route.followup?'/followups/'+route.followup:route.source?'/stories/'+route.source:null;
 const resource=useResource(path,route.interview?2000:0),action=useAction();
 const related=useResource(route.source||route.followup?'/stories?limit=4':null);
 const following=useResource(route.source&&user?'/me/following':null);
 const [answer,setAnswer]=useState(''),[visibility,setVisibility]=useState('public'),[reason,setReason]=useState(false),[draft,setDraft]=useState(null),[saved,setSaved]=useState(''),[pending,setPending]=useState(false),[publish,setPublish]=useState(false),[withdraw,setWithdraw]=useState(false),[publicConsent,setPublicConsent]=useState(false);
 useEffect(()=>{setReason(!!following.value?.items?.some(item=>item.source_id===route.source));},[following.value,route.source]);
 useEffect(()=>{const source=route.source||resource.value?.source_id;if(user&&source&&resource.value)api(`/stories/${source}/read`,'PUT',{}).catch(()=>{});},[user?.id,route.source,resource.value]);
 function loadDraft(value){setDraft(value);setSaved(JSON.stringify(value.statements));const next=draftVersionRoute(route,value);if(next)navigate(next.screen,{draft:next.draft},{replace:true});}
 useEffect(()=>{if(route.draft&&resource.value)loadDraft(resource.value);},[resource.value,route.draft]);
 if(!path)return <Panel><h1>请选择一条自己的回答</h1><Button onClick={()=>navigate('05')}>返回我的回答</Button></Panel>;
 if(!resource.value)return <ResourceStatus resource={resource}/>;
 const data=resource.value;
 const recommendations=<>{(related.value?.items||[]).filter(item=>item.source_id!==(route.source||data.source_id)).slice(0,3).map(item=><button className="d-related" key={item.source_id} onClick={()=>navigate('02',{source:item.source_id})}><StoryCover item={item}/><span><b>{item.title}</b><small>本站故事</small></span></button>)}<Button kind="soft" onClick={()=>navigate('01')}>发现更多故事 →</Button></>;
 async function interviewAction(name){try{await api(`/interviews/${route.interview}/${name}`,'POST',{expected_version:data.session.revision});resource.reload();}catch(e){if(e.status===409)resource.reload();throw e;}}
 return <div className="d-connected"><ActionError action={action}/>{route.source&&<Story story={{...data.story,source_id:route.source,updated:!!data.story.published_followup}} navigate={navigate} recommendations={recommendations} engagement={<Engagement sourceId={route.source} user={user} onLogin={onLogin}/>} followSlot={<div className="d-interest"><h2>然后呢？</h2><p>想知道这段经历后来发生了什么吗？</p>{data.story.published_followup&&<Button kind="soft" onClick={()=>navigate('08',{followup:data.story.published_followup.version_id})}>阅读作者的后来 →</Button>}<Button disabled={action.busy} onClick={()=>{if(!user){onLogin();return;}action.run(async()=>{await api(`/stories/${route.source}/interest`,'PUT',{active:!reason});setReason(!reason);});}}>{reason?'取消关注':'关注后续'}</Button>{reason&&<ReasonPicker sourceId={route.source}/>}</div>}/>}
 {route.followup&&<div className="d-two d-reading"><Panel className="d-reading-main"><Tag>作者的后来</Tag><h1>这段经历，后来怎么样了？</h1><p className="d-muted">{data.published_at?.slice(0,10)} · 作者自述{data.ai_assisted?'，AI 辅助整理':''}</p><div className="d-reading-blocks">{data.statements?.map(statement=><Article key={statement.id} statement={statement}/>)}</div>{data.source_id&&<><Button kind="secondary" onClick={()=>navigate('02',{source:data.source_id})}>查看原回答</Button><Engagement followupId={route.followup} sourceId={data.source_id} user={user} onLogin={onLogin}/></>}</Panel><aside className="d-sidebar"><Panel><h3>这篇文章的来龙去脉</h3><p>这是作者已确认并公开展示的后续。可以回到原回答了解故事的起点。</p><Button kind="soft" onClick={()=>navigate('02',{source:data.source_id})}>查看原回答 →</Button></Panel><Panel><h3>你可能也感兴趣</h3>{recommendations}</Panel></aside></div>}
 {route.interview&&<InterviewPage session={data.session} messages={data.messages||[]} answer={answer} answerVisibility={visibility} busy={action.busy} interviewState={interviewActions(data.session,data.messages||[])} onAnswer={setAnswer} onVisibility={setVisibility} onSave={()=>action.run(async()=>{await api(`/interviews/${route.interview}/messages`,'POST',{message:answer,visibility,client_message_id:crypto.randomUUID(),expected_version:data.session.revision});setAnswer('');resource.reload();})} onSkip={()=>action.run(async()=>{await api(`/interviews/${route.interview}/messages`,'POST',{skip:true,client_message_id:crypto.randomUUID(),expected_version:data.session.revision});resource.reload();})} onPause={()=>action.run(()=>interviewAction('pause'))} onResume={()=>action.run(()=>interviewAction('resume'))} onFinish={()=>action.run(()=>interviewAction('finish'))} onRetry={()=>action.run(()=>interviewAction('retry'))} onRefresh={resource.reload} onDraft={()=>action.run(async()=>{const result=await api(`/interviews/${route.interview}/draft`,'POST');navigate('07',{draft:result.id});})}/>}
 {route.draft&&draft&&<DraftPage draft={draft} draftState={draftActions(draft,saved)} draftJobPending={pending} busy={action.busy} onDraft={loadDraft} onPending={setPending} onChange={setDraft} onSave={()=>action.run(async()=>loadDraft(await api(`/drafts/${draft.id}`,'PATCH',{expected_version:draft.version,statements:draft.statements})))} onConfirm={()=>action.run(async()=>{await api(`/drafts/${draft.id}/confirm`,'POST',{content_hash:draft.contentHash,statement_ids:draft.statements.map(item=>item.id)});loadDraft(await api('/drafts/'+draft.id));})} onPublish={()=>{setPublicConsent(false);setPublish(true);}} onWithdraw={()=>setWithdraw(true)}/>}
 {publish&&<Modal title="确认发布到本站？" onClose={()=>setPublish(false)} actions={<Button disabled={action.busy||!publicConsent} onClick={()=>action.run(async()=>{loadDraft(await publishOwnDraft(api,draft,publicConsent));setPublish(false);})}>确认发布</Button>}><p>公开后，关注这则故事的读者可以阅读。服务端会检查公开展示许可及当前版本确认。</p><label><input type="checkbox" checked={publicConsent} onChange={e=>setPublicConsent(e.target.checked)}/>我同意在本站公开展示原材料与当前后来版本</label><ActionError action={action}/></Modal>}
 {withdraw&&<Modal title="确认撤回这则后来？" onClose={()=>setWithdraw(false)} actions={<Button kind="danger" disabled={action.busy} onClick={()=>action.run(async()=>{await api(`/followups/${draft.id}/withdraw`,'POST',{reason:'作者主动撤回'});loadDraft(await api('/drafts/'+draft.id));setWithdraw(false);})}>撤回</Button>}><p>撤回后读者将无法继续读取这一版本。</p><ActionError action={action}/></Modal>}
 </div>;
}

export function ConnectedImport({navigate,user}){
 const [url,setUrl]=useState(''),[result,setResult]=useState(null);const action=useAction();
 return <><Panel><h1>链接导入与核验</h1><p>粘贴知乎回答或文章链接，核验结果以服务器返回为准。</p><form onSubmit={e=>{e.preventDefault();action.run(async()=>setResult(await api('/sources/resolve','POST',{url})));}}><input className="d-input" type="url" required aria-label="知乎链接" value={url} onChange={e=>{setUrl(e.target.value);setResult(null);}}/><Button type="submit" disabled={action.busy}>读取链接</Button></form><ActionError action={action}/>{result&&<><p role="status">{result.status==='pending_content'?'已登记链接，官方渠道暂未取得正文。':'已取得材料，后续仍需核验归属与许可。'}</p><Button onClick={()=>navigate('05')}>查看我的回答</Button></>}</Panel>{['author','researcher','admin'].includes(user?.role)&&<Panel><SourceMaterials role={user.role}/></Panel>}</>;
}

export function ConnectedSettings({user}){
 const resource=useResource('/me/memory',2000),action=useAction();
 return <><Panel><h2>知乎账号</h2><ZhihuAccount key={user.id}/></Panel><Panel><h2>AI 资料与记忆</h2><p className="d-muted">个人经历、人生阶段和关注主题由 memU 从授权材料中整理；以下为只读结果，不需要手动填写。关注故事不会自动关注作者的全部主题。</p>{!resource.value?<ResourceStatus resource={resource}/>:<><p>状态：{resource.value.status}</p><div className="d-between"><span>允许处理已核验的本人材料</span><Toggle label="AI 资料处理同意" value={resource.value.enabled===true} onChange={value=>action.run(async()=>{await api('/me/memory/consent','PUT',{enabled:value});resource.reload();})}/></div><Button kind="secondary" disabled={action.busy} onClick={()=>action.run(async()=>{await api('/me/memory/refresh','POST');resource.reload();})}>刷新资料</Button><MemoryMaterials materials={resource.value.materials}/>{resource.value.records?.map(record=><article className="d-personal-list" key={record.name}><h3>{record.name}</h3><p>{record.content}</p><small>来源材料：{record.source_id}</small></article>)}</>}<ActionError action={action}/></Panel><Panel><h2>个人资料</h2><p>{user.display_name||'尚未设置显示名'}</p><p className="d-muted">显示名来自当前账号或知乎授权。职业、人生阶段和主题由 AI 资料与记忆返回，不需要重复填写。</p></Panel></>;
}
