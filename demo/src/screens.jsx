import React from 'react';
import {Article} from './Article.jsx';
import {DraftAssistant} from './DraftAssistant.jsx';
import {DraftEvidence} from './DraftEvidence.jsx';
import {Management} from './Management.jsx';
import {MemoryMaterials} from './MemoryMaterials.jsx';
import {OfficialData} from './OfficialData.jsx';
import {ReasonPicker} from './ReasonPicker.jsx';
import {SourceMaterials} from './SourceMaterials.jsx';
import {ZhihuAccount} from './ZhihuAccount.jsx';
import {EmptyState} from './overlays.jsx';
import {articleLength, formatParagraphs} from './article-format.js';
import {COPY, coverStyle, interviewProgress, isFixture, liveCount, sectionBlocks, storyTitle, workbenchDefaultTab, workbenchTabs} from './ui14.js';

function Cover({item}) {
  const date = (item.published_at || item.created_at || '').slice(0, 7).replace('-', '.');
  return (
    <div className="cover" style={coverStyle(item.title || item.source_id || item.url)} aria-hidden="true">
      {date || '后来'}
    </div>
  );
}

function AboutAside() {
  return (
    <aside className="card desktop-only">
      <h2 className="aside-title">关于「然后呢？」</h2>
      <p>我们从知乎的真实回答出发，通过 AI 回访原作者，让那些认真留下的经历，能够被时间补充完整。</p>
      <div className="principle"><span className="principle-icon">书</span><div><strong>基于真实内容</strong><p>来自知乎的公开回答</p></div></div>
      <div className="principle"><span className="principle-icon">问</span><div><strong>AI 辅助回访</strong><p>生成有深度的问题，不代写、不编造</p></div></div>
      <div className="principle"><span className="principle-icon">签</span><div><strong>原作者确认</strong><p>由作者亲自补充与发布</p></div></div>
      <p className="quote">“有些回答，不该只停留在过去。” —— 然后呢？</p>
    </aside>
  );
}

export function DiscoverPage({items, query, url, busy, emptyKind, onQuery, onUrl, onSearch, onImport, onOpen, onInterest, onFillImport, onEmpty, reasonSource, reasonCandidate}) {
  const [filter, setFilter] = React.useState('为你推荐');
  const chips = ['为你推荐', '职场发展', '人生选择', '学习成长', '情感关系', '创业思考', '全部'];
  const visible = filter === '为你推荐' || filter === '全部'
    ? items
    : items.filter((item) => `${item.title || ''}${item.text || ''}`.includes(filter.replace('发展', '').replace('选择', '').slice(0, 2)));
  return (
    <div className="page page-2" data-screen="01">
      <div className="page-stack">
        <section className="hero" data-region="hero">
          <h1>{COPY.heroTitle}</h1>
          <p>{COPY.heroBody}</p>
          <div className="hero-art" aria-hidden="true">
            <div className="float-card float-a">过去的回答是一个起点<small>起点</small></div>
            <div className="float-q">?</div>
            <div className="float-card float-b">而每一个后来都是新的可能<small>后来</small></div>
          </div>
          <form className="search-row" data-region="search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
            <input aria-label="搜索关键词" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索知乎里的旧回答，看看谁的故事还在继续…" />
            <button className="btn-primary" disabled={busy}>搜索</button>
          </form>
          <p><button className="subtle-link" type="button" onClick={onFillImport}>{COPY.pasteLink} →</button></p>
        </section>
        <nav className="chips" aria-label="分类">
          {chips.map((chip) => (
            <button key={chip} type="button" className={filter === chip ? 'chip active' : 'chip'} onClick={() => setFilter(chip)}>{chip}</button>
          ))}
        </nav>
        {emptyKind && !busy && <EmptyState kind={emptyKind} onAction={onEmpty} />}
        {visible.map((item, index) => (
          <article className="card story-card" key={item.source_id || item.url || index} data-region="feed">
            <Cover item={item} />
            <div>
              <h2>{storyTitle(item)}{isFixture(item) && <span className="fixture-tag">演示故事</span>}</h2>
              <p className="meta">{item.author_name ? `${item.author_name} · 官方摘要` : item.published_at || ''}</p>
              <p className="excerpt">{item.text}</p>
              {item.source_id
                ? <button className="btn-secondary" type="button" onClick={() => onOpen(item.source_id)}>查看故事</button>
                : (
                  <>
                    <p>资料范围：官方摘要，不代表完整原文。</p>
                    <details><summary>部分知乎评论</summary>{item.comments?.map((comment, n) => <p key={n}>{comment}</p>)}</details>
                    {item.url && <a href={item.url} target="_blank" rel="noreferrer">在知乎查看原内容</a>}
                    {item.candidate_id && (
                      <button className="btn-primary" disabled={busy} type="button" data-cta="then" onClick={() => onInterest(item)}>
                        {item.interested ? '取消后续关注' : COPY.then}
                      </button>
                    )}
                    {item.linked_source_id && <button className="btn-secondary" type="button" onClick={() => onOpen(item.linked_source_id)}>查看本站后续</button>}
                    <button className="btn-ghost" type="button" onClick={() => onUrl(item.url || '')}>填入导入链接</button>
                  </>
                )}
              {reasonSource && (reasonSource === item.linked_source_id || (item.candidate_id === reasonCandidate && item.interested)) && <ReasonPicker key={reasonSource} sourceId={reasonSource} />}
            </div>
            {item.source_id && <button className="btn-primary" type="button" data-cta="then" onClick={() => onOpen(item.source_id)}>{COPY.then}</button>}
          </article>
        ))}
        <form className="card" onSubmit={(event) => { event.preventDefault(); onImport(); }}>
          <label>粘贴知乎链接<input className="text-input" aria-label="知乎链接" value={url} onChange={(event) => onUrl(event.target.value)} placeholder="https://www.zhihu.com/question/…/answer/…" /></label>
          <button className="btn-primary" disabled={busy} data-cta="import">导入并核验</button>
        </form>
      </div>
      <AboutAside />
    </div>
  );
}

export function StoryPage({story, sourceId, storyComments, busy, reasonSource, onInterest, onUnfollow}) {
  if (!story) return <EmptyState kind="discover_empty" />;
  const followup = story.published_followup;
  const sections = sectionBlocks(followup?.statements || []);
  return (
    <div className="page page-2" data-screen="02">
      <article className="card">
        <p className="meta" data-region="story-meta">{story.material_level === 'exact_excerpt' ? '原文片段' : '材料摘要'} · {isFixture(story) ? '测试材料' : '来源材料'}</p>
        <h1 data-region="story-title">{story.title}</h1>
        <p className="body" data-region="story-body">{story.text}</p>
        <div className="interest-panel card" data-region="interest-panel">
          <div className="brand-mark">?</div>
          <h2>{COPY.then}</h2>
          <p>想知道这段经历后来发生了什么吗？</p>
          <button className="btn-primary" disabled={busy} type="button" data-cta="follow-later" onClick={onInterest}>{COPY.followLater}</button>
          <button className="btn-ghost" disabled={busy} type="button" onClick={onUnfollow}>取消关注</button>
        </div>
        {reasonSource === sourceId && <ReasonPicker key={sourceId} sourceId={sourceId} />}
        <details>
          <summary>已同步的知乎评论</summary>
          <p>{storyComments?.synced_at ? '最近同步：' + storyComments.synced_at : '尚未通过官方同步取得评论。'} 附带回复不保证覆盖全部楼中楼。</p>
          {storyComments?.items?.map((comment) => (
            <article key={comment.id}><p>{comment.text}</p>{comment.author_url && <a href={comment.author_url} target="_blank" rel="noreferrer">评论作者的知乎主页</a>}</article>
          ))}
        </details>
        {followup && sections.map((block) => (
          <section key={block.key} className="section-block" data-section={block.key} data-region={`section-${block.key}`}>
            <h2>{block.label}</h2>
            {block.items.length === 0 && <p className="meta">这一段作者尚未公开补充。</p>}
            {block.items.map((statement) => <Article key={statement.id} statement={statement} />)}
          </section>
        ))}
      </article>
      <aside className="card">
        <h2 className="aside-title">故事信息</h2>
        <p>当前状态：{followup ? '已有后来' : '尚无后来'}</p>
        {story.original_url && <a href={story.original_url} target="_blank" rel="noreferrer">查看原回答</a>}
      </aside>
    </div>
  );
}

export function FollowingPage({items, busy, emptyKind, onOpen, onDiscover, onEmpty}) {
  const [tab, setTab] = React.useState('全部');
  const withLater = items.filter((item) => item.published_followup || item.linked_source_id);
  const waiting = items.filter((item) => !item.published_followup && !item.linked_source_id);
  const shown = tab === '已有后来' ? withLater : tab === '等待后来' ? waiting : items;
  return (
    <div className="page page-2" data-screen="03">
      <div className="page-stack">
        <nav className="chips" data-region="following-tabs">
          {['全部', '等待后来', '已有后来'].map((label) => (
            <button key={label} type="button" className={tab === label ? 'chip active' : 'chip'} onClick={() => setTab(label)}>
              {label} {label === '全部' ? items.length : label === '等待后来' ? waiting.length : withLater.length}
            </button>
          ))}
        </nav>
        {emptyKind && !busy && <EmptyState kind={emptyKind} onAction={onEmpty || onDiscover} />}
        {shown.map((item, index) => (
          <article className="card story-card" key={item.source_id || item.url || index}>
            <Cover item={item} />
            <div>
              <span className={`status-pill ${item.published_followup || item.linked_source_id ? 'pill-done' : 'pill-wait'}`}>
                {item.published_followup || item.linked_source_id ? '已有后来' : '等待作者回应'}
              </span>
              <h2>{storyTitle(item)}</h2>
              <p className="excerpt">{item.text}</p>
              {(item.source_id || item.linked_source_id) && (
                <button className="btn-secondary" type="button" onClick={() => onOpen(item.source_id || item.linked_source_id)}>查看故事</button>
              )}
            </div>
          </article>
        ))}
      </div>
      <aside className="card">
        <h2 className="aside-title">我的关注</h2>
        <div className="stat-row">
          <div className="stat"><b>{liveCount(items.length) || '—'}</b><span>关注中的故事</span></div>
          <div className="stat"><b>{liveCount(withLater.length) || '—'}</b><span>已有后来</span></div>
          <div className="stat"><b>{liveCount(waiting.length) || '—'}</b><span>等待后来</span></div>
        </div>
        <p>有些问题没有标准答案，只有时间能给出更完整的回答。</p>
      </aside>
    </div>
  );
}

export function NotificationsPage({notifications, emptyKind, busy, onRead, onDiscover, onEmpty}) {
  const unread = notifications.filter((item) => !item.read_at && !item.readAt);
  return (
    <div className="page page-2" data-screen="04">
      <section className="card">
        <h1>通知</h1>
        <p>每 2 秒自动检查新更新；作者发布后到达，不需要手动刷新。</p>
        {emptyKind && !busy && <EmptyState kind={emptyKind} onAction={onEmpty || onDiscover} />}
        {notifications.map((item) => (
          <article className="list-item" key={item.id}>
            <span className="dot" />
            <div>
              <p>你关注的故事有了后来。</p>
              <button className="btn-primary" type="button" onClick={() => onRead(item)}>阅读更新</button>
            </div>
          </article>
        ))}
      </section>
      <aside className="card desktop-only">
        <h2 className="aside-title">通知概览</h2>
        <div className="stat-row">
          <div className="stat"><b>{liveCount(unread.length) || '0'}</b><span>未读通知</span></div>
          <div className="stat"><b>{liveCount(notifications.length) || '0'}</b><span>全部通知</span></div>
        </div>
        <p>只通知真正有价值的后续。我们只会在你关注的故事有新的真实后续时通知你。</p>
      </aside>
    </div>
  );
}

export function FollowupPage({followup, emptyKind, onStory, onDiscover}) {
  if (emptyKind) return <EmptyState kind={emptyKind} onAction={onDiscover} />;
  if (!followup) return <EmptyState kind="withdrawn" onAction={onDiscover} />;
  const sections = sectionBlocks(followup.statements);
  return (
    <div className="page page-2" data-screen="08">
      <article className="card">
        <h1>作者的后来</h1>
        <p>由作者确认并在本站发布。</p>
        <div className="timeline">
          <div><strong>当时</strong><p>原回答</p></div>
          <div>→</div>
          <div><strong>后来</strong><p>作者确认的回访</p></div>
        </div>
        {sections.map((block) => (
          <section key={block.key} className="section-block" data-section={block.key} data-region={`section-${block.key}`}>
            <h2>{block.label}</h2>
            {block.items.length === 0 && <p className="meta">这一段作者尚未公开补充。</p>}
            {block.items.map((statement) => <Article key={statement.id} statement={statement} />)}
          </section>
        ))}
        <button className="btn-secondary" type="button" onClick={() => onStory(followup.source_id)}>查看当时的回答</button>
      </article>
      <aside className="card">
        <h2 className="aside-title">这篇文章的来龙去脉</h2>
        <p>作者自述，AI 辅助采访与整理，未由平台独立核实。</p>
      </aside>
    </div>
  );
}

export function WorkbenchPage({items, busy, emptyKind, caseId, onCaseId, onOpen, onInterview, onDraft, onDiscover, onEmpty}) {
  const tabs = workbenchTabs(items);
  const [tab, setTab] = React.useState('waiting');
  const selected = tabs.some((entry) => entry.id === tab && entry.count) ? tab : workbenchDefaultTab(items);
  const active = tabs.find((entry) => entry.id === selected) || tabs[0];
  const shown = active.items;
  return (
    <div className="page page-2" data-screen="05">
      <div className="page-stack">
        <section className="hero" data-region="workbench-hero">
          <h1>那些你曾认真写下的回答，值得一个后来。</h1>
          <p>时光已经走过很远，现在，轮到你继续讲述。</p>
        </section>
        <nav className="chips" data-region="workbench-tabs" aria-label="回访进度">
          {tabs.map((entry) => (
            <button key={entry.id} type="button" className={selected === entry.id ? 'chip active' : 'chip'} onClick={() => setTab(entry.id)}>
              {entry.label} {entry.count}
            </button>
          ))}
        </nav>
        {emptyKind && !busy && <EmptyState kind={emptyKind} onAction={onEmpty || onDiscover} />}
        <div data-region="workbench-list">
          {shown.map((item) => {
            const count = liveCount(item.interest_count);
            return (
              <article className="card" key={item.id}>
                <h2>{item.title || '回访'}</h2>
                <p>{item.status}{count ? ` · ${count} 人点击了“然后呢？”（演示账号也计入此处，不能当作真实用户指标）` : ''}</p>
                <div>{item.reader_interests?.tags?.map((tag) => <p key={tag.tag}>{tag.tag}：{tag.count} 人（{tag.percentage}%）</p>)}</div>
                <button className="btn-primary" type="button" data-cta="willing" onClick={() => onOpen(item)}>{COPY.willing}</button>
                {item.interview_id && <button className="btn-secondary" type="button" onClick={() => onInterview(item.interview_id)}>继续采访</button>}
                {item.draft_id && <button className="btn-ghost" type="button" onClick={() => onDraft(item.draft_id)}>查看草稿</button>}
              </article>
            );
          })}
          {!shown.length && !emptyKind && <p className="meta">这一栏暂时没有回访。</p>}
        </div>
        <label>回访编号<input className="text-input" value={caseId} onChange={(event) => onCaseId(event.target.value)} /></label>
      </div>
      <aside className="card" data-region="workbench-aside">
        <h2 className="aside-title">为什么你来写后来？</h2>
        <div className="principle"><span className="principle-icon">人</span><div><strong>只有你最了解那段经历</strong><p>这段经历源于你真实的生活。</p></div></div>
        <div className="principle"><span className="principle-icon">心</span><div><strong>你的后续能帮助很多人</strong></div></div>
        <div className="principle"><span className="principle-icon">笔</span><div><strong>这是一次与过去的自己对话</strong></div></div>
        <p>等我回应 {tabs[0].count} · 正在写 {tabs[1].count} · 已发布 {tabs[2].count}</p>
      </aside>
    </div>
  );
}

export function InvitePage({sourceId, caseId, busy, onSourceId, onConsent, onAccept, onDecline, onStart}) {
  return (
    <div className="page page-2" data-screen="11">
      <section className="card" data-region="invite-card">
        <h1>接受一次时间回访</h1>
        <p>你可以拒绝，也可以在采访中跳过任何问题。</p>
        <label>原内容编号<input className="text-input" value={sourceId} onChange={(event) => onSourceId(event.target.value)} /></label>
        {[['private_interview', '同意私有采访'], ['external_model_processing', '同意将资料交给模型处理'], ['demo_public_display', '同意在本站展示']].map(([purpose, label]) => (
          <button key={purpose} className="btn-secondary" disabled={busy} type="button" onClick={() => onConsent(purpose)}>{label}</button>
        ))}
        <div className="interview-actions" data-region="invite-actions">
          <button className="btn-ghost" type="button" disabled={busy} onClick={onDecline}>暂不参与</button>
          <button className="btn-secondary" type="button" disabled={busy} onClick={onAccept}>接受回访</button>
          <button className="btn-primary" type="button" disabled={busy} data-cta="start-interview" onClick={onStart}>开始回访</button>
        </div>
        <p className="meta">回访编号：{caseId || '尚未选择'}</p>
      </section>
      <aside className="card" data-region="invite-privacy">
        <h2 className="aside-title">关于隐私</h2>
        <p>我们会严格保护你的隐私。你可以选择公开发布，或仅自己可见。所有内容在发布前都需要你的确认。</p>
      </aside>
    </div>
  );
}

export function InterviewPage({session, messages, answer, answerVisibility, busy, interviewState, onAnswer, onVisibility, onFormat, onSave, onSkip, onPause, onResume, onFinish, onRetry, onRefresh, onDraft}) {
  if (!session) return <EmptyState kind="timeout" />;
  const progress = interviewProgress(session);
  const current = messages.filter((item) => item.role === 'ai').at(-1);
  return (
    <div className="page page-2" data-screen="06">
      <section className="card">
        <p className="progress-label" data-region="interview-progress">{progress.label} 问</p>
        <div className="progress"><span style={{width: `${(progress.current / progress.total) * 100}%`}} /></div>
        <p>状态：{session.status} · 已问 {session.questionsAsked} / 5</p>
        <h1>{current?.question || '聊聊你的后来'}</h1>
        {messages.map((item) => (
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
      <aside className="card">
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
    <div className="page page-2" data-screen="07">
      <section className="card">
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
      <aside className="card">
        <h2 className="aside-title">发布后读者将看到什么？</h2>
        <p>我们会以时间线的形式呈现这段经历。事实由作者确认。</p>
      </aside>
    </div>
  );
}

export function AccountPage({user, login, busy, memory, onLogin, onIdentifyReader, onZhihu, onRefresh, onLogout, onConsent, onRefreshMemory, onRevoke, onWorkbench, onMaterials, onAdmin, onOfficial}) {
  return (
    <div className="page page-2" data-screen="09">
      <section className="card">
        <h1>我的</h1>
        <p>读者会话用于保存关注记录；知乎登录用于确认你的平台身份。登录不会自动同意资料处理或公开发布。</p>
        {!user && (
          <div className="account-actions">
            <button className="btn-primary" disabled={busy} type="button" onClick={onZhihu}>同意建立读者会话并使用知乎登录</button>
            <button className="btn-secondary" disabled={busy} type="button" onClick={onIdentifyReader}>暂不绑定知乎，仅进入读者会话</button>
          </div>
        )}
        <label>一次性登录凭证<input className="text-input" type="password" value={login} onChange={(event) => onLogin(event.target.value)} /></label>
        <button className="btn-secondary" disabled={busy} type="button" onClick={() => onIdentifyReader('token')}>登录</button>
        {user && (
          <>
            <div className="settings-row"><div><strong>{user.display_name || '当前用户'}</strong><p>站内角色由服务器判定，页面不会接受自报身份。</p></div></div>
            <button className="btn-ghost" disabled={busy} type="button" onClick={onRefresh}>刷新站内身份</button>
            <ZhihuAccount key={user.id} />
            {['author', 'admin', 'researcher'].includes(user.role) && <button className="btn-secondary" type="button" onClick={onMaterials}>提交资料</button>}
            {['author', 'admin', 'researcher'].includes(user.role) && <button className="btn-primary" type="button" onClick={onWorkbench}>去写下后来</button>}
            {['admin', 'researcher'].includes(user.role) && <button className="btn-ghost" type="button" onClick={onAdmin}>回访管理</button>}
            {user.role === 'admin' && <button className="btn-ghost" type="button" onClick={onOfficial}>官方数据</button>}
            <button className="btn-ghost" type="button" onClick={onLogout}>退出登录</button>
          </>
        )}
      </section>
      <section className="card">
        <h2>AI 资料与记忆</h2>
        <p>只使用你同意处理且已经核验归属的材料。不会把资料不足的部分补写成人物档案。</p>
        <p>状态：{memory?.status || '尚未建立'}　更新：{memory?.updated_at || '暂无'}</p>
        <div className="settings-row">
          <div><strong>用于生成「后来」的回访问答</strong><p>使用你公开的知乎回答来生成 AI 回访问题和内容。</p></div>
          <button type="button" className={`toggle${memory?.status && memory.status !== 'disabled' ? ' on' : ''}`} aria-pressed={!!(memory?.status && memory.status !== 'disabled')} onClick={memory?.status && memory.status !== 'disabled' ? onRevoke : onConsent} />
        </div>
        <button className="btn-secondary" disabled={busy} type="button" onClick={onRefreshMemory}>刷新资料</button>
        <MemoryMaterials materials={memory?.materials} />
        {memory?.records?.map((record) => (
          <article key={record.name}><p>{record.preference ? '采访边界：' : ''}{record.content}</p><small>来源：{record.source_id}</small></article>
        ))}
      </section>
    </div>
  );
}

export function AdminPage({role, pane = 'manage'}) {
  return (
    <div className="page" data-screen="10" data-region="admin-nav">
      <h1>管理后台</h1>
      <p>给项目团队使用的内部页面：样本管理、回访管理、研究数据与接口状态。</p>
      {pane === 'manage' && ['admin', 'researcher'].includes(role) && <Management role={role} />}
      {pane === 'official' && role === 'admin' && <OfficialData />}
    </div>
  );
}

export function ImportPage({url, busy, sourceId, notice, onUrl, onImport, role}) {
  return (
    <div className="page page-2" data-screen="12">
      <section className="card">
        <h1>从知乎链接导入一段过去的回答</h1>
        <p>粘贴知乎的问题或回答链接，导入内容并核验来源边界，然后继续创建回访。</p>
        <form className="search-row" data-region="import-form" onSubmit={(event) => { event.preventDefault(); onImport(); }}>
          <input className="text-input" aria-label="知乎链接" value={url} onChange={(event) => onUrl(event.target.value)} placeholder="https://www.zhihu.com/question/…/answer/…" />
          <button className="btn-primary" disabled={busy} data-cta="import">导入并核验</button>
        </form>
        {sourceId && <p>来源编号：{sourceId}</p>}
        {notice && <p role="status">{notice}</p>}
        <SourceMaterials role={role} />
      </section>
      <aside className="card">
        <h2 className="aside-title">来源核验状态</h2>
        <div className="verify-step"><span className="verify-dot done">1</span><div><strong>官方摘要已导入</strong><p>已从知乎官方 API 获取标题、摘要等基础信息。</p></div></div>
        <div className="verify-step"><span className="verify-dot">2</span><div><strong>原文片段待补充</strong><p>当前暂无完整正文。补充后可获得更深入、更贴近你原意的后续访谈。</p></div></div>
        <div className="verify-step"><span className="verify-dot">3</span><div><strong>作者身份待确认</strong><p>确认这是我的回答。</p></div></div>
      </aside>
    </div>
  );
}
