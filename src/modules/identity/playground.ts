export const LOCAL_DEMO_COHORT = 'local_demo_fixture';

export const DEMO_ACCOUNTS = [
  { path: 'reader', id: 'c04bfed0-818f-4628-a3d9-b991bdfc8001', role: 'reader' as const, displayName: '演示读者' },
  { path: 'author', id: 'c04bfed0-818f-4628-a3d9-b991bdfc8002', role: 'author' as const, displayName: '模拟作者（非知乎原作者）' },
  { path: 'admin', id: 'c04bfed0-818f-4628-a3d9-b991bdfc8003', role: 'admin' as const, displayName: '本地管理员' },
] as const;

/** One paragraph of the published follow-up, grouped the way the reader screen shows it. */
export interface FixtureStatement {
  section: 'then' | 'later' | 'reflection';
  text: string;
}

export interface FixtureFollowup {
  /** ISO date the demo follow-up is "published" at. */
  publishedAt: string;
  statements: FixtureStatement[];
}

/**
 * The demo样本 template: one entry per story the playground seeds. Fill in `title` and
 * `excerpt` for a 等待后来 sample; add `followup` to ship the same story as 已有后来, which is
 * what lets a reader see the finished result instead of only "waiting for the author".
 * Nothing else needs to be written by hand — the seeder creates the source, snapshot,
 * verification, consent, case, published version and the reader notification.
 */
export interface FixtureStory {
  id: string;
  title: string;
  excerpt: string;
  followup?: FixtureFollowup;
}

export const FIXTURE_STORIES: readonly FixtureStory[] = [
  { id: 'c04bfed0-818f-4628-a3d9-b991bdfc8011', title: '【演示】从车辆工程转行，后来适应了吗？', excerpt: '【虚构演示，非知乎原作者经历】2021年，我从车辆工程转向软件开发，给自己半年学习。我想记录第一份工作和适应团队的过程。你可以扮演作者补充后来，不讨论收入。' },
  { id: 'c04bfed0-818f-4628-a3d9-b991bdfc8012', title: '【演示】毕业五年，我想重新选择生活', excerpt: '【虚构演示，非知乎原作者经历】毕业时我去了大城市，想先工作几年再决定在哪里生活。五年后，我想重新看看当时的决定。请你扮演作者，写下一个用于测试的后来。' },
  { id: 'c04bfed0-818f-4628-a3d9-b991bdfc8013', title: '【演示】学烘焙的半年计划', excerpt: '【虚构演示】我计划用半年学会烤面包，每周练习一次，并记下配方和失败原因。现在半年过去了，可以聊聊发生了哪些变化。' },
  {
    id: 'c04bfed0-818f-4628-a3d9-b991bdfc8014',
    title: '【演示】考研上岸一年后，我把那半年补回来了',
    excerpt: '【虚构演示，非知乎原作者经历】备考那年我几乎每天都在教学馆，复试结束才敢睡个整觉。这里记录上岸之后的一年：换了城市、重新交朋友，也慢慢适应了实验室的节奏。',
    followup: {
      publishedAt: '2026-07-18T09:00:00.000Z',
      statements: [
        { section: 'then', text: '备考那半年，我每天只学两三个小时，但从没断过。真正难的是看着同学陆续保研成功，我还要假装自己不在意。' },
        { section: 'later', text: '上岸之后我先搬到新城市，花了两个月才把宿舍和实验室的节奏理顺。第一次独立做完一个实验，我在走廊里站了很久。' },
        { section: 'later', text: '第二年我把作息固定下来：上午处理数据，下午读文献，晚上留给朋友和自己。周末不再补觉，而是出门走走。' },
        { section: 'reflection', text: '回头看，那段备考给我的不只是录取通知，还有"我可以按自己的节奏坚持一件事"的底气。这句话后来帮我做了很多决定。' },
      ],
    },
  },
  {
    id: 'c04bfed0-818f-4628-a3d9-b991bdfc8015',
    title: '【演示】搬去新城市两年，我终于敢说这是我选的生活',
    excerpt: '【虚构演示，非知乎原作者经历】两年前我搬到一座完全陌生的城市，只带了一个行李箱。想记录这两年：工作、朋友，还有那些一个人吃饭的晚上。',
    followup: {
      publishedAt: '2026-08-02T09:00:00.000Z',
      statements: [
        { section: 'then', text: '刚来的时候我谁都不认识，下班就回出租屋，周末基本都在补觉，连楼下有什么店都不知道。' },
        { section: 'later', text: '第三个月我加入了楼下的羽毛球群，认识了第一批朋友；一年后换了一份更合适的工作，也不再害怕一个人吃饭。' },
        { section: 'reflection', text: '现在我会主动约人，也会给自己留独处的时间。这座城市不是我的故乡，但它是我自己选的，这一点让我踏实。' },
      ],
    },
  },
];

export function playgroundResetAllowed(cohort: string | null | undefined): boolean {
  if (!cohort) return true;
  return cohort === LOCAL_DEMO_COHORT;
}
