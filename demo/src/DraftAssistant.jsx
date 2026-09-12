import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import {poll,readAiTask} from './workflow.js';

export function DraftAssistant({draft,dirty,disabled,onDraft,onPending}) {
  const [task,setTask]=useState(null),[error,setError]=useState(''),[validation,setValidation]=useState(null),[busy,setBusy]=useState(false);
  const pending=busy||['queued','running'].includes(task?.status);
  useEffect(()=>{onPending(pending);return()=>onPending(false);},[pending,onPending]);
  useEffect(()=>{setValidation(null);},[draft.contentHash,dirty]);
  useEffect(()=>{
    if(!task?.id||!['queued','running'].includes(task.status))return;
    return poll(()=>readAiTask(api,task.id,task.kind),result=>{
      setTask(current=>({...current,status:result.status}));
      if(result.message)setError(result.message);
      if(result.validation)setValidation(result.validation);
      if(result.draft)onDraft(result.draft);
    },e=>{setError(e.message);setTask(current=>({...current,status:'read_error'}));});
  },[task?.id,task?.status,task?.kind]);
  async function start(kind) {
    setBusy(true);setError('');setValidation(null);
    try {
      const data=kind==='draft'
        ?await api(`/interviews/${draft.interviewId}/draft-ai`,'POST',{expected_version:draft.version})
        :await api(`/drafts/${draft.id}/validate`,'POST',{content_hash:draft.contentHash});
      if(data.validation){setValidation(data.validation);setTask({status:'rules_only'});}
      else setTask({id:data.job_id,kind,status:'queued'});
    } catch(e){setError(e.message);} finally {setBusy(false);}
  }
  const available=!disabled&&!dirty&&!pending&&['draft','confirmed'].includes(draft.status)&&!draft.privateContentExpired;
  return <section><h2>整理与检查草稿</h2><button disabled={disabled||dirty||pending||!draft.interviewId} onClick={async()=>{setBusy(true);try{onDraft(await api(`/drafts/${draft.id}/with-questions`,'POST',{}));}catch(e){setError(e.message);}finally{setBusy(false);}}}>补齐原采访问题，生成待确认新版本</button>
    <p>AI 根据已保存的采访回答整理新版本，需要重新确认后才能发布。草稿中后加的修改请自行保留；检查结果不能代替你确认事实。</p>
    {error&&<p role="alert">{error}</p>}{pending&&<p role="status">正在处理，原稿已保留…</p>}
    {dirty&&<p>请先保存修改，再进行整理或检查。</p>}
    <button disabled={!available||!draft.interviewId} onClick={()=>start('draft')}>用 AI 整理新的草稿版本</button>
    <button disabled={!available} onClick={()=>start('validation')}>检查当前草稿依据</button>
    {task?.status==='read_error'&&<button disabled={busy} onClick={()=>{setError('');setTask(current=>({...current,status:'queued'}));}}>重新读取任务状态</button>}
    {task?.status==='rules_only'&&<p>本次使用规则检查，未完成 AI 检查。</p>}
    {validation&&<><p>{validation.blocking?'发现需要处理的问题，暂不能发布。':'本次检查未发现阻断项，仍需作者确认。'}</p>
      {validation.findings.map((finding,index)=><article key={index}><strong>{finding.severity==='blocking'?'需处理':'提示'}</strong><p>{finding.message}</p>{finding.statement_id&&<small>对应内容编号：{finding.statement_id}</small>}</article>)}
    </>}
  </section>;
}
