import React from 'react';

const levels = { exact_excerpt: '原文片段', api_summary: '官方摘要', author_recollection: '作者回忆', ai_summary: 'AI 摘要' };
const states = { indexed: '已有可用记忆', consent_required: '尚缺采访或模型处理同意', material_missing: '尚未取得材料', batch_limit: '超出本次最多 20 条的处理范围', no_current_memory: '暂无可用记忆，可能尚未处理或未提取到有依据的内容' };
export function MemoryMaterials({ materials }) {
  if (!materials) return null;
  return <section><h2>资料使用情况</h2><p>这里只列出已核验属于你的资料。登录不会自动取得全部知乎帖子；摘要和原文片段都不代表全文。</p>
    {materials.items.length === 0 && <p>目前没有已核验的资料。尚未关联的帖子不会按昵称自动归到你的名下。</p>}
    {materials.items.map(x => <article key={x.source_id}><h3>{x.title || '未命名资料'}</h3><p>{levels[x.material_level] || '尚无内容'} · {states[x.status] || '状态待确认'}</p><small>资料编号：{x.source_id}</small></article>)}
    {materials.truncated && <p>当前展示最近 50 条已核验资料，清单尚未列全。</p>}
  </section>;
}
