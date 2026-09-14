import {followedStories} from './Following.jsx';
import {StoryCover} from '../StoryCover.jsx';
import React,{useState} from 'react';
import {AvatarGroup,Button,Tag,Panel,Icon,Modal,storyTitle,storyParagraphs} from './shared.jsx';
import {HomeImage} from '../Home.jsx';
import {FOLLOW_REASONS} from '../publish-chrome.js';
export const reasons=FOLLOW_REASONS;
export function ReasonChoices({value,onChange,poll,locked=false}){
 return <div className="d-reasons" data-region="reason-picker">{reasons.map(([title,detail],i)=>{
  const tag=poll?.tags?.find(item=>item.tag===title);
  const pct=locked?Number(tag?.percentage||0):null;
  return <label key={title} className={`${value===i?'selected':''} ${locked?'polled':''}`}>
   {locked&&<i className="d-reason-fill" style={{'--pct':(pct||0)/100}}/>}
   <input type="radio" name="reason" checked={value===i} disabled={locked} onChange={()=>onChange(i)}/>
   <span><b>{title}</b>{locked?<small className="d-reason-pct">{pct}%</small>:<small>{detail}</small>}</span>
  </label>;
 })}</div>;
}
export function FollowBlock({followed=false,onFollow,busy=false,notice,extra,cta='关注后续',poll}){
 const [reason,setReason]=useState(0),[other,setOther]=useState(''),[consent,setConsent]=useState(false);
 const locked=!!followed;
 const otherReady=reason!==3||(Array.from(other).length>0&&consent);
 return <div className="d-interest" data-region="interest-panel"><h2><HomeImage crop={[69,114,26,30]}/>然后呢？</h2><p className="d-interest-intro">想知道这段经历后来发生了什么吗？</p><b>你更想知道什么？</b><ReasonChoices value={reason} onChange={setReason} poll={poll} locked={locked}/>{reason===3&&!locked&&<><textarea className="d-input" aria-label="补充问题" placeholder="写下你想了解的后来…" value={other} onChange={e=>setOther(Array.from(e.target.value).slice(0,20).join(''))}/><label className="d-consent-row"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>同意将这句疑问用于归类和采访选题</label></>}{extra}<Button className="wide" disabled={busy||(!followed&&!otherReady)} onClick={()=>onFollow?.(reason,other,consent)}>{followed?'取消关注':cta}</Button>{locked&&<div className="d-follow-count"><AvatarGroup/><b>已有 {poll.total} 人和你一样关注这个事情</b></div>}{notice}</div>;
}
export function Story({navigate,state={},dispatch=()=>{},toast=()=>{},engagement,onSearchTopic,story,followSlot,recommendations}){
 const [expanded,setExpanded]=useState(false),[original,setOriginal]=useState(false);
 const item=story||{id:'career',title:storyTitle,category:'职场发展',author:'林下的风',date:'2021-06-12',text:storyParagraphs.join('\n\n')};
 const paragraphs=(item.text||'正文暂未提供。').split(/\n+/).filter(Boolean);
 const interest=followSlot||<FollowBlock followed={state.followed} onFollow={(choice)=>{dispatch({type:state.followed?'unfollow':'follow',reason:choice});toast(state.followed?'已取消这则关注（体验）':'已记录关注偏好（体验）');}}/>;
 return <div className="d-two d-story-page" data-screen="02"><Panel className="d-story-main"><Tag>{item.category||'故事'}</Tag><h1 data-region="story-title">{item.title||'尚未命名的故事'}</h1><div className="d-story-meta"><span>{item.date||item.published_at?.slice(0,10)||'发布时间未知'} · 原回答</span>{item.original_url||item.url?<a href={item.original_url||item.url} target="_blank" rel="noreferrer">查看原回答 ↗</a>:<button className="d-link" onClick={()=>setOriginal(true)}>查看原回答 ↗</button>}</div><div className="d-author"><span className="d-profile-initial">{(item.author||'作').slice(0,1)}</span><b>{item.author||'原回答作者'}</b></div><div className={`d-story-body ${expanded?'expanded':''}`} data-region="story-body">{paragraphs.map((p,i)=><p key={i}>{p}</p>)}</div><button className="d-expand" onClick={()=>setExpanded(!expanded)}>{expanded?'收起全文⌃':'展开全部⌄'}</button>{engagement?React.cloneElement(engagement,{afterToolbar:interest}):interest}</Panel><aside className="d-sidebar"><Panel><h3>故事信息</h3><div className="d-info-box"><p><Icon name="calendar"/>发布时间 <span>{item.date||item.published_at?.slice(0,10)||'未知'}</span></p><p><Icon name="book"/>来源 <span>原回答</span></p><p><Icon name="shield"/>状态 <Tag tone={item.updated?'green':'orange'}>{item.updated?'已有后来':'等待后来'}</Tag></p></div><div className="d-blue-box"><h3>每段经历，都有后来</h3><p>关注这段经历，让时间补充当时的答案。</p></div></Panel><Panel><h3>相关话题</h3><div className="d-tags">{(item.tags||[item.category||'人生经历']).map(t=><button className="d-tag blue" key={t} onClick={()=>onSearchTopic?onSearchTopic(t):navigate('01',{q:t})}># {t}</button>)}</div></Panel><Panel><h3>你可能也感兴趣</h3>{recommendations||(item.source_id?<Button kind="soft" onClick={()=>navigate('01')}>发现更多故事 →</Button>:followedStories.filter(s=>s.id!==item.id).slice(0,3).map(s=><button className="d-related" key={s.id} onClick={()=>navigate('02',{story:s.id})}><StoryCover item={s}/><span><b>{s.title}</b><small>{s.category} · 设计示例</small></span></button>))}</Panel></aside>{original&&<Modal title="原回答" onClose={()=>setOriginal(false)}><h3>{item.title}</h3>{paragraphs.map((p,i)=><p key={i}>{p}</p>)}<small>{item.source_id?'原始外链未提供，以上为本站可展示的材料。':'当前为体验材料；原始外链未提供。'}</small></Modal>}</div>;
}
