import React, {useEffect, useState} from 'react';
import {api} from './api.js';
import {poll, readAiTask} from './workflow.js';
import {Button} from './design/shared.jsx';

export function DraftAssistant({draft, dirty, disabled, onDraft, onPending}) {
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = busy || ['queued', 'running'].includes(task?.status);
  useEffect(() => {
    onPending(pending);
    return () => onPending(false);
  }, [pending, onPending]);
  useEffect(() => {
    setValidation(null);
  }, [draft.contentHash, dirty]);
  useEffect(() => {
    if (!task?.id || !['queued', 'running'].includes(task.status)) return;
    return poll(() => readAiTask(api, task.id, task.kind), (result) => {
      setTask((current) => ({...current, status: result.status}));
      if (result.message) setError(result.message);
      if (result.validation) setValidation(result.validation);
      if (result.draft) onDraft(result.draft);
    }, (e) => {
      setError(e.message);
      setTask((current) => ({...current, status: 'read_error'}));
    });
  }, [task?.id, task?.status, task?.kind]);
  async function start(kind) {
    setBusy(true);
    setError('');
    setValidation(null);
    try {
      const data = kind === 'draft'
        ? await api(`/interviews/${draft.interviewId}/draft-ai`, 'POST', {expected_version: draft.version})
        : await api(`/drafts/${draft.id}/validate`, 'POST', {content_hash: draft.contentHash});
      if (data.validation) {
        setValidation(data.validation);
        setTask({status: 'rules_only'});
      } else setTask({id: data.job_id, kind, status: 'queued'});
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const available = !disabled && !dirty && !pending && ['draft', 'confirmed'].includes(draft.status) && !draft.privateContentExpired;
  return (
    <div className="d-ai-tools">
      <button className="d-link" type="button" disabled={disabled || dirty || pending || !draft.interviewId} onClick={async () => {
        setBusy(true);
        try { onDraft(await api(`/drafts/${draft.id}/with-questions`, 'POST', {})); }
        catch (e) { setError(e.message); }
        finally { setBusy(false); }
      }}>补齐采访问题</button>
      <button className="d-link" type="button" disabled={!available || !draft.interviewId} onClick={() => start('draft')}>AI 整理</button>
      <button className="d-link" type="button" disabled={!available} onClick={() => start('validation')}>检查依据</button>
      {pending && <p role="status">正在整理，原稿已保留。</p>}
      {dirty && <p className="d-muted">请先保存修改，再进行整理或检查。</p>}
      {error && <p role="alert">{error}</p>}
      {task?.status === 'read_error' && <Button kind="ghost" disabled={busy} onClick={() => { setError(''); setTask((current) => ({...current, status: 'queued'})); }}>重新读取任务状态</Button>}
      {task?.status === 'rules_only' && <p className="d-muted">本次使用规则检查，未完成 AI 检查。</p>}
      {validation && (
        <div>
          <p>{validation.blocking ? '发现需要处理的问题，暂不能发布。' : '本次检查未发现阻断项，仍需作者确认。'}</p>
          {validation.findings.map((finding, index) => (
            <article key={index}>
              <strong>{finding.severity === 'blocking' ? '需处理' : '提示'}</strong>
              <p>{finding.message}</p>
              {finding.statement_id ? <small>对应内容编号：{finding.statement_id}</small> : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
