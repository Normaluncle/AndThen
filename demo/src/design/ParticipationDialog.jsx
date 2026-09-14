import React from 'react';
import {Modal,Button,Icon} from './shared.jsx';
import {participationRules} from './Invite.jsx';
export function ParticipationDialog({title,onClose,onStart,children,busy=false}){
 return <Modal kind="invite" title="确认参与回访" onClose={onClose} actions={<><Button kind="ghost" disabled={busy} onClick={onClose}>暂不参与</Button><Button disabled={busy} onClick={onStart}>开始回访</Button></>}><p>{title}</p><p>AI 会协助你回顾经历；内容需要你确认后才能发布。</p>{participationRules.map(([icon,label,text])=><div className="d-principle" key={label}><Icon name={icon}/><div><b>{label}</b><p>{text}</p></div></div>)}{children}</Modal>;
}
