import React, { useState } from 'react';
import { formatParagraphs } from '../article-format.js';
import { Button, Icon, Panel, Tag, Modal } from './shared.jsx';
import { groupReadingSections, yearFromText } from './reading-layout.js';

const SECTIONS = [
  ['then', '当时'],
  ['later', '后来'],
  ['reflection', '现在回看'],
];

function yearLabel(value) {
  if (!value) return '';
  const match = /^(\d{4})/.exec(String(value));
  return match ? match[1] : '';
}

function sectionYear(items, fallback) {
  for (const item of items) {
    const year = yearFromText(item.text);
    if (year) return year;
  }
  return fallback || '';
}

function paragraphs(text) {
  return formatParagraphs(text || '').split(/\n+/).filter(Boolean);
}

export function LiveReading({ data, origin, navigate, engagement, recommendations }) {
  const [original, setOriginal] = useState(false);
  const groups = groupReadingSections(data.statements);
  const start = sectionYear(groups.then, yearLabel(origin?.published_at || origin?.date));
  const end = yearLabel(data.published_at) || sectionYear(groups.reflection, '');
  const span = start && end && start !== end ? `${start} – ${end}` : end || start;
  const banner = span ? `${span}，有些回答，需要时间才完整。` : '有些回答，需要时间才完整。';
  const originTitle = origin?.title || '当时的回答';
  const originDate = origin?.published_at?.slice(0, 10) || origin?.date || '发布时间未知';
  const originText = origin?.text || '可以回到原回答了解故事的起点。';
  return (
    <div className="d-two d-reading" data-screen="08">
      <Panel className="d-reading-main">
        <Tag>作者的后来</Tag>
        <h1>这段经历，后来怎么样了？</h1>
        <p className="d-reading-deck">{data.ai_assisted ? '作者自述，AI 辅助采访与整理。' : '作者自述。'}</p>
        <div className="d-reading-author d-reading-author-live">
          <p>{data.published_at?.slice(0, 10) || '发布日期未知'} · 发布于 然后呢？</p>
          {data.source_id && <Button kind="soft" onClick={() => navigate('02', { source: data.source_id })}>查看当时的回答 →</Button>}
        </div>
        <div className="d-reading-banner"><p>{banner}</p></div>
        <div className="d-reading-blocks">
          {SECTIONS.map(([key, title]) => {
            const items = groups[key];
            if (!items.length) return null;
            const date = key === 'then' ? start : key === 'later' ? span : end;
            return (
              <section key={key}>
                <h2>{title}{date ? <> · <span>{date}</span></> : null}</h2>
                {items.flatMap((statement) => paragraphs(statement.text)).map((line, index) =>
                  line.startsWith('## ')
                    ? <h4 key={`${key}-${index}`}>{line.slice(3)}</h4>
                    : <p key={`${key}-${index}`}>{line.startsWith('- ') ? `• ${line.slice(2)}` : line}</p>
                )}
              </section>
            );
          })}
        </div>
        {data.source_id && <Button kind="soft" className="d-reading-original wide" onClick={() => setOriginal(true)}>查看当时的回答 →</Button>}
        <p className="d-reading-disclaimer">ⓘ 作者自述{data.ai_assisted ? '，AI 辅助采访与整理' : ''}，未由平台独立核实。</p>
        <div className="d-reading-engage">{engagement}</div>
      </Panel>
      <aside className="d-sidebar">
        <Panel>
          <h3>这篇文章的来龙去脉</h3>
          <div className="d-blue-box d-origin">
            <Icon className="d-origin-icon" name="document" />
            <h4>原回答</h4>
            <small>{originDate}</small>
            <p>{originTitle}</p>
            {data.source_id && <button className="d-link" onClick={() => navigate('02', { source: data.source_id })}>› 查看当时的回答</button>}
          </div>
          <div className="d-blue-box d-origin">
            <Icon className="d-origin-icon" name="clock" />
            <h4>本次回访</h4>
            <small>{data.published_at?.slice(0, 10) || '已发布'}</small>
            <p>这是作者已确认并公开展示的后续。</p>
          </div>
        </Panel>
        <Panel>
          <h3>你可能也感兴趣</h3>
          {recommendations}
        </Panel>
      </aside>
      {original && (
        <Modal kind="drawer" title="查看当时的回答" onClose={() => setOriginal(false)}>
          <h3>{originTitle}</h3>
          <p className="d-muted">{originDate}</p>
          {(originText || '').split(/\n+/).filter(Boolean).map((line) => <p key={line}>{line}</p>)}
          {data.source_id && <Button kind="soft" className="wide" onClick={() => navigate('02', { source: data.source_id })}>查看完整回答 →</Button>}
        </Modal>
      )}
    </div>
  );
}
