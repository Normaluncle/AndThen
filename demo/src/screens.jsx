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
import {Button, Icon, Modal, Panel, Tag} from './design/shared.jsx';
import {interviewInsert, interviewRail} from './interview-rail.js';

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

export function InterviewPage({context, session, messages, answer, answerVisibility, busy, interviewState, onAnswer, onVisibility, onFormat, onSave, onSkip, onPause, onResume, onFinish, onRetry, onRefresh, onDraft, onBack}) {
  const [drawer, setDrawer] = React.useState(false);
  const [why, setWhy] = React.useState(false);
  const [pauseConfirm, setPauseConfirm] = React.useState(false);
  if (!session) return <EmptyState kind="timeout" />;
  const progress = interviewProgress(session);
  const current = messages.filter((item) => item.role === 'ai').at(-1);
  const rail = interviewRail(context, current);
  const paused = session.status === 'paused';
  const count = Array.from((answer || '').trim()).length;
  return (
    <div className="d-two d-interview" data-screen="06">
      <Panel className="d-interview-main">
        {onBack && <button className="d-link d-desktop" type="button" onClick={onBack}>← 返回</button>}
        <div className="d-interview-intro"><h2>✦ AI 回访</h2><p>基于你过去的回答，AI 为你生成了一组回访问题，帮你记录「当时」与「现在」的连接。</p></div>
        <div className="d-progress" data-region="interview-progress"><span><i style={{width: `${(Math.max(progress.current, 1) / progress.total) * 100}%`}} /></span><b><span className="d-progress-desktop">{progress.label}</span><span className="d-progress-mobile">{Math.max(progress.current, 1)} / {progress.total}</span></b></div>
        <h1 data-region="interview-question">{current?.question || '聊聊你的后来'}</h1>
        <p className="d-question-tip">你可以从工作、生活、情感、心态等任何角度来聊。真实的感受比「正确的答案」更重要。</p>
        {session.mode === 'manual' && session.stopReason && <p>AI 提问暂不可用，已保存的回答仍保留。可以继续手动补充，或重试 AI 提问。</p>}
        {interviewState.retry && <Button kind="secondary" disabled={busy} onClick={onRetry}>重试 AI 提问</Button>}
        {interviewState.waiting && <p role="status">回答已保存，正在准备下一问…</p>}
        <div className="d-editor" data-region="interview-composer">
          <div className="d-toolbar">
            <button type="button" className="d-tool-bold" aria-label="加粗" disabled={busy || paused} onClick={() => onAnswer(interviewInsert(answer, 'bold'))}>B</button>
            <button type="button" className="d-tool-italic" aria-label="斜体" disabled={busy || paused} onClick={() => onAnswer(interviewInsert(answer, 'italic'))}><i>I</i></button>
            <button type="button" aria-label="插入链接" disabled={busy || paused} onClick={() => onAnswer(interviewInsert(answer, 'link'))}><Icon name="link" /></button>
            <button type="button" aria-label="插入列表" disabled={busy || paused} onClick={() => onAnswer(interviewInsert(answer, 'list'))}><Icon name="list" /></button>
            <span>{count} / 2000</span>
          </div>
          <textarea aria-label="回访回答" maxLength={2000} disabled={busy || paused} value={answer} onChange={(event) => onAnswer(event.target.value)} placeholder={'在这里写下你的回答…\n你可以尽量具体一点，比如：哪些实现了，哪些没实现，原因是什么？\n过程中有什么意想不到的转折？现在的你，会如何看待当时的自己？'} />
          <small className="d-mobile-counter">{count} / 2000</small>
        </div>
        <div className="d-blue-box d-editor-tip">♧　<b>小提示：</b>不必追求完整，先写下此刻最真实的想法即可。你之后还可以随时回来修改。</div>
        <label className="d-muted">回答范围
          <select value={answerVisibility} onChange={(event) => onVisibility(event.target.value)}>
            <option value="public">可用于公开草稿（仍需确认发布）</option>
            <option value="private">仅私有采访使用</option>
          </select>
        </label>
        <div className="d-mobile-reference">
          <button type="button" onClick={() => setDrawer(true)}><Icon name="book" /><span><b>查看当时的回答</b><small>{rail.originalDate ? `来自 ${rail.originalDate} 的原回答` : '来自当时的回答'}</small></span>›</button>
          <button type="button" onClick={() => setWhy(true)}><Icon name="ai" /><span><b>为什么会问这个问题？</b><small>基于你过去的回答，我们想了解…</small></span>›</button>
        </div>
        <div className="d-interview-actions">
          <Button disabled={busy || paused || !answer || !interviewState.answer} data-cta="save-continue" onClick={onSave}>{COPY.saveContinue}　→</Button>
          <Button kind="soft" disabled={busy || paused || !interviewState.answer} onClick={onSkip}><Icon name="skip" /> {COPY.skipQuestion}</Button>
          {interviewState.resume
            ? <Button kind="soft" disabled={busy} onClick={onResume}><Icon name="play" /> 继续采访</Button>
            : <Button kind="soft" disabled={busy || !interviewState.pause} onClick={() => setPauseConfirm(true)}><Icon name="pause" /> 暂停采访</Button>}
        </div>
        {session.status === 'finished' && <Button disabled={busy} onClick={onDraft}>整理草稿</Button>}
        {interviewState.finish && <button className="d-link" disabled={busy} type="button" onClick={onFinish}>结束采访</button>}
        <button className="d-link" disabled={busy} type="button" onClick={onRefresh}>刷新下一问</button>
      </Panel>
      <aside className="d-sidebar" data-region="interview-aside">
        <Panel>
          <h2 className="d-between">当时{rail.originalUrl ? <a className="d-link" href={rail.originalUrl} target="_blank" rel="noreferrer">查看原文 ↗</a> : <button className="d-link" type="button" onClick={() => setDrawer(true)}>查看原文 ↗</button>}</h2>
          <p className="d-muted">（来自你{rail.originalYear || '当时'}年的回答）</p>
          <div className="d-info-box"><strong className="d-big-quote">“</strong><p>{rail.originalText}</p><small>{rail.originalDate || '日期未知'} · 来源：原回答</small></div>
        </Panel>
        <Panel>
          <h3 className="d-icon-heading"><Icon name="bulb" />为什么会问这个问题？</h3>
          <p className="d-prose">{rail.why}</p>
        </Panel>
        <Panel>
          <h3 className="d-icon-heading"><Icon name="users" />读者最想知道什么？</h3>
          <ul className="d-muted">{rail.reader.map((item) => <li key={item}>{item}</li>)}</ul>
        </Panel>
        <Panel>
          <h3 className="d-icon-heading"><Icon name="document" />本次采访会生成</h3>
          <p className="d-muted">完成全部 {progress.total} 个问题后，我们将为你生成一篇完整的回访内容，包含以下三个部分：</p>
          <div className="d-three-labels"><span>▣ {COPY.sections[0]}<small>你原来的回答</small></span><span>▣ {COPY.sections[1]}<small>你现在的分享</small></span><span>◉ {COPY.sections[2]}<small>AI 整理的观察</small></span></div>
        </Panel>
      </aside>
      {drawer && <Modal kind="drawer" title="查看当时的回答" onClose={() => setDrawer(false)}><h3>{rail.originalTitle || '当时的回答'}</h3><p className="d-prose">{rail.originalText}</p>{rail.originalUrl && <a className="d-link" href={rail.originalUrl} target="_blank" rel="noreferrer">查看原回答 ↗</a>}</Modal>}
      {why && <Modal kind="sheet" title="为什么会问这个问题？" onClose={() => setWhy(false)}><p>{rail.why}</p></Modal>}
      {pauseConfirm && <Modal title="暂停采访？" onClose={() => setPauseConfirm(false)} actions={<><Button kind="ghost" onClick={() => setPauseConfirm(false)}>继续回答</Button><Button onClick={() => { setPauseConfirm(false); onPause(); }}>暂停采访</Button></>}><p>当前回答会保留。你可以稍后继续完成这组回访问题。</p></Modal>}
    </div>
  );
}

export function DraftPage({draft, draftState, draftJobPending, busy, onDraft, onPending, onSave, onConfirm, onPublish, onWithdraw, onChange, onBack}) {
  const [editing, setEditing] = React.useState(null);
  if (!draft) return <EmptyState kind="withdrawn" />;
  const sections = sectionBlocks(draft.statements);
  const tooShort = articleLength(draft.statements) < 100;
  const patch = (index, next) => onChange({...draft, statements: draft.statements.map((item, n) => n === index ? {...item, ...next} : item)});
  return (
    <div className="d-two d-publish" data-screen="07">
      <div>
        {onBack && <button className="d-link d-desktop" type="button" onClick={onBack}>← 返回编辑</button>}
        <h1>确认并发布这则「后来」</h1>
        <p className="d-publish-intro">我们已根据访谈内容整理出完整的故事，请阅读并确认。你可以编辑修改，或补充更多细节。公开正文共 {articleLength(draft.statements)} 字。</p>
        {tooShort && <p role="status">目前仍是简短回答，还不足以讲清一段后来。请展开关键经历与前因后果，再确认发布；AI排版不会替你编造内容。</p>}
        {draftState.dirty && <p role="status">有未保存的修改。保存后才能确认并发布这段新内容。</p>}
        <div className="d-draft-sections" data-region="draft-sections">
          {sections.map((block) => (
            <Panel key={block.key} className={`d-draft-section ${block.key}`} data-section={block.key}>
              <div className="d-draft-heading">
                <span className={`d-section-icon ${block.key === 'later' ? 'green' : block.key === 'reflection' ? 'purple' : ''}`}><Icon name={block.key === 'then' ? 'clock' : block.key === 'later' ? 'chart' : 'bulb'} /></span>
                <h2>{block.label}</h2>
                <Tag>{block.key === 'then' ? '来自原回答' : block.key === 'later' ? '来自作者回访' : 'AI 整理，作者确认'}</Tag>
              </div>
              {block.items.length ? block.items.map((statement) => {
                const index = draft.statements.findIndex((item) => item.id === statement.id);
                const open = editing === statement.id;
                return (
                  <article key={statement.id}>
                    <button className="d-link" type="button" onClick={() => setEditing(open ? null : statement.id)}>{open ? '完成' : '编辑'}</button>
                    {statement.question && <p className="d-muted">采访问题：{statement.question}</p>}
                    {open ? (
                      <>
                        <textarea className="d-input" rows={8} disabled={draftJobPending} value={statement.text} onChange={(event) => patch(index, {text: event.target.value})} />
                        <div className="d-section-pills" role="group" aria-label="时间段落">
                          {[['then', '当时'], ['later', '后来'], ['reflection', '现在回看']].map(([id, label]) => (
                            <button type="button" key={id} className={statement.section === id ? 'active' : ''} disabled={draftJobPending} onClick={() => patch(index, {section: id})}>{label}</button>
                          ))}
                        </div>
                        <div className="d-section-pills" role="group" aria-label="内容范围">
                          <button type="button" className={statement.visibility === 'public' ? 'active' : ''} disabled={draftJobPending} onClick={() => patch(index, {visibility: 'public'})}>公开</button>
                          <button type="button" className={statement.visibility === 'private' ? 'active' : ''} disabled={draftJobPending} onClick={() => patch(index, {visibility: 'private'})}>仅自己可见</button>
                        </div>
                        {statement.question && <button className="d-link" type="button" disabled={busy || draftJobPending} onClick={() => onChange({...draft, statements: draft.statements.map((item, n) => { if (n !== index) return item; const {question, ...rest} = item; return rest; })})}>不公开这一问题</button>}
                      </>
                    ) : <div className="d-draft-text">{(statement.text || '（空）').split('\n\n').map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>}
                  </article>
                );
              }) : <p className="d-muted">这一段还没有内容。</p>}
            </Panel>
          ))}
        </div>
        <DraftAssistant key={draft.id} draft={draft} dirty={draftState.dirty} disabled={busy} onDraft={onDraft} onPending={onPending} />
        <DraftEvidence key={draft.id + ':evidence'} draft={draft} />
        <Panel className="d-publish-options" data-region="publish-options">
          <h3>发布选项</h3>
          <div>
            <Button kind="soft" disabled={busy || draftJobPending || !draftState.save} onClick={onSave}>保存修改</Button>
            <Button kind="secondary" disabled={busy || draftJobPending || !draftState.confirm || tooShort} onClick={onConfirm}>确认全部内容</Button>
            <Button disabled={busy || draftJobPending || !draftState.publish || tooShort} data-cta="confirm-publish" onClick={onPublish}>{COPY.confirmPublish}</Button>
            {draftState.withdraw && <Button kind="danger" disabled={busy || draftJobPending} onClick={onWithdraw}>撤回发布</Button>}
          </div>
        </Panel>
      </div>
      <aside className="d-sidebar">
        <Panel className="d-saved">状态：{draft.status} · 版本 {draft.version}</Panel>
        <Panel>
          <h3>发布后读者将看到什么？</h3>
          <p className="d-muted">我们会以时间线的形式呈现这段经历，让更多人从你的故事中获得启发。</p>
          <div className="d-preview-timeline">
            {sections.filter((block) => block.items.length).map((block) => (
              <div key={block.key} className={block.key === 'later' ? 'green' : block.key === 'reflection' ? 'purple' : ''}>
                <b>{block.label}</b>
                <p>{(block.items[0]?.text || '').slice(0, 28)} …</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <h3>事实由作者确认</h3>
          {[['author', '内容来自你的原回答和回访', '我们仅整理呈现，不会擅自修改事实'], ['shield', '发布前请确认内容的真实性', '你是这段经历的唯一作者'], ['heart', '用真实的经历，帮助更多人', '你的故事可能正在鼓励某个身处相似困境的人']].map(([icon, title, text]) => (
            <div className="d-principle" key={title}><Icon name={icon} /><div><b>{title}</b><p>{text}</p></div></div>
          ))}
        </Panel>
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
