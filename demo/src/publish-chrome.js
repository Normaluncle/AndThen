export const FOLLOW_REASONS = [
  ['现在的结果与变化', '后来过得怎么样了？\n是否实现了当初的想法？'],
  ['过程中的转折与经历', '这期间遇到了什么困难？\n有哪些重要的转折点？'],
  ['回头看的感受与建议', '现在如何看待这段经历？\n有什么经验教训？'],
  ['其他，我想补充', '我有其他好奇的问题…'],
];

export function followReasonLabels() {
  return FOLLOW_REASONS.map(([title]) => title);
}

export function publishBackTarget(draft) {
  const interview = draft?.interview_id || draft?.interviewId;
  if (interview) return {screen: '06', interview};
  return {screen: '05'};
}

export function publishChrome(draft) {
  return {
    back: publishBackTarget(draft),
    nativeSelect: false,
    rail: ['发布后读者将看到什么？', '事实由作者确认'],
  };
}

export function playgroundResetAllowed(user) {
  if (!user) return true;
  return user.cohort === 'local_demo_fixture';
}
