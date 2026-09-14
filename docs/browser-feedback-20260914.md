# 浏览器 16 项反馈处理（2026-09-14）

## 已实现

| 注释 | 处理 |
| --- | --- |
| 1 | 相关话题按钮进入 screen=01&q=关键词；保留发现导航、可刷新和后退 |
| 2、4 | 独立站内点赞/评论/收藏工具栏；真实来源接数据库接口，设计样例仅当前会话内存；移除页底重复收藏按钮；收藏在个人中心读取 |
| 3、16 | 更多菜单含举报和分享；举报幂等入库并供管理员读取；分享弹窗提供精确故事深链接及复制，复制失败可手动选择 |
| 5 | 桌面通知选中图标蓝色描边、fill=none；保持个人中心标签切换 |
| 6、8 | 个人主页读取 /me/zhihu 的可用昵称/UID；资料设置复用 OAuth 授权和同步。memU 结果只读并附来源，移除虚构已授权与手填假资料。记忆处理同意独立，不把关注故事自动扩展到作者主题 |
| 7 | 顶部登录打开统一弹窗，分真实使用、体验演示、开发者。真实使用建立读者会话再绑定知乎；开发者凭证不能自报角色。设置页不再挂一整块重复登录表单 |
| 9 | 首页、关注、工作台及推荐使用 StoryCover；干净图片池支持 tags 和稳定选图；cover_caption 为独立 HTML 透明深灰圆角白字。当前图片池空，等待用户提供图片；设计例字幕明确为虚构示例 |
| 10 | 空结果居中，独立插图占位，清除筛选、查看其他故事或搜索入口 |
| 11 | 首页与搜索共用日期范围/排序控件；本站接口按原发布时间筛选及分页，首页已选筛选可带入搜索 |
| 12–14 | 首页只显示中央搜索；提交后隐藏横幅和分类、显示顶栏搜索，使用独立列表结果布局；十条本站分页，知乎独立分区 |
| 15 | 搜索右侧保留关于并添加推荐，仅读取已获公开许可的 /stories，不推荐外部候选；没有从知乎结果借用站内推荐 |

## 已确认的外部限制

- 运行时知乎搜索返回服务未配置凭证，真实 OAuth 也返回 available=false。前端已调用真实接口并显示不可用状态，没有伪造知乎结果；需要后端完成官方凭证和回调配置。
- 官方搜索目前无游标，一次至多 10 条。本站结果有真实分页；日期与排序只作用于本站。
- 图片池清单位于 demo/src/cover-pool.js，用户提供干净图片后填写 src/alt/tags。AI 封面短句生成尚无后端字段及溯源契约，前端已预留 cover_caption；当前只有设计样例字幕。
- OAuth 未返回的头像、简介不猜测。memU 现有返回为通用记录，未强行分类为职业/人生阶段/兴趣三个固定字段。独立主题订阅无现有契约，未将关注作者偷偷等同于主题关注。
- 举报已可提交与管理员读取，后续审核状态/处置流程未新增。浏览历史跨端、个人数据导出保持之前的后端交接项。
- 动画动效按用户要求留后续。

## 文件与验证

前端：Home、StoryCover、cover-pool、design/SearchPage/SearchFilters/search-model/Engagement/ConnectedSaved/ProfilePanel/ReportsPanel、Account/SessionPanel/Connected/DesignApp/navigation、对应样式和测试。
后端：community 模块、模块注册、公开故事搜索、schema 和追加迁移 0014、读者数据删除覆盖、community 与迁移测试、contracts 文档。

已阅读技能：web-development、ui-design、computer-use、backend-contracts、database-migrations、docker-ops。未改 app.ts/worker.ts 的基础注册方式，未重置或删除历史 Docker 卷、分支或其他 agent 工作。

浏览器验证：三个顶层导航保留；中央输入和话题进入搜索；空态布局；本站检索“转行”返回 2 条，知乎未配置状态独立展示；站内 like/save 切换、评论抽屉、更多菜单和精确分享链接；设置页无重复登录表单；演示读者正常登录且显示真实 OAuth/memU 状态；通知 SVG stroke=rgb(8,123,255)、fill=none；390px 搜索输入可见且页面无水平溢出。真实评论/举报写入使用隔离测试数据库验证，未向现有故事写测试评论。

最终验证结果：

- `pnpm typecheck`：通过。
- `pnpm test`：238 通过、1 跳过（真实 memU 外部服务测试未启用）。
- `pnpm test:integration`：177 通过、1 跳过；迁移从空库应用、重复执行、唯一索引、互动幂等、越权、撤销公开许可、日期筛选与读者活动删除均覆盖。首轮迁移表数量断言需新增三张表，已修正；一次连接层未处理错误后完整重跑无错误。
- `node --test demo/src/*.test.js demo/src/design/*.test.js`：47 通过。
- `pnpm --dir demo build`：通过。最终产物 index-BQWSNJ41.js / index-Cw7PzA6e.css。
- 既有 andthen-v12-demo 镜像完成更新，迁移 0014 已应用；api/worker/db/memory healthy，demo 127.0.0.1:5174。旧 andthen 项目未改动。
- `/openapi.json` 返回 OpenAPI 3.1.0 且含 community/site-reports 路径；运行中公开来源 community 可读取，分页 limit=10，原有来源的本站指标从 0 开始。
- `git diff --check` 通过（仅已有 CRLF 换行提示）。没有提交 commit。
