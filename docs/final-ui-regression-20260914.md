# 2026-09-14 统一页面与交互回归

本次针对用户第二批 12 条浏览器反馈；保留原有视觉方向及顶部三个主导航。更新现有 andthen-v12-demo，未新增 Compose 项目、删除容器数据卷或改动历史工作分支。

## 修复与浏览器证据

| 反馈 | 修复与验证 |
| --- | --- |
| 登录后关注变成简化列表 | Following 共用卡片：封面、正文摘要、状态、管理入口。演示读者登录后实际读取 4 条数据库记录，退出仍用相同结构；长摘要为右侧状态区留出独立列。 |
| 通知简化列表 | NoticeList 共用头像、未读点、标题、摘要、日期及操作；真实通知展示可公开的故事标题，不泄漏撤回材料。手机端不再隐藏最后一条通知和已读标签。 |
| 首页返回和顶栏跳动 | Discover/品牌返回清空搜索并恢复横幅。首页只显示中央搜索；搜索结果只显示顶部搜索。固定顶栏列宽和滚动条占位。桌面账号通知/历史/设置/回答的品牌、导航、铃铛 x 坐标分别一致为 200/375/1120（1445px 测试宽度）。 |
| 封面字幕 | 日期与描述独立两行，左对齐，小号白字灰透明底。使用原始发布时间，缺失显示未知，不推测年份。窄工作台封面日期禁止拆行。 |
| 折叠筛选 | 初始仅排序及展开箭头；展开显示起止日期、清除。首页/搜索共用。 |
| 评论 | 评论按钮滚动定位到关注块下方编辑器；测试示例发送评论、回复、表情、@评论者，产生父评论与回复引用，无额外评论弹窗。真实回复由数据库保存，禁止跨故事回复。 |
| 反馈 | 更多功能增加反馈类型/正文；匿名反馈独立数据库表并提供管理员分页读取；不会伪报成功。隔离数据库测试覆盖提交、重复提交、权限。 |
| 其他详情不完整 | 4 条设计故事与真实原回答复用完整 Story 结构，含侧栏、话题、推荐、互动、关注与评论。真实后来保留双栏阅读/来源/站内推荐/评论；已实测打开数据库发布版本及返回原回答。 |
| 工作台重叠 | 摘要、关注人数、按钮、投票恢复正常文档流；桌面和 390px 实测人数行至少在摘要下方 18px。 |
| 单条关注状态 | 示例关注按故事独立维护，取消 career 后剩余 3 条；真实关注从 /me/following 恢复，不再初始误显示未关注。 |
| 游客官方搜索 | 浏览器未登录搜索“职业选择”，实际获得官方知乎摘要。服务端开发者配置已加载，search=true；密钥不进入浏览器或日志。 |
| 设置统一 | 登录与游客均为知乎账号、作者身份、AI 资料、数据授权、隐私五张卡片。390px 无页面横向溢出；缺失资料保留同一结构。 |
| 分享补查 | 原回答分享保留 source/story，后来分享保留 exact followup version；自动测试覆盖，不能分享后来却跳回原回答。 |

## 自动验证

- `pnpm typecheck`：通过。
- `pnpm test`：239 通过，1 跳过（真实 memU 外部联调）。之后补充通知隐私回归，单独 `pnpm exec vitest run tests/business/community.test.ts`：5/5 通过，包含新增通知用例。
- `pnpm test:integration`：178 通过，1 跳过；独立临时数据库执行，迁移、授权、业务、OpenAPI 均通过。
- `node --test demo/src/*.test.js demo/src/design/*.test.js`：48/48；随后新增精确分享目标用例，search-model.test.js 4/4 通过。
- `pnpm --dir demo build`：成功，最终 bundle `index-DAb9yMU4.js`。
- `/openapi.json`：3.1.0，包含公开反馈、站内评论、游客搜索路径。
- Docker demo/API/worker 已更新，数据库及记忆服务保留；API/worker/db/memory 健康。启动必须使用 `scripts/start-ui-preview.ps1` 加载已有本地知乎开发者配置。

## 接口和材料的真实边界

- 知乎搜索已可用；OAuth 能力仍返回 `callback_security_requires_verification`，没有绕过回调身份核验。真实知乎资料同步需完成该配置。
- @昵称支持编辑、选择当前评论者及展示；尚不投递专门的提及通知。
- 设计示例的交互仅保留本次页面会话；真实账号的站内评论、收藏、点赞、反馈使用数据库。原回答及后来共用故事级评论与互动。
- 部分既有测试材料未存原回答发布时间，显示未知；未补造日期或作者资料。干净图片池等用户素材，保留统一占位符。
- 官方搜索上游一次最多 10 条，没有游标就不伪造第二页；本站搜索支持分页。
- 动效本轮未调整。

## 文件与技能

主要修改：demo/src/design 的 Story/Reading/Following/NoticeList/Notifications/SettingsPage/Connected/Engagement/DesignApp/SearchFilters，StoryCover，home.css/design.css；community 模块、followups 通知投影、sources 关注摘要、zhihu 搜索认证策略；schema 与增量 0015；测试及 docs/contracts.md。

已阅读并遵循：AGENTS.md、backend-contracts、database-migrations、docker-ops、web-development、computer-use。未创建提交。
