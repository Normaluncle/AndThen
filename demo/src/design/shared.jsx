import React, {useEffect, useRef} from 'react';
import {HomeIcon, HomeImage} from '../Home.jsx';
export const Icon = HomeIcon;

export function Art({sheet, crop, size = [1536,1024], className = '', label}) {
  const [x,y,w,h] = crop;
  return <span className={`d-art ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{aspectRatio:`${w}/${h}`}}><img src={`/design/${sheet}.png`} alt="" style={{width:`${size[0]/w*100}%`,left:`${-x/w*100}%`,top:`calc(${-y/w} * 100cqw)`}} /></span>;
}
export function Avatar({small=false, woman=false}) {
  return woman ? <HomeImage className={`d-avatar ${small?'small':''}`} crop={[1001,113,31,31]} /> : <Art sheet="02" size={[1448,1086]} crop={[72,305,44,44]} className={`d-avatar ${small?'small':''}`} />;
}
export function AvatarGroup(){return <span className="d-avatar-group"><Avatar small woman/><Avatar small/><Avatar small woman/></span>;}
export function Button({children,kind='primary',className='',...props}){return <button type="button" className={`d-button ${kind} ${className}`} {...props}>{children}</button>;}
export function Tag({children,tone='blue'}){return <span className={`d-tag ${tone}`}>{children}</span>;}
export function Panel({children,className='',...props}){return <section className={`d-panel ${className}`} {...props}>{children}</section>;}
export function Tabs({items,value,onChange}){return <nav className="d-tabs" aria-label="页面分类">{items.map(item=><button key={item} className={value===item?'active':''} onClick={()=>onChange(item)}>{item}</button>)}</nav>;}
export function Author({date,follow,onFollow,subtitle='前互联网产品，现独立创作者'}){return <div className="d-author"><Avatar/><div><b>林下的风</b><p>{date||subtitle}</p></div>{onFollow&&<Button kind="soft" onClick={onFollow}>{follow?'已关注':'+ 关注'}</Button>}</div>;}
export function Metrics({share}){return <div className="d-metrics"><span><Icon name="like"/>1.2 万</span><span><Icon name="comment"/>892</span><span><Icon name="star"/>1,503</span>{share&&<button onClick={share}>↗ 分享</button>}<span className="d-more">···</span></div>;}
export const storyTitle='辞职去做自己真正喜欢的事情，值得吗？';
export const storyParagraphs=[
 '我在大厂工作了五年，收入稳定，但总觉得自己像一颗螺丝钉。',
 '上周我提交了辞职申请，准备给自己半年的时间，去做一直想做的独立开发。虽然不知道未来会怎样，但我想试一次。',
 '这些年我学会了很多，也见过很多更厉害的人，但内心始终有一个声音：我真正喜欢的，还是创造一些属于自己的东西，而不是在既定的流程里不断优化。',
 '我知道这条路不一定更轻松，甚至可能更难。但如果一直不去尝试，可能会在很多年后后悔吧。人生很长，也很短。我不想在三十岁的时候，就过上五十岁才会后悔的生活。',
 '所以，辞职去做自己真正喜欢的事情，我觉得是值得的。\n即使结果不如预期，至少我认真地走过这一段路。',
];
export function OriginalStory(){return <><Author date="2021-06-12"/>{storyParagraphs.map(p=><p key={p} className="d-prose">{p}</p>)}<p className="d-muted">1.2 万人赞同了该回答</p></>;}
export function Modal({kind='modal',title,children,onClose,actions}) {
  const panel=useRef(null),closeRef=useRef(onClose),touchStart=useRef(null); closeRef.current=onClose;
  useEffect(()=>{const before=document.activeElement; const old=document.body.style.overflow;document.body.style.overflow='hidden';panel.current?.focus();function key(event){if(event.key==='Escape')closeRef.current();if(event.key==='Tab'){const controls=[...panel.current.querySelectorAll('button,input,textarea,select,a[href]')].filter(e=>!e.disabled);if(!controls.length){event.preventDefault();return;}const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel.current)){event.preventDefault();first.focus();}}}document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);before?.focus();};},[]);
  return <div className={`d-overlay ${kind}`} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="d-overlay-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><span className="d-sheet-handle" onTouchStart={e=>{touchStart.current=e.touches[0]?.clientY;}} onTouchEnd={e=>{if(touchStart.current!==null&&e.changedTouches[0]?.clientY-touchStart.current>60)onClose();touchStart.current=null;}}/><button className="d-close" onClick={onClose} aria-label="关闭">×</button><h2>{title}</h2>{children}{actions&&<div className="d-actions">{actions}</div>}</section></div>;
}


export const designMobileItems=[['01','home','发现'],['03','heart','关注'],['05','plus','我的回答'],['04','comment','消息'],['09','me','我的']];
export function DesignMobileNav({screen,navigate,unread=0}){return <nav className="d-mobile-nav" aria-label="移动导航">{designMobileItems.map(([id,icon,label])=><button key={id} className={`${screen===id?'active':''} ${id==='05'?'write':''}`} onClick={()=>navigate(id)} aria-current={screen===id?'page':undefined}><span><Icon name={screen==='04'&&id==='04'?'bell':icon}/>{screen==='04'&&id==='04'&&unread>0&&<i>{unread}</i>}</span><small>{screen==='04'&&id==='04'?'通知':label}</small></button>)}</nav>;}
