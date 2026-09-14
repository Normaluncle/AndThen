import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api, setToken, hasSession} from './api.js';
import './style.css';
import {AppHeader, DemoBar, MobileTabBar, MobileTopBar} from './chrome.jsx';
import {EmptyState, Overlay, Toast} from './overlays.jsx';
import {
  AccountPage, AdminPage, DraftPage, FollowupPage, FollowingPage,
  ImportPage, InterviewPage, InvitePage, NotificationsPage, StoryPage, WorkbenchPage,
} from './screens.jsx';
import {draftActions, interviewActions, poll} from './workflow.js';
import {COPY, emptyKindFor, mapScreen} from './ui14.js';
import {Home, HomeHeader} from './Home.jsx';
import DesignApp from './design/DesignApp.jsx';
import {frontendEntry} from './frontend-entry.js';

function useViewport() {
  const [viewport, setViewport] = useState(typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop');
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setViewport(media.matches ? 'mobile' : 'desktop');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return viewport;
}

function App() {
  const [entry]=useState(()=>frontendEntry(location.search));
  const viewport = useViewport();
  const [reasonSource, setReasonSource] = useState(null);
  const [reasonCandidate, setReasonCandidate] = useState(null);
  const [demoEnabled, setDemoEnabled] = useState(null);
  const [notifications, setNotifications] = useState([]);
  useEffect(() => { api('/auth/demo/status').then((data) => setDemoEnabled(data.enabled)).catch(() => setDemoEnabled(false)); }, []);
  const [answerVisibility, setAnswerVisibility] = useState('public');
  const [draftJobPending, setDraftJobPending] = useState(false);
  const [page, setPage] = useState(location.hash === '#account' ? '账号' : sessionStorage.getItem('andthen.page') || '发现');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [login, setLogin] = useState('');
  const [story, setStory] = useState(null);
  const [memory, setMemory] = useState(null);
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [answer, setAnswer] = useState('');
  const [draft, setDraft] = useState(null);
  const [caseId, setCaseId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [notice, setNotice] = useState('');
  const [savedStatements, setSavedStatements] = useState('');
  const [followup, setFollowup] = useState(null);
  const [storyComments, setStoryComments] = useState(null);
  const [overlay, setOverlay] = useState(null);
  useEffect(() => {
    if (!user) return;
    const refresh = () => api('/me/notifications');
    refresh().then(setNotificationsFromResponse).catch(() => {});
    return poll(refresh, setNotificationsFromResponse, () => {}, 2000);
    function setNotificationsFromResponse(data) { setNotifications(data.items || []); }
  }, [user?.id]);
  const draftState = draftActions(draft, savedStatements);
  const interviewState = interviewActions(session, messages);
  function loadDraft(value) { setDraft(value); setSavedStatements(JSON.stringify(value.statements)); }
  useEffect(() => {
    if (busy) return;
    if (page === '作者工作台' && user) return poll(() => api('/me/workbench'), (data) => setItems(data.items), (err) => setError(err.message));
    if (page === '采访' && session?.status === 'active') return poll(() => api('/interviews/' + session.id), (data) => { setSession(data.session); setMessages(data.messages || []); }, (err) => setError(err.message));
    if (page === '资料与记忆' && memory?.status === 'pending') return poll(() => api('/me/memory'), setMemory, (err) => setError(err.message));
  }, [page, session?.id, session?.status, memory?.status, busy, user?.id]);
  async function run(fn, message) {
    setError(''); setNotice(''); setBusy(true);
    try { await fn(); if (message) setNotice(message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function enter(next) {
    history.replaceState(null, '', location.pathname + location.search + (next === '账号' ? '#account' : ''));
    sessionStorage.setItem('andthen.page', next);
    setPage(next); setItems([]); setNotice('');
    await run(async () => {
      if (next === '发现') {
        const stories = await api('/stories');
        const candidates = hasSession() ? await api('/discovery/feed').catch(() => ({items: []})) : {items: []};
        setItems([...stories.items, ...candidates.items]);
      }
      if (next === '我的关注') {
        const stories = await api('/me/following').catch(() => ({items: []}));
        const candidates = await api('/discovery/following').catch(() => ({items: []}));
        setItems([...stories.items.filter((item) => !candidates.items.some((candidate) => candidate.linked_source_id === item.source_id)), ...candidates.items]);
      }
      if (next === '通知') setItems((await api('/me/notifications')).items);
      if (next === '资料与记忆' || next === '账号') {
        if (hasSession()) setMemory(await api('/me/memory').catch(() => null));
      }
      if (next === '作者工作台') setItems((await api('/me/workbench')).items);
    });
  }
  useEffect(() => {
    (async () => {
      let restored = false;
      try { const data = await api('/me'); setToken(true); setUser(data.user); restored = true; }
      catch (err) { setToken(false); if (err.status !== 401) setError('暂时无法恢复登录，请刷新重试。'); }
      const result = new URLSearchParams(location.search).get('oauth');
      if(entry==='current'){
        if(result){history.replaceState(null,'','/?screen=09&tab=settings');window.dispatchEvent(new PopStateEvent('popstate'));}
        return;
      }
      const target = result || location.hash === '#account' ? '账号' : sessionStorage.getItem('andthen.page') || '发现';
      if (new URLSearchParams(location.search).get('mode') !== 'live' && !result) return;
      await enter(restored || ['发现', '账号'].includes(target) ? target : '账号');
      if (result) {
        setNotice(result === 'success' && restored ? '知乎登录成功，刷新页面后仍会保持登录。' : '知乎授权未完成或已过期，请重试。');
        history.replaceState(null, '', '/#account');
      }
    })();
  }, []);
  async function identify(data) {
    setReasonSource(null); setSession(null); setMessages([]); setStory(null); setDraft(null); setMemory(null); setNotifications([]);
    setToken(data.session_token || true); setUser(data.user); setLogin(''); await enter('账号');
  }
  async function readInterview(id) {
    const data = await api('/interviews/' + id);
    setSession(data.session); setMessages(data.messages || []); setPage('采访');
  }
  async function actionInterview(action) {
    try { await api(`/interviews/${session.id}/${action}`, 'POST', {expected_version: session.revision}); }
    catch (err) {
      if (err.status === 409) { await readInterview(session.id); throw new Error('采访已有更新，请查看最新问题后再次操作。'); }
      throw err;
    }
    await readInterview(session.id);
  }
  async function openStory(id) {
    const data = await api('/stories/' + id);
    setStory(data.story); setSourceId(id); setStoryComments(null); setPage('内容');
    setStoryComments(await api(`/stories/${id}/comments`));
  }
  const view = useMemo(() => mapScreen({
    page, viewport, user, items, story, session, messages, draft, savedStatements, followup, memory,
    notifications, error: error ? {message: error} : null, busy, overlayIntent: overlay?.intent, answer,
  }), [page, viewport, user, items, story, session, messages, draft, savedStatements, followup, memory, notifications, error, busy, overlay, answer]);
  const emptyKind = emptyKindFor({page, items, notifications, story, session, followup, draft, error: error ? {message: error} : null, busy});

  if (entry==='current') return <DesignApp user={user} onUser={setUser} connectionError={error} />;
  return (
    <div className={`shell${page === '发现' ? ' home-shell' : ''}`}>
      {page === '发现' ? <HomeHeader onEnter={enter} query={query} onQuery={setQuery} onSearch={() => document.querySelector('.home-search')?.requestSubmit()} /> : <AppHeader
        page={page} user={user} notifications={notifications} query={query} busy={busy}
        onQuery={setQuery}
        onSearch={() => run(async () => { setItems((await api('/discovery/search?q=' + encodeURIComponent(query))).items); setPage('发现'); })}
        onEnter={enter}
        onBell={() => enter('通知')}
        onAvatar={() => enter('账号')}
      />}
      {page !== '发现' && <MobileTopBar page={page} user={user} notifications={notifications} onEnter={enter} onBell={() => enter('通知')} />}
      <DemoBar
        enabled={demoEnabled && page !== '发现'} busy={busy}
        onReader={() => run(() => api('/auth/demo/reader', 'POST', {}).then(identify))}
        onAuthor={() => run(() => api('/auth/demo/author', 'POST', {}).then(identify))}
      />
      {busy && <div className="loading-bar" role="progressbar" aria-label="处理中" />}
      <main className="shell-body" aria-busy={busy}>
        {error && <p role="alert" className="error">{error}</p>}
        {notice && <p role="status" className="desktop-only">{notice}</p>}
        {page === '发现' && (
          <Home preview={demoEnabled}
            items={items} query={query} url={url} busy={busy} emptyKind={emptyKind} reasonSource={reasonSource} reasonCandidate={reasonCandidate}
            onQuery={setQuery} onUrl={setUrl}
            onSearch={() => run(async () => setItems((await api('/discovery/search?q=' + encodeURIComponent(query))).items))}
            onImport={() => run(async () => { const data = await api('/sources/resolve', 'POST', {url}); setSourceId(data.source_id); setPage('导入'); setNotice(data.status === 'pending_content' ? '已登记链接，官方渠道暂未取得该帖正文。' : '已取得官方摘要，等待作者核验与展示许可。'); })}
            onOpen={(id) => run(() => openStory(id))}
            onInterest={(item) => run(async () => {
              const result = await api(`/discovery/candidates/${item.candidate_id}/interest`, 'PUT', {active: !item.interested});
              setReasonSource(item.interested ? null : result.source_id);
              setReasonCandidate(item.candidate_id);
              setItems((current) => current.map((entry) => entry.candidate_id === item.candidate_id ? {...entry, interested: !entry.interested} : entry));
            }, item.interested ? '已取消关注。' : '已关注这篇内容的后续，后台将整理已有回访材料。')}
            onFillImport={() => { setPage('导入'); }}
            onEmpty={(spec) => enter(spec.ctaPage || '发现')}
          />
        )}
        {page === '内容' && (
          <StoryPage
            story={story} sourceId={sourceId} storyComments={storyComments} busy={busy} reasonSource={reasonSource}
            onInterest={() => run(async () => { await api(`/stories/${sourceId}/interest`, 'PUT', {active: true}); setReasonSource(sourceId); }, '已关注，可以补充想了解的方向。')}
            onUnfollow={() => run(() => api(`/stories/${sourceId}/interest`, 'PUT', {active: false}), '已取消关注。')}
          />
        )}
        {page === '我的关注' && <FollowingPage items={items} busy={busy} emptyKind={emptyKind} onOpen={(id) => run(() => openStory(id))} onDiscover={() => enter('发现')} onEmpty={(spec) => enter(spec.ctaPage || '发现')} />}
        {page === '通知' && (
          <NotificationsPage
            notifications={notifications} emptyKind={emptyKind} busy={busy} onDiscover={() => enter('发现')}
            onRead={(item) => run(async () => { await api(`/notifications/${item.id}/read`, 'POST'); const data = await api('/followups/' + item.followupVersionId); setFollowup(data); setPage('更新'); })}
            onEmpty={(spec) => enter(spec.ctaPage || '发现')}
          />
        )}
        {page === '更新' && <FollowupPage followup={followup} emptyKind={emptyKind} onStory={(id) => run(() => openStory(id))} onDiscover={() => enter('发现')} />}
        {page === '作者工作台' && (
          <WorkbenchPage
            items={items} busy={busy} emptyKind={emptyKind} caseId={caseId} onCaseId={setCaseId}
            onOpen={(item) => { setCaseId(item.id); setSourceId(item.source_id); setPage('回访'); }}
            onInterview={(id) => run(() => readInterview(id))}
            onDraft={(id) => run(async () => { loadDraft(await api('/drafts/' + id)); setPage('草稿'); })}
            onDiscover={() => enter('发现')}
            onEmpty={(spec) => enter(spec.ctaPage || '发现')}
          />
        )}
        {page === '回访' && (
          <InvitePage
            sourceId={sourceId} caseId={caseId} busy={busy} onSourceId={setSourceId}
            onConsent={(purpose) => run(() => api(`/sources/${sourceId}/consents`, 'POST', {purpose, version: 'v1'}), '已保存这项同意。')}
            onAccept={() => run(() => api(`/cases/${caseId}/decision`, 'POST', {decision: 'accept'}), '已接受回访，可以开始采访。')}
            onDecline={() => run(() => api(`/cases/${caseId}/decision`, 'POST', {decision: 'decline'}), '已拒绝本次回访。')}
            onStart={() => run(async () => { const data = await api(`/cases/${caseId}/interviews`, 'POST', {mode: 'ai', confirms_own_content: true, confirms_old_state: true}); await readInterview(data.session.id); })}
          />
        )}
        {page === '采访' && (
          <InterviewPage
            session={session} messages={messages} answer={answer} answerVisibility={answerVisibility} busy={busy} interviewState={interviewState}
            onAnswer={setAnswer} onVisibility={setAnswerVisibility}
            onSave={() => run(async () => { await api(`/interviews/${session.id}/messages`, 'POST', {message: answer, visibility: answerVisibility, client_message_id: crypto.randomUUID(), expected_version: session.revision}); setAnswer(''); await readInterview(session.id); })}
            onSkip={() => run(async () => { await api(`/interviews/${session.id}/messages`, 'POST', {skip: true, client_message_id: crypto.randomUUID(), expected_version: session.revision}); await readInterview(session.id); })}
            onPause={() => run(() => actionInterview('pause'))}
            onResume={() => run(() => actionInterview('resume'))}
            onFinish={() => run(() => actionInterview('finish'))}
            onRetry={() => run(async () => { await api(`/interviews/${session.id}/retry`, 'POST', {expected_version: session.revision}); await readInterview(session.id); })}
            onRefresh={() => run(() => readInterview(session.id))}
            onDraft={() => run(async () => { const data = await api(`/interviews/${session.id}/draft`, 'POST'); loadDraft(data); setPage('草稿'); })}
          />
        )}
        {page === '草稿' && (
          <DraftPage
            draft={draft} draftState={draftState} draftJobPending={draftJobPending} busy={busy}
            onDraft={loadDraft} onPending={setDraftJobPending} onChange={setDraft}
            onSave={() => run(async () => loadDraft(await api(`/drafts/${draft.id}`, 'PATCH', {expected_version: draft.version, statements: draft.statements})), '修改已保存，请重新确认。')}
            onConfirm={() => run(async () => { await api(`/drafts/${draft.id}/confirm`, 'POST', {content_hash: draft.contentHash, statement_ids: draft.statements.map((item) => item.id)}); loadDraft(await api('/drafts/' + draft.id)); }, '已确认当前版本，可以发布。')}
            onPublish={() => setOverlay({intent: 'confirm', title: COPY.confirmPublishQuestion, body: '发布后，所有人都可以看到这段来自未来的更新。你也可以在之后随时编辑或补充。', confirm: async () => { setOverlay(null); await run(async () => { await api(`/drafts/${draft.id}/publish`, 'POST', {content_hash: draft.contentHash, confirms_publication: true}); loadDraft(await api('/drafts/' + draft.id)); }, '已发布到本站。关注者将收到站内更新通知。'); }})}
            onWithdraw={() => setOverlay({intent: 'destructive', title: '确定要撤回这则后来？', body: '撤回后读者不能继续读取该版本。', confirmLabel: '撤回', confirm: async () => { setOverlay(null); await run(async () => { await api(`/followups/${draft.id}/withdraw`, 'POST', {reason: '作者在页面主动撤回'}); loadDraft(await api('/drafts/' + draft.id)); }, '已撤回，读者不能继续读取该版本。'); }})}
          />
        )}
        {page === '账号' && (
          <AccountPage
            user={user} login={login} busy={busy} memory={memory}
            onLogin={setLogin}
            onIdentifyReader={(mode) => run(async () => {
              if (mode === 'token') await identify(await api('/auth/sessions', 'POST', {login_token: login}));
              else await identify(await api('/auth/readers', 'POST', {consent: {accepted: true, version: 'v1'}}));
            })}
            onZhihu={() => run(async () => { await identify(await api('/auth/readers', 'POST', {consent: {accepted: true, version: 'v1'}})); const data = await api('/auth/zhihu/start', 'POST', {}); location.assign(data.authorization_url); })}
            onRefresh={() => run(async () => setUser((await api('/me')).user))}
            onLogout={() => run(async () => { await api('/auth/logout', 'POST'); setToken(''); setUser(null); })}
            onConsent={() => run(async () => { await api('/me/memory/consent', 'PUT', {enabled: true}); setMemory(await api('/me/memory')); })}
            onRefreshMemory={() => run(async () => { await api('/me/memory/refresh', 'POST'); setMemory(await api('/me/memory')); })}
            onRevoke={() => run(async () => { await api('/me/memory/consent', 'PUT', {enabled: false}); setMemory(await api('/me/memory')); })}
            onWorkbench={() => enter('作者工作台')}
            onMaterials={() => enter('提交资料')}
            onAdmin={() => enter('回访管理')}
            onOfficial={() => enter('官方数据')}
          />
        )}
        {page === '资料与记忆' && (
          <AccountPage
            user={user} login={login} busy={busy} memory={memory}
            onLogin={setLogin} onIdentifyReader={() => {}} onZhihu={() => {}} onRefresh={() => {}} onLogout={() => {}}
            onConsent={() => run(async () => { await api('/me/memory/consent', 'PUT', {enabled: true}); setMemory(await api('/me/memory')); })}
            onRefreshMemory={() => run(async () => { await api('/me/memory/refresh', 'POST'); setMemory(await api('/me/memory')); })}
            onRevoke={() => run(async () => { await api('/me/memory/consent', 'PUT', {enabled: false}); setMemory(await api('/me/memory')); })}
            onWorkbench={() => enter('作者工作台')}
            onMaterials={() => enter('提交资料')}
            onAdmin={() => enter('回访管理')}
            onOfficial={() => enter('官方数据')}
          />
        )}
        {page === '提交资料' && <ImportPage url={url} busy={busy} sourceId={sourceId} notice={notice} onUrl={setUrl} onImport={() => run(async () => { const data = await api('/sources/resolve', 'POST', {url}); setSourceId(data.source_id); setNotice(data.status === 'pending_content' ? '已登记链接，官方渠道暂未取得该帖正文。' : '已取得官方摘要，等待作者核验与展示许可。'); })} role={user?.role} />}
        {page === '导入' && <ImportPage url={url} busy={busy} sourceId={sourceId} notice={notice} onUrl={setUrl} onImport={() => run(async () => { const data = await api('/sources/resolve', 'POST', {url}); setSourceId(data.source_id); setNotice(data.status === 'pending_content' ? '已登记链接，官方渠道暂未取得该帖正文。' : '已取得官方摘要，等待作者核验与展示许可。'); })} role={user?.role} />}
        {page === '回访管理' && ['admin', 'researcher'].includes(user?.role) && <AdminPage role={user.role} pane="manage" />}
        {page === '官方数据' && user?.role === 'admin' && <AdminPage role={user.role} pane="official" />}
        {!['发现', '内容', '我的关注', '通知', '更新', '作者工作台', '回访', '采访', '草稿', '账号', '资料与记忆', '提交资料', '导入', '回访管理', '官方数据'].includes(page) && <EmptyState kind="discover_empty" onAction={(spec) => enter(spec.ctaPage || '发现')} />}
        <span hidden data-view={view.screenId} data-regions={view.regionIds.join(',')} data-overlay={view.overlay?.pattern || ''} />
      </main>
      <MobileTabBar page={page} onEnter={enter} busy={busy} notifications={notifications} />
      <Overlay
        intent={overlay?.intent} viewport={viewport} title={overlay?.title} body={overlay?.body}
        confirmLabel={overlay?.confirmLabel} onConfirm={overlay?.confirm} onCancel={() => setOverlay(null)}
      />
      <Toast text={notice} onDone={() => setNotice('')} />
      <footer className="app-footer">内容由作者确认后在本站发布。测试材料会明确标记。让认真留下的回答，等到它的后来。</footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
