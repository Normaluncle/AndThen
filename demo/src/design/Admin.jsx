import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Button, Panel, Tag, Icon, Modal } from './shared.jsx';
import { StoryCover } from '../StoryCover.jsx';

function formatCount(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

export function Admin({ navigate }) {
  const [menu, setMenu] = useState('样本库');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('全部');
  const [modal, setModal] = useState(null);
  useEffect(() => {
    let live = true;
    setError('');
    api('/admin/overview').then((value) => { if (live) setData(value); }).catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, []);
  const samples = (data?.samples || []).filter((row) => {
    const haystack = `${row.title || ''} ${row.category || ''}`.toLowerCase();
    if (query && !haystack.includes(query.toLowerCase())) return false;
    if (tab === '待回访') return row.status === '待回访';
    if (tab === '已回访') return row.status === '已回访';
    if (tab === '标记关注') return row.followers > 0;
    return true;
  });
  const stats = [
    ['book', formatCount(data?.visitors), '访问人数', '去重后的站点访问'],
    ['author', formatCount(data?.authorized_users), '已授权人数', '已连接知乎的账号'],
    ['ai', formatCount(data?.authorized_reads), '授权用户阅读', '授权账号读过的帖子'],
    ['heart', formatCount(data?.heat_score), '综合热度', data?.heat_formula || ''],
  ];
  return (
    <div className="d-admin" data-screen="10">
      <nav className="d-admin-nav">
        {['样本库', '回访管理', '研究数据', '官方数据', '接口状态', '内容审核', '团队管理', '系统设置'].map((label, i) => (
          <button className={menu === label ? 'active' : ''} key={label} onClick={() => { setMenu(label); if (i > 0) setModal(label); }}>
            <Icon name={['book', 'calendar', 'chart', 'clock', 'comment', 'shield', 'users', 'settings'][i]} />{label}
          </button>
        ))}
        <div className="d-blue-box">让真实的回答<br />被时间看见。<br />　—— 然后呢？</div>
      </nav>
      <div className="d-admin-main">
        <div className="d-admin-heading">
          <div>
            <h1>样本库</h1>
            <p>这些数字来自本站真实访问、授权和阅读记录，不是演示填充。</p>
          </div>
        </div>
        {error && <Panel><p role="alert">{error}</p></Panel>}
        <div className="d-admin-stats">
          <h3 className="d-admin-overview-title">数据概览</h3>
          {stats.map(([icon, value, label, trend]) => (
            <Panel key={label}>
              <Icon name={icon} />
              <div>
                <b>{data ? value : '…'}</b>
                <span>{label}</span>
                <small>{trend}</small>
              </div>
            </Panel>
          ))}
        </div>
        <Panel className="d-admin-table-panel">
          <div className="d-admin-tabs">
            {['全部', '待回访', '已回访', '标记关注'].map((item) => (
              <button className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>{item}</button>
            ))}
            <input aria-label="搜索样本" placeholder="搜索标题或分类…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="d-table-scroll">
            <table>
              <thead>
                <tr>{['标题', '年份', '分类', '当前状态', '关注人数', '热度', '最近更新'].map((heading) => <th key={heading}>{heading}</th>)}</tr>
              </thead>
              <tbody>
                {samples.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button className="d-sample-title" onClick={() => navigate('02', { source: row.id })}>
                        <StoryCover item={row} />
                        <span><b>{row.title || '未命名故事'}</b><small>{row.provenance === 'test_fixture' ? '演示材料' : '本站收录'}</small></span>
                      </button>
                    </td>
                    <td>{row.year || '—'}</td>
                    <td><Tag>{row.category}</Tag></td>
                    <td><Tag tone={row.status === '已回访' ? 'green' : row.status === '待回访' ? 'orange' : 'blue'}>● {row.status}</Tag></td>
                    <td>{row.followers}</td>
                    <td>{row.heat}</td>
                    <td>{row.updated_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!samples.length && <p className="d-muted">{data ? '还没有符合筛选条件的真实样本。' : '正在读取本站数据…'}</p>}
          <p className="d-muted">热度公式：{data?.heat_formula}</p>
        </Panel>
      </div>
      {modal && (
        <Modal title={modal} onClose={() => setModal(null)}>
          <p className="d-muted">当前先把样本库接到真实访问、授权和阅读数据。这一栏暂不另开站点功能。</p>
          <Button kind="secondary" onClick={() => setModal(null)}>知道了</Button>
        </Modal>
      )}
    </div>
  );
}
