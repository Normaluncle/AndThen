import React,{useEffect,useRef,useState} from 'react';
import {api} from './api.js';

export function DraftEvidence({draft}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function load() {
    setBusy(true);setError('');
    try {const result=await api(`/drafts/${draft.id}/evidence`);if(active.current)setData(result);}
    catch(e){if(active.current)setError(e.message);}finally{if(active.current)setBusy(false);}
  }
  return <section><h2>查看已保存版本的依据</h2>
    <p>原内容、采访回答和作者修改分别标明来源。这里的私有依据仅供你核对，不会出现在公开阅读页。</p>
    <button disabled={busy} onClick={load}>{busy?'读取中…':'读取依据原文'}</button>
    {error&&<p role="alert">{error}</p>}
    {data&&<>{data.items.map(item=><details key={item.id}><summary>
      {item.source_kind==='original'?(item.material_level==='exact_excerpt'?'原内容片段':'原内容摘要'):item.source_kind==='interview'?'本次采访回答':'作者保存的修改'} · {item.visibility==='private'?'私有':'可用于公开草稿'}
    </summary><small>{item.id}</small><p className="body">{item.text}</p></details>)}
      {data.missing_refs.length>0&&<p role="alert">有 {data.missing_refs.length} 项依据已不可用，请补充或修改对应内容后再确认。</p>}
      {!data.items.length&&<p>当前没有可读取的依据。</p>}
    </>}
  </section>;
}
