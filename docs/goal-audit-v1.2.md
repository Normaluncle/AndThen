# v1.2 Goal 集中验收与交接

验收日期：2026-09-13。范围按用户的完整修订计划，未把真实 OAuth、全文权限或公网部署假报为完成。

## 已实现的完整功能

| 计划要求 | 当前实现与证据 |
|---|---|
| PRD v1.2、保留原版、契约、验收矩阵 | PRD-v1.2.md、contracts.md、acceptance-matrix.md；旧版本及历史记录保留 |
| 独立功能网站 | demo/ React/Vite，同源 /api；发现、导入、故事、关注、通知、作者工作台、采访、草稿、资料、账号、官方数据和管理页面 |
| 官方搜索、准确链接、摘要、评论与作者链接边界 | zhihu/client、creator、discovery、comments；官方候选与站内内容并列；摘要不冒充全文、无法匹配保留待补全；不按昵称猜主页 |
| 作者身份与 OAuth | oauth-client/attempts/accounts/routes；一次性 state+浏览器关联，唯一 UID、密文、过期、返回既有账号、受保护的一次性站内会话交付；模拟官方 HTTP + 真 Postgres 测试 |
| OAuth 本人材料同步 | oauth-sync；明确同意后后台最多 20 条本人摘要、按 URL 核验、不覆盖其他核验归属、两项逐来源同意、作者回访关联、24 小时更新、关闭/撤销后旧任务失效 |
| 登录前回访准备 | discovery/preparation；仅首次关注触发，同版本去重，按来源隔离，核验与同意后才关联到作者；discovery-preparation.test.ts 三项回归 |
| memU 与真实模型 | 固定 memU 提交，内部 Python 服务、按作者/版本 SQLite 索引；Qwen 3.8 Flash + qwen3.7-text-embedding；真实项目联调和容器测试通过 |
| 记忆生命周期 | 新建/复用、版本更新、五条语义记忆、独立拒谈约束、24 小时检查、确认后更新、撤销/删除失效、重建、过期租约和清理串行；memory-lifecycle 与 memory-serialization、discovery-preparation、memory-live 测试 |
| 模型/存储故障与重试 | 回答先保存；重复问题、429、坏 JSON、进程中断回归；临时索引失败不能激活，清理任务可重试；真实问题恢复按钮和管理重试实际操作通过 |
| 一问一答采访 | 最多五问、跳过、暂停、恢复、结束、保留回答、依据检查；真实浏览器闭环及失败恢复通过 |
| 草稿与发布 | AI-C/D、手工修改、逐项依据和私有范围、保存版本、单独确认、本站发布、通知和撤回；独立账号浏览器通过 |
| 资料同意与删除 | 每项同意/撤销、记忆关闭删除、来源删除和回执；来源版本写权限真实数据库回归；页面实际新增 v2/撤销模型同意后不再显示旧记忆；删除表单保护 9 项前端测试之一，物理清理由数据库测试覆盖 |
| 审核与任务管理 | 权限保护的来源列表、核验、人工审核、触达记录、测试账号、AI-A 分析和失败任务重试；实际页面与数据库回归 |
| Docker/部署说明 | 独立 5174/8082 栈实际构建、迁移和启动健康；原 8080 栈及卷保留；docker-acceptance.md 给出完整命令 |
| Git 与凭证 | 分阶段 Git 存档；.env.local 与 tmp/ 已确认被忽略；没有提交提供方密钥或真实参与者材料 |

## 本轮集中验证结果

- pnpm typecheck：通过。
- pnpm test：227 通过、1 个 opt-in 跳过，52.97 秒。
- pnpm test:integration：169 通过、1 个 opt-in 跳过，49.65 秒。真实 PostgreSQL，从空库及重复迁移通过。
- node --test demo/src/workflow.test.js demo/src/api.test.js：9 通过。
- pnpm --dir demo build 以及 backend/demo Docker 构建：通过；最终容器 API、worker、db、memory 健康。
- MEMORY_LIVE_TEST=1 pnpm exec vitest run tests/business/memory-live.test.ts：1 通过，9.68 秒。默认套件跳过的真实测试在此独立执行，非未验证。
- memU 容器 python -m unittest：3 通过，5.193 秒，包含 22 条真实 embedding 分批写入、重开数据库检索、多作者隔离、删除与禁止旧版本重建，以及失败不标记 ready。
- 新 OAuth 的模拟官方 HTTP/真数据库验收：初次绑定、返回原账号、不能跨会话领取、一次性交付、并发归属冲突、加密回滚、会话撤销、资料同意同步、去重、撤销和关闭后不能写回。
- Docker 浏览器：资料 v2 保存、撤销模型同意、旧记忆消失；OAuth 缺配置时入口禁用；模拟失败状态中先保存回答、点击重试后真实 Qwen 自动出下一问；管理页重新执行失败任务，数据库新任务 succeeded；真实 AI-A 结果显示在页面。
- 完整双账号业务链路此前已经实际完成：发现/关注 → 作者接受 → memU 采访 → 私有/公开回答 → 编辑 v2 → 确认发布 → 读者通知 → 撤回后旧通知不可读。数据和过程保留在 implementation-v1.2.md 与 docker-acceptance.md；本轮补测未重写这些历史证据。
- OpenAPI 已从更新后的 8082 服务重新导出到 docs/openapi.json。

## 本轮真实调用记录及解释

真实 memory-live 建档：Qwen 整理 2 次，226 输入/163 输出 token，合计 3119 ms，一次索引写入；随后真实采访成功。该 opt-in 用例只输出统计，不输出真实凭证。

Docker 浏览器新增来源 32b51376-98e5-46f9-8937-8abe969ef1fd：AI-B 449/91 token、1636 ms；AI-A 386/311 token、4768 ms，两次均 succeeded，error_code 为空。AI-A 正确把虚构材料交给人工审核，没有替测试故事假造真实性。

向量测试实际处理 22 条文本并检索，记录整体耗时；提供方向量 token 消耗未单独汇总，不能把它写成零费用。测试结果不构成速度 SLA、长期稳定性或采访质量保证。历史真实 AI-C 初次引用类别失败及修正后的成功记录仍保留，没有隐藏失败。

## 仍受外部条件限制，不能称为真实验收完成

1. **真实知乎 OAuth**：没有赛事 App ID/App Key 和注册的公网 HTTPS 回调；当前官方 Skill 仍记载历史回调缺少 state，需要官方确认安全关联契约。代码与模拟联调已完成，真实入口按配置关闭；不要为了点亮按钮把验证标志随意改成 true。
2. **官方本人全文/完整分页评论的正向样本**：当前 Access Secret 账号内容列表为空。模拟契约与权限边界已验证；不能用 OAuth 冒充凭证本人调用受限接口，也不能声称已取得任意作者全文。
3. **公网部署**：尚无指定服务器和域名。Docker 本地完整部署已通过；拿到部署目标后才能验收真实公开地址、TLS 和 OAuth 回调。

这些外部项仍属于原目标，没有从 Goal 删除。该报告区分“实现完成”和“真实联调待条件”，不把整体 Goal 标成全部达成。

## 交给前端同事

从 demo/ 继续美化和组件拆分，保留现有接口、同意、材料范围、待处理/失败状态和确认发布门槛。演示入口 http://127.0.0.1:5174，API http://127.0.0.1:8082。会话仅在页面内存中，刷新页面需要重新登录；这是当前功能 Demo 的凭证保留方式。第三方授权在新页面完成后回原页面点击领取登录结果。

使用技能：skills/backend-contracts/SKILL.md、database-migrations、ai-evaluation、docker-ops、git-delivery，以及既有 web-development React/Vite 指南。修改涉及 Zhihu/OAuth、记忆与账号衔接、管理接口、功能页面、配置、增量迁移 0010–0012、测试和文档；未改写旧迁移、基础入口或其他代理历史。
