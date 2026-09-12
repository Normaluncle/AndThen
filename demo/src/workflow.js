// UI affordances only. The server remains the authority for every transition.
export function draftActions(draft, savedStatements) {
  const dirty = !!draft && JSON.stringify(draft.statements) !== savedStatements;
  return {
    dirty,
    save: dirty && !draft?.privateContentExpired,
    confirm: !dirty && draft?.status === 'draft',
    publish: !dirty && draft?.status === 'confirmed',
    withdraw: draft?.status === 'published',
  };
}

export function interviewActions(session, messages) {
  const active = session?.status === 'active';
  const waiting = active && session.mode === 'ai' && messages.at(-1)?.role !== 'ai';
  return { waiting, answer: active && !waiting, pause: active,
    resume: session?.status === 'paused', finish: active || session?.status === 'paused' };
}

// Queue completion alone does not mean model output passed validation.
export async function readAiTask(request, jobId, kind) {
  const job = await request('/jobs/' + jobId);
  if (['queued','running'].includes(job.status)) return {status:job.status};
  if (job.status !== 'succeeded' || job.result?.error_code) return {status:'failed',message:'本次 AI 处理没有得到可用结果。原有回答和草稿仍保留，可检查条件后重试。'};
  if (kind === 'draft' && job.result?.draft_id) return {status:'succeeded',draft:await request('/drafts/'+job.result.draft_id)};
  if (kind === 'validation' && job.result?.validation) return {status:'succeeded',validation:job.result.validation};
  return {status:'failed',message:'任务已结束，但没有可用的处理结果。请保留原稿并重试。'};
}

// Serial polling: leaving a page cancels delivery, and failed requests stop until
// the caller explicitly refreshes. Never overlap or retry forever in the background.
export function poll(load, apply, failed, delay = 2000) {
  let stopped = false;
  let timer;
  const tick = async () => {
    try {
      const result = await load();
      if (stopped) return;
      apply(result);
      timer = setTimeout(tick, delay);
    } catch (error) {
      if (!stopped) failed(error);
    }
  };
  timer = setTimeout(tick, delay);
  return () => { stopped = true; clearTimeout(timer); };
}
