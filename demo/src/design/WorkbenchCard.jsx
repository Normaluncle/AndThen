import {StoryCover} from '../StoryCover.jsx';
import React from 'react';
import {Art,AvatarGroup,Button,Panel,Icon} from './shared.jsx';

// The design preview and connected account use the same complete card structure.
export function WorkbenchCard({card,onAction,third=false}) {
 return <Panel className="d-work-card">
  <div className="d-work-story">
   <StoryCover item={card}/>
   <div><h2>{card.title}</h2><p className="d-muted">{card.meta}</p>{card.excerpt&&<p className="d-work-excerpt">{card.excerpt}</p>}</div>
  </div>
  <div className="d-work-people">{card.fixture&&<AvatarGroup/>}<span>{card.interestCount===null?'暂无关注人数':`${card.interestCount} 人关注这个故事的后续`}</span><Button className={third?'d-work-third-action':''} onClick={onAction}>{card.action.label}</Button></div>
  <div className="d-work-polls"><span>大家最想知道：</span>{card.reasons.length?<div>{card.reasons.map((reason,i)=><div key={`${reason.label}-${i}`}><b>{reason.label}</b><span>{reason.percentage===null?'—':`${reason.percentage}%`}</span>{reason.percentage!==null&&<i style={{width:`${Math.min(100,Math.max(0,reason.percentage))}%`}}/>}</div>)}</div>:<p className="d-muted">读者尚未补充想了解的方向。</p>}</div>
 </Panel>;
}
