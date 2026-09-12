import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import {poll} from './workflow.js';
const choices=[['outcome','现在的结果与变化'],['journey','过程中的转折与经历'],['reflection','回头看的感受与建议'],['other','其他，我想补充']];
export function ReasonPicker({sourceId}){
 const [choice,setChoice]=useState(''),[text,setText]=useState(''),[consent,setConsent]=useState(false),[summary,setSummary]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;api(`/sources/${sourceId}/interest-reasons`).then(d=>{if(live){setSummary(d);setChoice(d.mine?.choice||'');setText(d.mine?.text||'');}}).catch(e=>{if(live)setMessage(e.message);});return()=>{live=false};},[sourceId]);
 useEffect(()=>{if(!summary?.pending)return;return poll(()=>api(`/sources/${sourceId}/interest-reasons`),setSummary,e=>setMessage(e.message));},[sourceId,summary?.pending]);
 async function save(){setBusy(true);try{await api(`/sources/${sourceId}/interest-reason`,'PUT',{choice,...(choice==='other'?{text,allow_model_processing:consent}:{})});setSummary(await api(`/sources/${sourceId}/interest-reasons`));setMessage('已保存，只计算你当前选择的一票。');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
 return <section><h3>你想知道怎样的后来？</h3><p>可选一项，帮助采访抓住大家关心的方向；不填也能关注。</p>{choices.map(([value,label])=><label key={value}><input type="radio" checked={choice===value} onChange={()=>setChoice(value)}/>{label} </label>)}{choice==='other'&&<><input aria-label="补充想问的问题" value={text} onChange={e=>setText(Array.from(e.target.value).slice(0,20).join(''))} placeholder="20字以内，不填写个人隐私"/><small>{Array.from(text).length}/20</small><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>同意将这句疑问用于AI归类和采访选题</label></>}<button disabled={busy||!choice||(choice==='other'&&(!text||!consent))} onClick={save}>保存关注方向</button>{message&&<p role="status">{message}</p>}{summary&&<><p>已填写方向：{summary.total} 人{summary.pending?' · 部分补充正在归类':''}</p>{summary.tags?.map(t=><p key={t.tag}>{t.tag}：{t.count} 人 · {t.percentage}%</p>)}</>}</section>;
}
