# 后端接入指南

v1.2 新增 `demo/` React 功能页面与官方/记忆适配，正在实施验收。API 默认本机地址为 `http://127.0.0.1:8080`；交互接口文档为 `/docs`，实时契约为 `/openapi.json`。`docs/openapi.json` 是静态快照，不能证明当前容器已升级。完整请求示例见 `scripts/demo.mjs`。本机前端使用 `pnpm --dir demo dev`，默认同源代理到 8080；可通过 API_PROXY_TARGET 指定隔离验证服务。

## 会话与响应

读者调用 `POST /api/auth/readers` 建立会话；具体同意字段以 OpenAPI 为准。作者/研究员由受控管理员流程建立账号并签发一次性登录凭证，调用 `POST /api/auth/sessions` 交换为会话。后续请求携带 `Authorization: Bearer <session_token>`。邀请记录或链接不授予身份，也不要在请求中自报角色、用户 ID 或 cohort。

响应统一包含 `request_id`、`status` 和 `data`，失败时返回错误码及说明。保留 `request_id` 便于排障；不要把凭据写进前端日志。服务端采用 bearer 会话，无 Cookie 登录/CSRF 协议。当前未配置跨域 CORS，浏览器前端应通过自己的同源 `/api` 代理接入；新增跨域部署前须显式配置允许的来源。

## 完整流程

1. 作者通过 `POST /api/sources` 导入来源，保留返回的来源 ID、快照 ID 和材料哈希。原始发布时间、采集时间和材料类型分别展示；未知日期保持未知。
2. 分别处理作者核验、私有采访、外部模型处理和 Demo 公开展示许可。它们不是一项授权；管理员不能代作者签署公开许可。
3. `POST /api/cases` 建立案例。研究员/管理员进行当前快照人工复核；邀请接口只记录人工行为，不自动发送。作者接受案例后开始采访。
4. `POST /api/cases/:id/interviews` 返回会话和可能的异步任务。缺少模型配置/许可时会明确使用手动模式。
5. 回答使用 `POST /api/interviews/:id/messages`，携带当前 `expected_version` 和唯一 `client_message_id`。回答先保存，再排队生成下一问。成功响应中的 `message` 即已保存输入；`202` 不等于下一问已生成。
6. 使用 `GET /api/jobs/:id` 查看自己的任务，完成后刷新 `GET /api/interviews/:id`。建议从一秒轮询开始、无变化时退避，并在页面离开时停止轮询。失败时展示手动模式/原因，不能显示为作者拒绝。
7. 暂停/恢复/结束均传当前版本。结束返回 `draft_id`、草稿和待确认项；重复结束不会重复创建草稿。全部跳过时返回空草稿原因。显式 AI 整理使用 `/interviews/:id/draft-ai`，传实际当前草稿版本。
8. 草稿编辑会创建新版本。用新版本的哈希和所有待确认项 ID 执行确认，再显式发布。`409` 应刷新状态并让作者查看修改，不可静默覆盖或自动沿用旧确认。
9. 公开阅读使用 `/stories`、`/stories/:id` 和 `/followups/:id`，不要通过私有草稿接口拼公开页。关注采用 `PUT /stories/:id/interest`。`GET /me/following` 和 `/me/notifications` 仅返回当前用户数据。
10. 撤回立即关闭公开正文。删除来源返回异步回执；读者活动删除使用 `/me/data-deletion` 的明确范围。删除进度通过 `/deletions/:id` 查询。

## 客户端应区分的状态

| 情况 | 接入行为 |
|---|---|
| 401 | 请求重新建立/交换会话；不重放敏感写入 |
| 403/404 | 不展示越权资源，也不根据差异推测作者私有状态 |
| 409 | 刷新最新版本；同一消息键不得改用不同正文 |
| 410 | 内容撤回、删除或保留期届满；清除本地正文展示 |
| 422 | 缺许可、证据或确认等前置条件；展示具体原因 |
| 202 | 仅确认任务已接收；轮询任务和业务状态 |
| 无公开内容 | 显示真实空态，不注入样例冒充公开作者成果 |

公开内容只代表本机 Demo 发布；没有知乎发布或复制接口。模型输出是候选，只有作者确认和服务端许可检查后才可发布。

## 运维与数据边界

运行时模型使用独立 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY` 配置；客户端不接触模型密钥。WorkBuddy 是开发代理，与运行时模型分离。当前真实模型评测与真实作者试点均未验证。

私有采访/草稿默认最后操作后 30 天到期，公开展示许可默认最多 90 天。字段清理后的历史哈希只是原确认回执，不是当前缩减投影的哈希。读取不会延长保留期。详情见 `retention.md`。

读者活动删除保留账号；整账号注销使用 POST /me/account-deletion；请求前保存随机回执 ID 和查询密钥，旧登录会话在成功后失效。独立采访删除使用 DELETE /interviews/:id，须明确确认同时撤回它支撑的公开版本，详情见删除接口说明。研究导出需要负责来源的研究员权限，按日期/cohort 分层；固定窗口统计排除历史未知回应时间。参见 `deletion-api.md`、`research-api.md` 和 `acceptance-matrix.md`。

### Structured draft blocks

AI-C now requires `section: then | later | reflection` on every statement,
representing 当时表述／后来补充／现在回看. Render all three blocks, leaving a block
empty when the author supplied no evidence for it. `unresolved_items` plus
private statements form the private 仍未知／不愿公开 block; never copy this block
into the public page. The model must not manufacture content to fill a section.
Legacy/manual drafts can omit section; the author can assign it with a new
PATCH version. Both public read projections preserve supplied sections. A
section edit changes the content hash and invalidates old confirmation.

Withdrawal additionally permits admins and the researcher assigned by case
creation. Send POST `/api/followups/:id/withdraw` with an optional `{reason}`;
no body remains supported for existing clients. This does not allow operators
to read private interviews or drafts.
