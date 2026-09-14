const fallbackReader = [
  '你是否实现了当时设定的目标？',
  '过程中遇到的最大困难是什么？',
  '现在的生活和心态，有哪些不同？',
  '如果可以对当时的自己说一句话，你会说什么？',
];

export function interviewInsert(text, kind) {
  const value = text || '';
  if (kind === 'bold') return value + ' **重点**';
  if (kind === 'italic') return value + ' *感受*';
  if (kind === 'link') return value + ' [链接](https://)';
  if (kind === 'list') return value + '\n- ';
  return value;
}

export function interviewRail(context, currentAi) {
  const tags = context?.reader_interests?.tags || context?.readerInterests?.tags || [];
  const title = context?.title || '';
  const published = context?.published_at || context?.publishedAt || '';
  const purpose = currentAi?.purpose;
  return {
    originalTitle: title,
    originalText: context?.text || '当时的回答原文会在材料就绪后出现在这里。',
    originalDate: String(published).slice(0, 10),
    originalYear: String(published).slice(0, 4),
    originalUrl: context?.original_url || context?.originalUrl || '',
    why: purpose
      || (title ? `这个问题来自你过去提到的「${title}」经历。我们希望了解这个选择之后的变化，以及你现在如何看待当时的决定。` : '基于你过去的回答，我们想了解当时与现在的连接。'),
    reader: tags.length ? tags.slice(0, 4).map((tag) => tag.tag || tag).filter(Boolean) : fallbackReader,
  };
}
