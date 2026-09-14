export const notifications=[
 ['n1','你关注的故事有新后来','和相恋 8 年的 TA 分手后，我是如何走出来的？','作者发布了新的后续：“分手后的这一年，我终于学会了与自己和解……”','2 小时前',[248,396,59,59]],
 ['n2','作者补充了后续','辞职去做自己真正喜欢的事情，值得吗？','作者更新了后续：“这是我辞职一年的近况，分享一些新的体会……”','5 小时前',[248,511,59,59]],
 ['n3','你关注的故事有新后来','从双非到顶尖高校读研，我踩过哪些坑？','作者发布了新的后续：“上岸一年后回看，这些经验或许能帮到正在准备的你。”','8 小时前',[248,625,59,59]],
 ['n4','作者补充了后续','30 岁开始转行做设计，现在过得怎么样？','作者更新了后续：“转行两年后的真实生活：收入、工作状态和一些新思考……”','1 天前',[248,814,59,59]],
 ['n5','你关注的故事有新后来','考研二战失败后，我是如何重新找到方向的？','作者发布了新的后续：“虽然没有上岸，但我找到了更适合自己的路……”','2 天前',[248,935,59,59]],
];
export const unreadNotificationIds=['n1','n2','n3'];
export function isUnreadNotification(id,read){return unreadNotificationIds.includes(id)&&!read.includes(id);}
export function unreadNotificationCount(read){return unreadNotificationIds.filter(id=>!read.includes(id)).length;}
export function groupNotifications(tab,read,mobile=false){const groups=mobile?[['n1','n2'],['n3','n4']]:[['n1','n2','n3'],['n4','n5']];return groups.map(ids=>notifications.filter(n=>ids.includes(n[0])&&(tab==='全部'||(tab==='已读'?!isUnreadNotification(n[0],read):isUnreadNotification(n[0],read)))));}
