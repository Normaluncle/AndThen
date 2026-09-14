import React from 'react';
import {COPY, DESKTOP_NAV, MOBILE_NAV, TOKENS, navPage} from './ui14.js';
import {ProfileAvatar} from './Home.jsx';

function BrandMark() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">?</span>
      <span className="brand-name">{TOKENS.brand}</span>
    </span>
  );
}

export function AppHeader({page, user, notifications = [], query, onQuery, onSearch, onEnter, onBell, onAvatar, busy}) {
  const unread = notifications.filter((item) => !item.read_at && !item.readAt).length || (notifications.length && !notifications.some((item) => item.read_at || item.readAt) ? notifications.length : 0);
  return (
    <header className="app-header" data-region="chrome-header">
      <button type="button" className="brand-btn" onClick={() => onEnter('发现')} aria-label={TOKENS.brand}>
        <BrandMark />
      </button>
      <nav className="desktop-nav" aria-label="主导航">
        {DESKTOP_NAV.map((label) => {
          const target = navPage(label);
          const active = page === target || (label === '写下后来' && ['作者工作台', '回访', '采访', '草稿'].includes(page));
          return (
            <button key={label} type="button" className={active ? 'nav-link active' : 'nav-link'} disabled={busy} onClick={() => onEnter(target)}>
              {label}
            </button>
          );
        })}
      </nav>
      <form className="header-search" onSubmit={(event) => { event.preventDefault(); onSearch?.(query); }}>
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input aria-label="搜索关键词" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={COPY.search} />
      </form>
      <button type="button" className="icon-btn bell-btn" aria-label="通知" disabled={busy} onClick={onBell}>
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <button type="button" className="avatar-btn" aria-label="我的" disabled={busy} onClick={onAvatar}>
        <ProfileAvatar user={user} fallback={(user?.display_name || '游').slice(0, 1)} />
      </button>
    </header>
  );
}

export function MobileTabBar({page, onEnter, busy, notifications = []}) {
  const unread = notifications.length;
  return (
    <nav className="mobile-tabbar" data-region="mobile-tabbar" aria-label="移动导航">
      {MOBILE_NAV.map((item) => {
        const active = page === item.page
          || (item.page === '作者工作台' && ['回访', '采访', '草稿'].includes(page))
          || (item.page === '账号' && ['资料与记忆', '提交资料'].includes(page));
        return (
          <button
            key={item.page}
            type="button"
            className={`tab-item${item.icon === 'plus' ? ' tab-plus' : ''}${active ? ' active' : ''}`}
            disabled={busy}
            onClick={() => onEnter(item.page)}
          >
            <span className={`tab-icon tab-${item.icon}`} aria-hidden="true" />
            {item.page === '通知' && unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function DemoBar({enabled, busy, onReader, onAuthor}) {
  if (!enabled) return null;
  return (
    <aside className="demo-bar">
      <strong>本地试玩</strong>
      <button type="button" className="btn-secondary" disabled={busy} onClick={onReader}>切换为演示读者</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={onAuthor}>切换为模拟作者</button>
      <span>真实知乎内容仅作发现与关注；模拟作者只操作标记为演示的故事。切换身份后记录保留。</span>
    </aside>
  );
}

export function MobileTopBar({page, onEnter, onBell, user, notifications = []}) {
  const unread = notifications.length;
  return (
    <div className="mobile-top">
      <button type="button" className="brand-btn" onClick={() => onEnter('发现')}>
        <BrandMark />
      </button>
      <div className="mobile-top-actions">
        <button type="button" className="icon-btn" aria-label="通知" onClick={onBell}>
          <span aria-hidden="true">🔔</span>
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <button type="button" className="avatar-btn" aria-label="我的" onClick={() => onEnter('账号')}>
          <ProfileAvatar user={user} fallback={(user?.display_name || '游').slice(0, 1)} />
        </button>
      </div>
    </div>
  );
}
