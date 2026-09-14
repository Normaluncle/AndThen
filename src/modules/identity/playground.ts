export const LOCAL_DEMO_COHORT = 'local_demo_fixture';

export const DEMO_ACCOUNTS = [
  { path: 'reader', id: 'c04bfed0-818f-4628-a3d9-b991bdfc8001', role: 'reader' as const, displayName: '演示读者' },
  { path: 'author', id: 'c04bfed0-818f-4628-a3d9-b991bdfc8002', role: 'author' as const, displayName: '模拟作者（非知乎原作者）' },
  { path: 'admin', id: 'c04bfed0-818f-4628-a3d9-b991bdfc8003', role: 'admin' as const, displayName: '本地管理员' },
] as const;

export const FIXTURE_STORIES = [
  { id: 'c04bfed0-818f-4628-a3d9-b991bdfc8011', title: '【演示】从车辆工程转行，后来适应了吗？', excerpt: '【虚构演示，非知乎原作者经历】2021年，我从车辆工程转向软件开发，给自己半年学习。我想记录第一份工作和适应团队的过程。你可以扮演作者补充后来，不讨论收入。' },
  { id: 'c04bfed0-818f-4628-a3d9-b991bdfc8012', title: '【演示】毕业五年，我想重新选择生活', excerpt: '【虚构演示，非知乎原作者经历】毕业时我去了大城市，想先工作几年再决定在哪里生活。五年后，我想重新看看当时的决定。请你扮演作者，写下一个用于测试的后来。' },
  { id: 'c04bfed0-818f-4628-a3d9-b991bdfc8013', title: '【演示】学烘焙的半年计划', excerpt: '【虚构演示】我计划用半年学会烤面包，每周练习一次，并记下配方和失败原因。现在半年过去了，可以聊聊发生了哪些变化。' },
] as const;

export function playgroundResetAllowed(cohort: string | null | undefined): boolean {
  if (!cohort) return true;
  return cohort === LOCAL_DEMO_COHORT;
}
