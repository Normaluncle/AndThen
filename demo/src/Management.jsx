import React, {useEffect, useState} from 'react';
import {api} from './api.js';

export function Management({role}) {
  const [rows,setRows]=useState([]),[next,setNext]=useState(null),[selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null),[caseData,setCaseData]=useState(null),[links,setLinks]=useState([]),[consents,setConsents]=useState([]);
  const [subject,setSubject]=useState(''),[evidence,setEvidence]=useState(''),[checked,setChecked]=useState(false);
  const [name,setName]=useState(''),[issued,setIssued]=useState(null),[failures,setFailures]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function run(action,message='') {
    setBusy(true);setError('');setNotice('');
    try {await action();setNotice(message);} catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  async function list(offset=0) {
    const data=await api('/operator/sources?offset='+offset);
    setRows(data.items);setNext(data.next_offset);
  }
  async function open(row) {
    setSelected(row);setDetail(null);setCaseData(null);setChecked(false);setEvidence('');
    const [source,verifications,permissions,visit]=await Promise.all([
      api('/sources/'+row.source_id),api(`/sources/${row.source_id}/author-verifications`),
      api(`/sources/${row.source_id}/consents`),row.case_id?api('/cases/'+row.case_id):null,
    ]);
    setDetail(source);setLinks(verifications.items);setConsents(permissions.items);setCaseData(visit?.case??null);
  }
  async function review(decision) {
    await api(`/cases/${caseData.id}/review`,'POST',{
      expected_version:caseData.updated_at,snapshot_hash:detail.snapshots[0].content_hash,
      decision,reason_code:decision==='eligible'?'source_checked':decision==='hold'?'missing_material':'not_suitable',
      evidence_ref:evidence,confirms_source_and_safety_review:true,
    });
    await open({...selected,case_id:caseData.id});
  }
  useEffect(()=>{run(()=>list());},[]);
  return <section><h1>来源与回访管理</h1>
    <p>核验需真实的归属依据；创建账号不代表核验通过。这里只记录人工触达，不会向知乎发送私信。</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {notice&&<p role="status">{notice}</p>}{busy&&<p role="status">处理中…</p>}
    <button disabled={busy} onClick={()=>run(()=>list())}>刷新来源列表</button>
    {rows.length===0&&!busy&&<p>没有可管理的来源。</p>}
    {rows.map(row=><article key={row.source_id}><h2>{row.title||'未命名来源'}</h2>
      <p>资料许可：{row.permission_status} · 回访：{row.case_status||'尚未建立'} · 准备材料：{row.preparation_status||'尚未建立'}</p>
      <button disabled={busy} onClick={()=>run(()=>open(row))}>查看材料与处理回访</button>
    </article>)}
    {next!==null&&<button disabled={busy} onClick={()=>run(()=>list(next))}>下一页来源</button>}
    {detail&&<article><h2>当前来源：{detail.source.title||'未命名'}</h2>
      <p>编号：{detail.source.id}</p><p>真实性标记：{detail.source.provenance} · 资料许可：{detail.source.permission_status}</p>
      {detail.source.original_url&&<a href={detail.source.original_url} target="_blank" rel="noreferrer">查看原链接</a>}
      <h3>材料版本</h3>{detail.snapshots.map(snapshot=><details key={snapshot.id} open={snapshot===detail.snapshots[0]}>
        <summary>版本 {snapshot.version} · {snapshot.material_level}</summary>
        <p className="body">{snapshot.excerpt||snapshot.body||'尚未取得正文'}</p><small>快照：{snapshot.id}</small>
      </details>)}
      <h3>作者归属与处理同意</h3>
      {links.length===0&&<p>没有作者核验记录。</p>}{links.map(link=><p key={link.id}>账号 {link.user_id} · {link.status} · {link.method}</p>)}
      {consents.length===0&&<p>尚无处理同意。</p>}{consents.map(consent=><p key={consent.id}>{consent.purpose} · {consent.status} · 版本 {consent.version}</p>)}
      <label>待核验作者账号编号<input value={subject} onChange={e=>setSubject(e.target.value)}/></label>
      <label>核验或审核依据编号<input value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
      <p>填写受控依据的编号，不要在这里粘贴密码、凭证或私密证件。</p>
      <label><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>我已核对本次操作所需的原始资料与归属依据</label>
      <button disabled={busy||!subject||!evidence} onClick={()=>run(async()=>{
        await api(`/sources/${detail.source.id}/author-verifications`,'POST',{subject_user_id:subject,method:'manual',evidence_ref:evidence,approve:false});
        await open(selected);
      },'已记录为待核验，尚未确认作者归属。')}>记录待核验</button>
      {role==='admin'&&<button disabled={busy||!subject||!evidence||!checked} onClick={()=>run(async()=>{
        await api(`/sources/${detail.source.id}/author-verifications`,'POST',{subject_user_id:subject,method:'manual',evidence_ref:evidence,approve:true});
        await open(selected);
      },'作者归属核验已通过。资料处理仍需作者本人同意。')}>确认核验归属通过</button>}
      {!caseData&&<button disabled={busy} onClick={()=>run(async()=>{
        const data=await api('/cases','POST',{source_id:detail.source.id,launch_type:'reader_initiated'});
        await open({...selected,case_id:data.case.id});
      },'回访已登记。')}>为这篇来源建立回访</button>}
      {caseData&&<><h3>回访审核</h3><p>当前状态：{caseData.status} · 作者账号：{caseData.author_user_id||'尚未绑定'}</p>
        <p>通过审核需要有效资料许可；读者导入的链接还需要核验作者及其采访同意。</p>
        {[['eligible','通过审核'],['hold','暂缓：资料不足'],['excluded','排除：不适合回访']].map(([decision,label])=><button key={decision} disabled={busy||!checked||!evidence||!detail.snapshots.length} onClick={()=>run(()=>review(decision),'已保存审核结果。')}>{label}</button>)}
        <button disabled={busy||caseData.status!=='eligible'||!checked} onClick={()=>run(async()=>{
          await api(`/cases/${caseData.id}/invitations`,'POST',{channel:'manual',notes:'操作人员在功能页面确认已完成人工触达'});
          await open({...selected,case_id:caseData.id});
        },'已登记人工触达记录；系统没有对外发送消息。')}>确认已经人工触达并登记</button>
      </>}
    </article>}
    {role==='admin'&&<><h2>创建测试作者账号</h2>
      <p>账号使用 team_test 分组。登录凭证只在本页面临时展示，不保存到浏览器存储；离开页面后不再显示。</p>
      <label>测试作者名称<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <button disabled={busy||!name} onClick={()=>run(async()=>{
        setIssued(null);const data=await api('/admin/users','POST',{role:'author',display_name:name,cohort:'team_test'});
        setIssued(data);setSubject(data.user.id);
      },'测试账号已创建，尚未核验任何来源。')}>创建测试账号</button>
      {issued&&<div><p>账号编号：{issued.user.id}</p><label>一次性登录凭证<input type="password" readOnly value={issued.login_token}/></label><p>过期时间：{issued.expires_at}</p><button onClick={()=>setIssued(null)}>隐藏并清除本页凭证</button></div>}
      <h2>失败任务</h2><button disabled={busy} onClick={()=>run(async()=>setFailures(await api('/operator/jobs')))}>查看失败任务</button>
      {failures?.items.length===0&&<p>没有失败任务。</p>}{failures?.items.map(job=><article key={job.id}><p>{job.kind} · {job.status} · 尝试 {job.attempts} 次</p><small>任务编号：{job.id} · {job.updated_at}</small></article>)}
      {failures?.next_offset!==null&&failures?.next_offset!==undefined&&<button disabled={busy} onClick={()=>run(async()=>setFailures(await api('/operator/jobs?offset='+failures.next_offset)))}>下一页失败任务</button>}
      <p>失败不表示业务已完成。当前请在对应采访、记忆或评论页面检查条件后重新发起；批量重试尚未开放。</p>
    </>}
  </section>;
}
