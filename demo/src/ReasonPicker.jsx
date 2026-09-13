import React, {useEffect, useState} from 'react';
import {api} from './api.js';
import {poll} from './workflow.js';
import {INTEREST_CHOICES} from './ui14.js';

export function ReasonPicker({sourceId}) {
  const [choice, setChoice] = useState('');
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api(`/sources/${sourceId}/interest-reasons`).then((data) => {
      if (live) { setSummary(data); setChoice(data.mine?.choice || ''); setText(data.mine?.text || ''); }
    }).catch((error) => { if (live) setMessage(error.message); });
    return () => { live = false; };
  }, [sourceId]);
  useEffect(() => {
    if (!summary?.pending) return;
    return poll(() => api(`/sources/${sourceId}/interest-reasons`), setSummary, (error) => setMessage(error.message));
  }, [sourceId, summary?.pending]);
  async function save() {
    setBusy(true);
    try {
      await api(`/sources/${sourceId}/interest-reason`, 'PUT', {choice, ...(choice === 'other' ? {text, allow_model_processing: consent} : {})});
      setSummary(await api(`/sources/${sourceId}/interest-reasons`));
      setMessage('已保存，只计算你当前选择的一票。');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="reason-picker">
      <h3>你更想知道什么？</h3>
      <p>可选一项，帮助采访抓住大家关心的方向；不填也能关注。</p>
      <div className="reason-grid">
        {INTEREST_CHOICES.map(([value, label]) => (
          <button key={value} type="button" className={choice === value ? 'reason-card active' : 'reason-card'} onClick={() => setChoice(value)}>
            {label}
          </button>
        ))}
      </div>
      {choice === 'other' && (
        <>
          <input className="text-input" aria-label="补充想问的问题" value={text} onChange={(event) => setText(Array.from(event.target.value).slice(0, 20).join(''))} placeholder="20字以内，不填写个人隐私" />
          <small>{Array.from(text).length}/20</small>
          <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />同意将这句疑问用于AI归类和采访选题</label>
        </>
      )}
      <button className="btn-primary" type="button" disabled={busy || !choice || (choice === 'other' && (!text || !consent))} onClick={save}>保存关注方向</button>
      {message && <p role="status">{message}</p>}
      {summary && (
        <>
          <p>已填写方向：{summary.total} 人{summary.pending ? ' · 部分补充正在归类' : ''}</p>
          {summary.tags?.map((tag) => <p key={tag.tag}>{tag.tag}：{tag.count} 人 · {tag.percentage}%</p>)}
        </>
      )}
    </section>
  );
}
