// UI_14 design examples, never persisted or sent to a business endpoint.
export const homeStories = [
  {id: 'design-career', provenance: 'test_fixture', category: '职场发展', date: '2021-06-12', cover_caption:'2021.06 我选择了出发', title: '辞职去做自己真正喜欢的事情，值得吗？', text: '我在大厂工作了五年，收入稳定，但是觉得自己像一颗螺丝钉。\n上周我提交了辞职申请，准备给自己半年的时间，去做一直想做的独立开发。\n虽然不知道未来会怎样，但我想试一次。', counts: ['1.2 万', '892', '1,503'], crop: [63, 488, 168, 133]},
  {id: 'design-study', provenance: 'test_fixture', category: '学习成长', date: '2020-09-03', cover_caption:'2020.09 开始备考', title: '从双非到顶尖高校读研，我踩过哪些坑？', text: '本科是普通院校，但我一直不甘心。这里记录一下我准备考研的全过程，\n包括资料、时间安排、心态调整……\n希望能给同样在努力的同学一些参考。', counts: ['8,432', '412', '976'], crop: [63, 660, 168, 133]},
  {id: 'design-relationship', provenance: 'test_fixture', category: '情感关系', date: '2022-01-17', cover_caption:'2022.01 重新出发', title: '和相恋 8 年的 TA 分手后，我是如何走出来的？', text: '我们从大学到工作，一起走过了 8 年。\n但最终还是因为现实的原因分开了。\n这段时间我一直在调整自己，记录一些想法。', counts: ['6,201', '389', '643'], crop: [63, 829, 168, 132]},
];

export function filterHomeStories(items, category, query = '') {
  const words = query.trim().toLocaleLowerCase();
  return items.filter(item => (category === '为你推荐' || category === '全部' || item.category === category)
    && (!words || `${item.title} ${item.text}`.toLocaleLowerCase().includes(words)));
}

export function homeAction(item) {
  if (item.provenance === 'test_fixture' && item.id?.startsWith('design-')) return 'preview';
  if (item.candidate_id) return 'interest';
  if (item.source_id || item.linked_source_id) return 'open';
  return 'import';
}
