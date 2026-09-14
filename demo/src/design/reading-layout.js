export function yearFromText(text) {
  const match = /(\d{4})\s*年/.exec(text || '');
  return match ? match[1] : '';
}

export function groupReadingSections(statements = []) {
  const groups = { then: [], later: [], reflection: [] };
  const known = statements.filter((item) => groups[item.section]);
  if (known.length) {
    for (const item of known) groups[item.section].push(item);
    for (const item of statements) if (!groups[item.section]) groups.later.push(item);
    return groups;
  }
  if (!statements.length) return groups;
  if (statements.length === 1) {
    groups.later = statements;
    return groups;
  }
  const first = Math.max(1, Math.ceil(statements.length / 3));
  const second = Math.max(first + 1, Math.ceil((statements.length * 2) / 3));
  statements.forEach((item, index) => {
    groups[index < first ? 'then' : index < second ? 'later' : 'reflection'].push(item);
  });
  return groups;
}

export function followingFeed(rows = [], candidates = []) {
  const used = new Set(rows.map((item) => item.source_id));
  const byLinked = new Map(candidates.filter((item) => item.linked_source_id).map((item) => [item.linked_source_id, item]));
  const fromSources = rows.map((item) => {
    const candidate = item.available === false ? byLinked.get(item.source_id) : null;
    if (candidate) {
      return {
        ...candidate,
        id: candidate.candidate_id,
        candidate_id: candidate.candidate_id,
        source_id: candidate.linked_source_id,
        author: candidate.author_name,
        date: item.followed_at?.slice(0, 10),
        text: candidate.text || '',
        status: '等待作者回应',
        tone: 'orange',
        reason: '等待收录后续',
        fixture: false,
        updated: false,
        followup: null,
      };
    }
    return {
      ...item,
      id: item.source_id,
      title: item.title || '暂不可用的故事',
      date: item.published_at?.slice(0, 10),
      author: '原回答作者',
      text: item.text || (item.available === false ? '这则关注的原回答目前不能公开展示。' : ''),
      updated: item.update?.status === 'published',
      followup: item.update?.status === 'published' ? item.update.version_id : null,
      status: item.available === false ? '暂不可用' : item.update?.status === 'published' ? '已有后来' : '等待作者回应',
      tone: item.update?.status === 'published' ? 'green' : 'orange',
      reason: '查看故事与后续',
      fixture: false,
    };
  });
  const extra = candidates.filter((item) => !item.linked_source_id || !used.has(item.linked_source_id)).map((item) => ({
    ...item,
    id: item.candidate_id,
    source_id: item.linked_source_id,
    author: item.author_name,
    status: '等待作者回应',
    tone: 'orange',
    reason: '等待收录后续',
    fixture: false,
  }));
  return [...fromSources, ...extra];
}
