import React, {useState} from 'react';
import {api} from './api.js';
import {canDeleteSource} from './workflow.js';

export function SourceMaterials({role}) {
  const [title,setTitle]=useState(''),[url,setUrl]=useState(''),[text,setText]=useState(''),[level,setLevel]=useState('exact_excerpt');
  const [provenance,setProvenance]=useState('test_fixture'),[id,setId]=useState(''),[detail,setDetail]=useState(null),[consents,setConsents]=useState([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [deleteConfirmed,setDeleteConfirmed]=useState(false),[receipt,setReceipt]=useState(null);
  async function run(action) {setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function read(sourceId) {setDeleteConfirmed(false);const d=await api('/sources/'+sourceId);setDetail(d);setConsents((await api(`/sources/${sourceId}/consents`)).items);}
  return <section><h1>提交与管理资料</h1><p>链接导入仍可在发现页通过官方渠道完成。这里用于主动提供你有权处理的原文片段或回忆；提交不等于公开发布，也不自动通过作者核验。</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <label>资料标题<input value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>原链接（选填）<input value={url} onChange={e=>setUrl(e.target.value)}/></label>
    <label>材料范围<select value={level} onChange={e=>setLevel(e.target.value)}><option value="exact_excerpt">逐字原文片段</option><option value="author_recollection">作者回忆</option></select></label>
    <label>材料内容<textarea value={text} onChange={e=>setText(e.target.value)}/></label>
    <label>资料真实性<select value={provenance} onChange={e=>setProvenance(e.target.value)}><option value="test_fixture">虚构测试材料</option><option value="team_material">团队提供的材料</option>{['admin','researcher'].includes(role)&&<option value="real_authorized">已取得授权的真实材料</option>}</select></label>
    <button disabled={busy||!text.trim()||!title.trim()} onClick={()=>run(async()=>{
      const result=await api('/sources','POST',{source_type:role==='author'?'author_paste':'researcher_import',title,original_url:url||null,material_level:level,...(level==='exact_excerpt'?{excerpt:text}:{body:text}),provenance});
      setId(result.source_id);await read(result.source_id);setNotice(`资料已保存为版本 ${result.version}。本次没有执行发布；当前许可状态以服务器返回为准，重复内容复用原版本。`);
    })}>保存资料</button>
    <h2>查看已有资料及处理同意</h2><label>资料编号<input value={id} onChange={e=>setId(e.target.value)}/></label><button disabled={busy||!id} onClick={()=>run(()=>read(id))}>读取资料</button>
    {receipt&&<p role="status">删除回执：{receipt.deletion_id} · {receipt.status} <button disabled={busy} onClick={()=>run(async()=>setReceipt(await api('/deletions/'+receipt.deletion_id)))}>查询删除进度</button></p>}
    {detail&&<article><h3>{detail.source.title||'未命名资料'}</h3><p>编号：{detail.source.id} · 许可：{detail.source.permission_status}</p>
      <label><input type="checkbox" checked={deleteConfirmed} onChange={e=>setDeleteConfirmed(e.target.checked)}/>我确认删除当前资料及其关联内容；删除后不可恢复</label>
      <button disabled={!canDeleteSource(detail.source.id,deleteConfirmed,busy)} onClick={()=>run(async()=>{const d=await api('/sources/'+detail.source.id,'DELETE');setReceipt(d);setDetail(null);setDeleteConfirmed(false);setNotice('已停止使用这篇资料，后台继续清理关联内容与记忆。');})}>删除当前资料</button>
      <p>更新材料时使用相同的来源类型与原链接（没有链接时使用相同标题）；服务器会检查写入权限并新增版本。旧版本保留。</p>
      {detail.snapshots.map(s=><details key={s.id}><summary>版本 {s.version} · {s.material_level}</summary><p>{s.excerpt||s.body||'尚无正文'}</p></details>)}
      <p>处理同意只能由有权作者授予；记忆建档和采访还需要单独完成作者核验。</p>
      {consents.map(c=><p key={c.id}>{c.purpose} · {c.status}</p>)}
      {[['private_interview','私有采访'],['external_model_processing','模型处理'],['demo_public_display','本站展示']].map(([purpose,label])=><div key={purpose}>
        <button disabled={busy} onClick={()=>run(async()=>{const result=await api(`/sources/${detail.source.id}/consents`,'POST',{purpose,version:'v1'});await read(detail.source.id);setNotice(result.analysis_status==='queued'?'已保存同意，正在分析回访价值与封面文案。':'已保存本项同意。');})}>同意{label}</button>
        <button disabled={busy} onClick={()=>run(async()=>{await api(`/sources/${detail.source.id}/consents/${purpose}`,'DELETE');await read(detail.source.id);setNotice('已撤销本项同意，相关使用将受限制。');})}>撤销{label}同意</button>
      </div>)}
    </article>}
  </section>;
}
