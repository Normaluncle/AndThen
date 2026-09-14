# 导航与接口接入核对（2026-09-14）

> 本文前半为此前导航轮次记录。最新 16 项反馈、已新增的收藏/评论/举报接口和剩余限制见 [browser-feedback-20260914.md](browser-feedback-20260914.md)，不再适用下面的“收藏接口缺失”旧结论。

本轮按用户最新要求暂停视觉精修，只统一页面结构、导航和现有接口。最后一次纠正：顶部必须保留「发现 / 我的关注 / 写下后来」，「我的回答」完整复用工作台内容，不移除头图、卡片和右侧说明。

## 路由与页面

| 入口 | 目标与行为 |
| --- | --- |
| 发现 | screen=01 |
| 我的关注、旧 screen=03 | screen=09&tab=following，个人中心内切换 |
| 顶部写下后来、旧 screen=05、个人中心我的回答 | screen=09&tab=answers，完整复用 Workbench；保留共同左侧导航 |
| 通知、旧 screen=04 | screen=09&tab=notifications，保留个人侧栏 |
| 我的主页 | screen=09&tab=profile，独立于资料设置 |
| 我的收藏 | screen=09&tab=saved，与关注数据分开 |
| 设置与资料 | screen=09&tab=settings |
| 愿意讲讲后来吗 | 当前页面打开确认弹窗；取消不跳转；确认后进入所选故事的采访 |
| 故事卡片与通知 | 传入独立故事 / 来源 / 发布版本标识；不再全部打开辞职示例 |
| 内容页返回 | 使用本次站内历史，保留实际来源；直接打开时回到合理默认入口 |
| 管理、状态样例、弹窗画廊、组件总览 | screen=10/13/14/15，仅 /me 返回 role=admin 后显示；查询参数不能授予角色 |

## 接入范围

- 会话：/auth/sessions、/auth/demo/reader、/auth/demo/author、/me、/auth/logout。凭证仅内存及后端 HttpOnly Cookie，不写浏览器存储或 URL。
- 登录后首页：/stories、/discovery/search；候选关注：/discovery/candidates/:id/interest。
- 关注：/me/following、/discovery/following、/stories/:id/interest；理由复用 ReasonPicker。
- 通知：/me/notifications、/notifications/:id/read、/followups/:id。通知读的是它自己的 followupVersionId；撤回内容不可继续读取。
- 作者：/me/workbench；选择自己的回答后，弹窗分别确认归属、私有采访、模型处理；调用现有 consent/decision/interviews 接口。
- 采访：读取、回答、跳过、暂停、恢复、结束、重试、草稿接口；沿用 expected_version、client_message_id、五问和异步等待规则。
- 草稿：读取、保存新版本、确认当前哈希、明确同意公开后发布、确认撤回。复用 DraftAssistant / DraftEvidence，保留 AI 辅助和依据功能。
- 资料：/sources/resolve、SourceMaterials、ZhihuAccount、/me/memory 及独立处理同意。以实际 enabled 字段显示记忆许可，不能从 status 猜测。
- 已登录时读取账号数据；未登录的视觉示例仍标注 test_fixture，样例不会被发送到业务写接口。

## 留给后端 / 未接事项

| 功能 | 当前处理 |
| --- | --- |
| 收藏回答同步、收藏列表、取消收藏 | 未找到对应契约；设计示例仅本次页面打开期间可收藏，真实回答收藏按钮明确未开放 |
| 个人主页简介 / 城市 / 人生阶段 / 主题编辑 | 未找到完整资料 CRUD 契约；已登录不展示假保存成功 |
| 浏览历史跨端同步 | 无契约；示例仅当前页面内存记录 |
| 数据导出 | 未接；不把其他研究导出接口当作个人数据导出 |
| 整账号 / 读者活动删除 | 后端已有专门接口，此次未新增危险操作 UI；SourceMaterials 原有单来源确认删除仍保留 |
| 非主故事的完整设计示例 | 只有概览摘要时显示对应故事摘要，明确缺少完整后续；不会拼入别人的故事 |
| 未登录公开真实发现流 | 当前保留原视觉预览；登录后进入真实接口数据 |
| 管理页 | 管理 UI 仍为明确的设计样例，访问权已收紧；此次未声称其样例统计为真实运营数据 |

## 验证

- pnpm typecheck 通过。
- pnpm test：235 通过，1 跳过。
- node --test demo/src/*.test.js demo/src/design/*.test.js：41 通过（新增路由、管理员限制、独立同意、发布映射、通知版本测试）。
- pnpm --dir demo build 通过。
- 浏览器：桌面三个顶层入口；个人主页/收藏/通知独立标签；通知只有一套个人侧栏；写作弹窗地址不变；390px 无页面横向溢出。
- 浏览器真实模拟作者：读取现有「正在写」任务，打开对应真实采访；未写回答、未开始新采访、未发布。
- 旧 API 不下发登录 Cookie 已修复：重建既有 api / worker / demo 镜像、幂等执行仓库已有迁移。HTTP 登录下发 Cookie，携 Cookie 调用 /me 为 200；浏览器刷新保留演示读者身份。API /openapi.json 返回 200。

阅读技能：web-development、ui-design、computer-use、backend-contracts、docker-ops、database-migrations。修改集中于 demo/src/design、demo/src/Home.jsx、demo/src/main.jsx。未改业务基础、数据库 schema 或其他 agent 的工作。

运行时最终更新：andthen-v12-demo 的 API / worker / db / memory 均 healthy，demo 5174 正常。另一个历史 andthen 栈保留；无卷清理。没有进行新采访、内容提交或真实发布的浏览器写入验收，写入顺序与权限前置通过新增单测及既有后端测试验证。

### 追加：版本地址与混合参数回归

- 保存或 AI 整理产生新草稿 ID 时，用 replaceState 同步新版本地址，并保留原返回来源；不会把旧版本留在当前地址，刷新也不会读回旧稿。
- 各页面仅接收对应资源编号（故事 source、采访 interview、草稿 draft、后来 followup、邀请 case）。混入其他类型的编号不再造成数据结构不匹配或错误页面。
- 新增 2 项回归，前端测试合计 43 项通过；Vite 构建通过。本次继续沿用此前已读的 web-development 与 docker-ops 技能，未做视觉改版。

### 追加：真实账号共用完整工作台卡片

- 提取 WorkbenchCard，设计示例与真实账号均复用同一套封面、标题/状态、读者关注和关注方向布局，移除真实账号侧的简化卡片分支。
- 接口未提供的封面使用已有书本 icon；未提供摘要/时间不编造。关注 0 人保留为 0，不显示样例 214；未知人数与 0 分开。方向比例取 reader_interests.tags，不填设计稿示例比例。
- 新增数据映射与目标编号测试，前端合计 45 项通过，构建通过。继续沿用已读 web-development / docker-ops 技能，本轮不改后台接口。
