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
