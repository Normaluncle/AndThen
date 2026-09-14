import React from 'react';
import {DraftAssistant} from './DraftAssistant.jsx';
import {DraftEvidence} from './DraftEvidence.jsx';
import {EmptyState} from './overlays.jsx';
import {articleLength,formatParagraphs} from './article-format.js';
import {COPY,interviewProgress,sectionBlocks} from './ui14.js';
export function InterviewPage({session, messages, answer, answerVisibility, busy, interviewState, onAnswer, onVisibility, onFormat, onSave, onSkip, onPause, onResume, onFinish, onRetry, onRefresh, onDraft}) {
  if (!session) return <EmptyState kind="timeout" />;
  const progress = interviewProgress(session);
  const current = messages.filter((item) => item.role === 'ai').at(-1);
  return (
    <div className="d-two d-workflow" data-screen="06">
      <section className="d-panel">
        <p className="progress-label" data-region="interview-progress">{progress.label} 问</p>
        <div className="progress"><span style={{width: `${(progress.current / progress.total) * 100}%`}} /></div>
        <p>状态：{session.status} · 已问 {session.questionsAsked} / 5</p>
        <h1>{current?.question || '聊聊你的后来'}</h1>
        {messages.filter(item=>item.id!==current?.id).map((item) => (
          <article key={item.id}>
            <strong>{item.role === 'ai' ? '回访问题' : '你的回答'}</strong>
            <p className="body">{item.question || item.authorMessage || (item.skipped ? '已跳过' : '')}</p>
          </article>
        ))}
        <button className="btn-ghost" disabled={busy} type="button" onClick={onRefresh}>刷新下一问</button>
        {session.mode === 'manual' && session.stopReason && <p>AI 提问暂不可用，已保存的回答仍保留。可以继续手动补充，或重试 AI 提问。</p>}
        {interviewState.retry && <button className="btn-secondary" disabled={busy} type="button" onClick={onRetry}>重试 AI 提问</button>}
        {interviewState.waiting && <p role="status">回答已保存，正在准备下一问…</p>}
        <label>回答范围
          <select value={answerVisibility} onChange={(event) => onVisibility(event.target.value)}>
            <option value="public">可用于公开草稿（仍需确认发布）</option>
            <option value="private">仅私有采访使用</option>
          </select>
        </label>
        <p>这次最多五问。每一问都可以写成一小篇，按你自己的节奏讲清经历。</p>
        <div className="composer" data-region="interview-composer">
          <div className="composer-tools">
            <div>
              <button className="btn-ghost" disabled={busy || !answer} type="button" onClick={() => onAnswer(formatParagraphs(answer))}>自动分段</button>
              <button className="btn-ghost" type="button" onClick={() => onAnswer(answer + '\n\n## 小标题\n')}>插入小标题</button>
              <button className="btn-ghost" type="button" onClick={() => onAnswer(answer + '\n- ')}>插入列表</button>
            </div>
            <span>{Array.from(answer.trim()).length} / 2000</span>
          </div>
          <textarea rows={10} value={answer} onChange={(event) => onAnswer(event.target.value)} placeholder="在这里写下你的回答…" />
        </div>
        <div className="interview-actions">
          <button className="btn-primary" disabled={busy || !answer || !interviewState.answer} type="button" data-cta="save-continue" onClick={onSave}>{COPY.saveContinue}</button>
          <button className="btn-ghost" disabled={busy || !interviewState.answer} type="button" onClick={onSkip}>{COPY.skipQuestion}</button>
          <button className="btn-ghost" disabled={busy || !interviewState.pause} type="button" onClick={onPause}>暂停采访</button>
          <button className="btn-ghost" disabled={busy || !interviewState.resume} type="button" onClick={onResume}>继续</button>
          <button className="btn-ghost" disabled={busy || !interviewState.finish} type="button" onClick={onFinish}>结束采访</button>
        </div>
        {session.status === 'finished' && <button className="btn-primary" disabled={busy} type="button" onClick={onDraft}>整理草稿</button>}
      </section>
      <aside className="d-panel">
        <h2 className="aside-title">本次采访会生成</h2>
        <p>{COPY.sections.join(' / ')}</p>
      </aside>
    </div>
  );
}

export function DraftPage({draft, draftState, draftJobPending, busy, onDraft, onPending, onSave, onConfirm, onPublish, onWithdraw, onChange}) {
  if (!draft) return <EmptyState kind="withdrawn" />;
  const sections = sectionBlocks(draft.statements);
  const tooShort = articleLength(draft.statements) < 100;
  return (
    <div className="d-two d-workflow" data-screen="07">
      <section className="d-panel">
        <h1>确认并发布这则「后来」</h1>
        <p>公开正文共 {articleLength(draft.statements)} 字；问题不计入字数。</p>
        {tooShort && <p role="status">目前仍是简短回答，还不足以讲清一段后来。请展开关键经历与前因后果，再确认发布；AI排版不会替你编造内容。</p>}
        <button className="btn-ghost" disabled={busy || draftJobPending} type="button" onClick={() => onChange({...draft, statements: draft.statements.map((statement) => ({...statement, text: formatParagraphs(statement.text)}))})}>自动整理段落</button>
        <DraftAssistant key={draft.id} draft={draft} dirty={draftState.dirty} disabled={busy} onDraft={onDraft} onPending={onPending} />
        <DraftEvidence key={draft.id + ':evidence'} draft={draft} />
        <p>状态：{draft.status} · 版本 {draft.version}</p>
        {draftState.dirty && <p role="status">有未保存的修改。保存后才能确认并发布这段新内容。</p>}
        <div data-region="draft-sections">
        {sections.map((block) => (
          <section key={block.key} className="section-block" data-section={block.key}>
            <h2>{block.label}</h2>
            {block.items.map((statement) => {
              const index = draft.statements.findIndex((item) => item.id === statement.id);
              return (
                <article key={statement.id}>
                  <label>采访问题（随此段一起公开，请核对是否涉及私密内容）
                    <input className="text-input" value={statement.question || ''} readOnly />
                  </label>
                  {statement.question && (
                    <button className="btn-ghost" disabled={busy || draftJobPending} type="button" onClick={() => onChange({...draft, statements: draft.statements.map((item, n) => { if (n !== index) return item; const {question, ...rest} = item; return rest; })})}>不公开这一问题</button>
                  )}
                  <label>内容
                    <textarea rows={8} disabled={draftJobPending} value={statement.text} onChange={(event) => onChange({...draft, statements: draft.statements.map((item, n) => n === index ? {...item, text: event.target.value} : item)})} />
                  </label>
                  <label>内容范围
                    <select disabled={draftJobPending} value={statement.visibility} onChange={(event) => onChange({...draft, statements: draft.statements.map((item, n) => n === index ? {...item, visibility: event.target.value} : item)})}>
                      <option value="public">可用于公开草稿</option>
                      <option value="private">仅自己可见</option>
                    </select>
                  </label>
                  <label>时间段落
                    <select disabled={draftJobPending} value={statement.section || ''} onChange={(event) => onChange({...draft, statements: draft.statements.map((item, n) => n === index ? {...item, section: event.target.value || undefined} : item)})}>
                      <option value="">未分节</option>
                      <option value="then">当时</option>
                      <option value="later">后来</option>
                      <option value="reflection">现在回看</option>
                    </select>
                  </label>
                  <button className="btn-ghost" disabled={busy || draftJobPending || draft.statements.length <= 1} type="button" onClick={() => onChange({...draft, statements: draft.statements.filter((_, n) => n !== index)})}>从草稿移除此项</button>
                  <small>依据：{statement.evidence_refs?.join('、')}</small>
                </article>
              );
            })}
          </section>
        ))}
        </div>
        <div className="interview-actions" data-region="publish-options">
          <button className="btn-ghost" disabled={busy || draftJobPending || !draftState.save} type="button" onClick={onSave}>保存修改</button>
          <button className="btn-secondary" disabled={busy || draftJobPending || !draftState.confirm || tooShort} type="button" onClick={onConfirm}>确认全部内容</button>
          <button className="btn-primary" disabled={busy || draftJobPending || !draftState.publish || tooShort} type="button" data-cta="confirm-publish" onClick={onPublish}>{COPY.confirmPublish}</button>
          <button className="btn-danger" disabled={busy || draftJobPending || !draftState.withdraw} type="button" onClick={onWithdraw}>撤回发布</button>
        </div>
      </section>
      <aside className="d-panel">
        <h2 className="aside-title">发布后读者将看到什么？</h2>
        <p>我们会以时间线的形式呈现这段经历。事实由作者确认。</p>
      </aside>
    </div>
  );
}

