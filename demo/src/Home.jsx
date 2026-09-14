import React, {useState} from 'react';
import {homeStories, filterHomeStories, homeAction} from './home-data.js';
import './home.css';
import {StoryCover} from './StoryCover.jsx';
import {SearchFilters} from './design/SearchFilters.jsx';
import {iconPaths as paths} from './icon-paths.js';

// The original supplied PNG is used as a sprite: only illustration/photo regions.
// Text, navigation, forms and cards remain selectable, responsive HTML.
export function HomeImage({crop, className = '', label}) {
  const [x, y, width, height] = crop;
  return <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={`home-image ${className}`} style={{aspectRatio: `${width}/${height}`, '--source-y': y}}>
    <img src="/home/reference.png" alt="" style={{width: `${1536 / width * 100}%`, left: `${-x / width * 100}%`, top: `calc(${-y / width} * 100cqw)`}} />
  </span>;
}

export function HomeIcon({name, ...props}) {

  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.comment} /></svg>;
}

export function HomeHeader({onEnter, query, onQuery, onSearch, page='发现', internal=false, onBack, notificationActive=false, unread=0,showWrite=true,showSearch=true,onLogin,user}) {
  return <header className={`home-header ${showSearch?'has-search':'no-search'}`} data-region="chrome-header">
    {onBack&&<button className="d-mobile-back" aria-label="返回" onClick={onBack}>‹</button>}
    <button className="home-brand" onClick={() => onEnter('发现')} aria-label="然后呢？"><HomeImage crop={[69, 114, 26, 30]} /><b>然后呢？</b></button>{internal&&<span className="d-internal-badge">内部</span>}
    {internal?<nav aria-label="后台主导航"><button onClick={()=>onEnter('发现')}>发现</button>{['内容管理','数据与研究','系统设置'].map(t=><button key={t} onClick={()=>onEnter(t)}>{t}</button>)}</nav>:<nav aria-label="主导航"><button className={page==='发现'?'selected':''} onClick={() => onEnter('发现')}>发现</button><button className={page==='我的关注'?'selected':''} onClick={() => onEnter('我的关注')}>我的关注</button>{showWrite&&<button className={page==='作者工作台'?'selected':''} onClick={() => onEnter('作者工作台')}>写下后来</button>}</nav>}
    {showSearch&&<form onSubmit={event => {event.preventDefault(); onSearch();}}><HomeIcon name="search" /><input aria-label="顶部搜索" placeholder="搜索关键词、问题或粘贴知乎链接" value={query} onChange={event => onQuery(event.target.value)} /></form>}
    <button className={`home-bell ${notificationActive?'d-notification-active':''}`} aria-label="通知" onClick={() => onEnter('通知')}><HomeIcon name="bell" />{notificationActive&&unread>0&&<i className="d-notification-dot"/>}</button>
    {!user&&onLogin?<button className="d-button secondary home-login" onClick={onLogin}>登录</button>:<button className="home-avatar" aria-label="我的" onClick={() => onEnter('账号')}>{user?<span className="d-profile-initial">{user.display_name?.slice(0,1)||<HomeIcon name="me"/>}</span>:<HomeImage crop={[1001, 113, 31, 31]} />}</button>}
  </header>;
}

export function Home({items, preview, query, onQuery, onSearch, onOpen, onInterest, onFillImport, onUrl, busy, onDesignOpen,searchMode=false,results,asideExtra,filterOptions={},onFilters,interactions={}}) {
  const [category, setCategory] = useState('为你推荐');
  const [searched, setSearched] = useState('');
  const [selected, setSelected] = useState(null);
  const [about, setAbout] = useState(false);
  const [localFilters,setLocalFilters]=useState({});
  const filters=onFilters?filterOptions:localFilters;
  const changeFilters=onFilters||setLocalFilters;
  let shown = filterHomeStories(preview ? homeStories : (items||[]), category, preview ? searched : '').filter(item=>{const date=item.date||item.published_at?.slice(0,10);return (!filters.from||(date&&date>=filters.from))&&(!filters.to||(date&&date<=filters.to));});
  if(filters.sort&&filters.sort!=='relevance')shown=[...shown].sort((a,b)=>String(a.date||a.published_at||'').localeCompare(String(b.date||b.published_at||''))*(filters.sort==='oldest'?1:-1));
  const categories = ['为你推荐', '职场发展', '人生选择', '学习成长', '情感关系', '创业思考', '全部'];
  function act(item) {
    const action = homeAction(item);
    if (action === 'preview') onDesignOpen ? onDesignOpen(item) : setSelected(item);
    else if (action === 'open') onOpen(item.source_id || item.linked_source_id);
    else if (action === 'interest') onInterest(item);
    else { onUrl(item.url || ''); onFillImport(); }
  }
  return <div className={`home-page ${searchMode?'home-search-page':''}`} data-screen="01">
    {!searchMode&&<section className="home-hero" data-region="hero">
      <div className="home-hero-copy"><h1>故事还在继续。</h1><p><span>看见一段过去的经历时，</span><span>有时候我们真正想问的是：然后呢？</span></p>
        <form className="home-search" data-region="search" onSubmit={event => {event.preventDefault(); onSearch ? onSearch(filters) : setSearched(query);}}><HomeIcon name="search" /><input aria-label="搜索故事" value={query} onChange={event => onQuery(event.target.value)} placeholder="搜索知乎里的旧回答，看看谁的故事还在继续…" /><button type="submit" disabled={busy}><span>搜索</span><HomeIcon name="search" /></button></form>
        <p className="home-import" data-region="import-link">或者 <button onClick={onFillImport}>粘贴知乎链接，直接查看 →</button></p>
      </div>
      <HomeImage className="home-hero-art" crop={[585, 174, 460, 202]} label="过去的回答是一个起点，而每一个后来都是新的可能" />
      <HomeImage className="home-hero-art-mobile" crop={[1150, 366, 326, 108]} label="过去的回答是一个起点，而每一个后来都是新的可能" />
    </section>}
    <div className="home-columns"><section className="home-feed">
      {searchMode?results:<><nav className="home-categories" aria-label="分类" data-region="category-tabs">{categories.map((value, index) => <button key={value} className={category === value ? 'selected' : ''} onClick={() => setCategory(value)}>{index === 0 && <HomeIcon name="flame" />}<span className="home-category-long">{value}</span><span className="home-category-short">{['推荐', '职场', '人生', '学习', '情感', '创业', '全部'][index]}</span></button>)}</nav>
      <SearchFilters value={filters} onChange={changeFilters}/>
      {shown.map((item, index) => <article className="home-story" key={item.id || item.source_id || item.candidate_id || index} data-region="feed" data-provenance={item.provenance}>
        <StoryCover item={item}/>
        <div className="home-story-copy"><h2><button onClick={() => act(item)}>{item.title}</button></h2><p className="home-meta">{item.category || item.author_name || '故事'} · {item.date || item.published_at?.slice(0, 10) || '官方摘要'}</p><p className="home-excerpt">{item.text}</p><span className="home-ellipsis">...</span><div className="home-counts">{(preview?[interactions[item.id.replace('design-','')]?.likes||0,interactions[item.id.replace('design-','')]?.comments||0,interactions[item.id.replace('design-','')]?.saves||0]:item.site_counts)?.map((count, i) => <span key={i}><HomeIcon name={['like', 'comment', 'star'][i]} />{count}</span>)}</div></div>
        <button className="home-then" data-cta="then" disabled={busy} onClick={() => act(item)}>然后呢？</button>
      </article>)}
      {!shown.length && <div className="home-empty"><div className="home-empty-art" role="img" aria-label="暂无结果插图占位"><HomeIcon name="search"/></div><h3>暂时没有符合条件的故事</h3><p>换个关键词，或去看看其他分类。</p><button className="d-button secondary" onClick={() => {setCategory('全部');setSearched('');changeFilters({});onQuery('');}}>查看全部</button><button className="d-button ghost" onClick={()=>document.querySelector('[aria-label="搜索故事"]')?.focus()}>搜索试一试</button></div>}</>}
    </section>
    <aside className="home-sidebar"><section className="home-about" data-region="about"><h2>关于「然后呢？」<button onClick={() => setAbout(true)}>了解更多 →</button></h2><p>我们从知乎的真实回答出发，通过 AI 回访原作者，让那些认真留下的经历，能够被时间补充完整。</p>
      {[['book', '基于真实内容', '来自知乎的公开回答'], ['ai', 'AI 辅助回访', '生成有深度的问题，不代写、不编造'], ['author', '原作者确认', '由作者亲自补充与发布']].map(([icon, title, desc]) => <div className="home-principle" key={icon}><span><HomeIcon name={icon} /></span><div><b>{title}</b><p>{desc}</p></div></div>)}
      {preview && <div className="home-stats" aria-label="设计稿示例统计">{[['1,203', '已发起回访'], ['317', '已有后来'], ['5,826', '感兴趣的读者']].map(([value, label]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}</div>}
      <div className="home-quote"><p>“有些回答，不该只停留在过去。”</p><span>—— 然后呢？</span><HomeImage crop={[941, 803, 122, 69]} /></div>
    </section>{asideExtra}</aside></div>
    {preview && <p className="home-provenance">设计稿演示 · 故事、头像及数字均为虚构示例</p>}
    {(selected || about) && <div className="home-modal-backdrop" onClick={() => {setSelected(null); setAbout(false);}}><section role="dialog" aria-modal="true" aria-label={selected ? '设计稿故事预览' : '关于然后呢'} className="home-dialog" onClick={event => event.stopPropagation()}><button autoFocus className="home-dialog-close" aria-label="关闭" onClick={() => {setSelected(null); setAbout(false);}}>×</button><h2>{selected?.title || '让认真留下的回答，等到它的后来。'}</h2><p>{selected?.text || '读者关注过去的回答，作者自主参与回访、补充经历并确认发布。AI 只辅助提问，不代替作者编造经历。'}</p>{selected && <small>这是设计稿虚构故事，仅供首页验收，不会发起真实回访。</small>}</section></div>}
  </div>;
}

