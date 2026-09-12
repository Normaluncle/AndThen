# PRD v1.2 当前验收（2026-09-13）

本节替代下方历史记录中的“后端交付范围已结束”结论。当前范围包含官方知乎适配、memU 和功能页面，**整体仍在实施**。下面保留的 2026-09-12 审计只描述原范围。

| 验收项目 | 当前证据 | 状态 |
|---|---|---|
| 官方搜索 | 本地页面通过有效 Access Secret 返回摘要与精选评论；精确 URL 匹配才导入 | 搜索和本人列表实测通过；全文/评论读取与单页同步测试通过，真实样本待取得 |
| memU 真实链路 | memory-live.test.ts：隔离 PostgreSQL、真实 Qwen 整理、真实向量、memU 检索、采访问题，作者隔离与撤销 | 真实项目链路通过；更多故障/并行控制仍待补充 |
| 官方候选准备 | 浏览器搜索、关注、取消再关注；真实 Qwen + memU 得到四条来源记录，重复操作仍一个任务；无核验作者 | 真实来源准备通过；核验且同意后的复用由隔离数据库模拟服务测试验证，非真人试点 |
| 导入后的作者衔接 | 未核验/未同意不能审核；核验并同意后私有采访可开始；先核验再建回访能正确绑定；并发核验仅一个账号成功 | 隔离数据库接口测试通过，管理页面待实现和浏览器验收 |
| 准备材料失效 | 索引写入期间撤销、部分写入失败后新版本重试、快照替换后禁止旧准备复活 | 模拟依赖故障与真实数据库测试通过 |
| 记忆调度与刷新恢复 | 多 worker、不同版本按作者串行；其他作者可执行；共享模型并发；失败刷新回到 pending，重复点击去重 | 真实数据库自动化通过，隔离演示 API/worker 已加载 |
| 作者资料清单 | 已核验本人资料标题、材料范围、处理状态与截断说明；未核验和他人资料隔离 | 数据库权限回归通过；测试作者浏览器显示原文片段与可用记忆 |
| 主动资料提交 | 原文片段/回忆表单、版本阅读、用途同意/撤销；新增版本只允许负责账号，核验后旧导入者不能覆盖 | 数据库权限通过；Docker 浏览器原文提交与采访/模型同意通过，版本 v2 更新与撤销模型同意页面通过，旧记忆不再显示 |
| 作者采访 | 两个独立浏览器会话：作者接受回访、记忆 ready、真实提问、回答保存、暂停/恢复/结束 | fixture 浏览器通过；真人体验未验收 |
| 采访失败重试 | 重复问题/429/坏 JSON 后保留回答并追加下一问；重新核验权限/同意/状态/预算，重复点击不重排 | 真实数据库与模拟 HTTP 回归、按钮逻辑测试通过；Docker 浏览器重试后真实 Qwen 自动出下一问，原回答保留 |
| 编辑确认发布 | 作者编辑第 2 版；未保存时确认和发布禁用；保存后确认才允许发布 | 浏览器通过；workflow.test.js 覆盖状态保护 |
| AI 草稿/依据检查 | 真实 Qwen 首次引用类型错误被拒绝，原稿保留；修订提示词后生成第 4 版并通过 AI-D；新版本未自动确认/发布 | fixture 浏览器真实通过；错误任务结果回归及原有 AI-C/D 数据库测试通过 |
| 依据正文与私有范围 | 第 4 版展开原文与采访；调整私有/移除条目后保存第 5 版，未自动确认；引用范围和私有过期接口测试 | 草稿页面通过；Docker 浏览器私有回答已提交，读者发布投影未显示该回答 |
| 读者通知 | 原关注读者收到通知，阅读页面显示作者编辑后的文字 | 浏览器通过，站内通知，非知乎通知 |
| 撤回 | 作者撤回后读者从通知再次读取得到 HTTP 410，不显示版本正文 | 浏览器通过 |
| 页面异步状态 | 采访/记忆串行轮询、离开页面不写回；失败停止轮询 | workflow.test.js 通过；Docker 采访重试后自动刷新出现真实问题已通过 |
| 管理功能页面 | 来源列表、材料版本、核验/同意阅读、核验/审核/建回访表单、测试账户、失败任务列表 | Docker 浏览器测试账户创建、凭证显示/隐藏与独立登录、核验、建回访、审核、触达记录通过；失败任务重试与 AI-A 分析/读取结果实际操作通过 |
| OAuth | 底层 URL/换令牌/用户读取/state 校验/加密六项模拟测试通过；App ID/App Key 和回调安全契约未确认 | 启动/回调/一次性交付/返回既有账号/加密/同步/撤销已实现并通过模拟官方 HTTP 和真实数据库；真实入口待外部配置与 state 契约确认 |
| Docker 新增服务 | 三个镜像构建、独立迁移/服务健康、5174 页面和同源 API；memU 容器真实向量读写删除 | 启动、向量烟测及双账号 fixture 业务闭环通过；真实作者/OAuth 仍未验收 |
| Docker 双账号发布闭环 | 恢复采访、私有/公开回答分离、编辑 v2、读者发现关注、作者确认发布、通知只展示公开项、撤回后旧通知不可读 | 独立浏览器实际操作与数据库状态通过，详见 implementation-v1.2.md |

2026-09-13 最新集中验收：类型检查通过；227 项测试通过，169 项独立集成测试通过（各默认跳过的真实模型用例已单独执行通过）；前端 9 项测试、真实 Python memU 3 项测试、Docker 和浏览器补测通过。完整逐项差距与外部条件见 [Goal 集中验收](goal-audit-v1.2.md)。

---

# Backend acceptance audit

Audit date: 2026-09-12. The local engineering scope is delivered; **P4 real-model evaluation and real-author pilot remain unverified**. The user changed the PRD scope to a local backend Demo with authorized imports and no required Zhihu integration or business pages. WorkBuddy quota failure was followed by explicit authorization for Codex to implement directly. Real-author participation and independent real-model evaluation have not occurred.

Evidence scope: PostgreSQL tests create isolated databases; simulated HTTP providers prove transport/control behavior, not model quality. Docker evidence is versioned in `docker-acceptance.md`; historical measurements are identified separately from the final runtime. Source references below are repository-relative.

## PRD T01–T22

| ID | Backend evidence | Audit result / remaining work |
|---|---|---|
| T01 summary only | `sources-import.test.ts` rejects summary-as-quotation; `cases.test.ts` requires current-snapshot review before invitation | Backend rules covered; no page verification in backend scope |
| T02 independent dates | `sources-import.test.ts` preserves unknown/null and known dates; `migrations.test.ts` checks acquisition/publication independently | Covered by database/API assertions |
| T03 low likes vs knowledge | `analysis.test.ts` paired low-popularity experience/high-popularity knowledge fixtures; server overrides knowledge-only invite candidates | Deterministic recommendation policy covered; actual model classification quality remains P4 |
| T04 concurrent follows | `stories.test.ts` concurrent upsert, cancellation and restoration | Covered |
| T05 test-account exclusion | `stories.test.ts`, `research.test.ts` cover author, test_fixture, team and prompted exclusions | Covered for implemented aggregate metrics |
| T06 forwarded invitation / unrelated author | `cases.test.ts`, `verifications.test.ts`, `interviews.test.ts`, auth tests | Covered authorization checks; invitations cannot establish identity |
| T07 decline / do-not-contact | `cases.test.ts` prevents new invitation and reader access to private case | Covered; no external sender exists |
| T08 sensitive / unauthorized | `analysis.test.ts` sensitive rules-only path and zero provider requests; case review gate | Covered deterministic examples, not comprehensive sensitive-content classification |
| T09 different interview branches | `interview-ai.test.ts` completed/stopped/ongoing inputs reach different simulated replies | HTTP orchestration covered; real-model tone/branch evaluation pending |
| T10 skip / pause / resume | Budget/skip/replay tests plus `worker-crash.test.ts`: actual worker process killed during HTTP request, replacement reclaims after lease expiry with new token, answer retained and next question written once | Process recovery covered; semantic paraphrase quality remains part of unverified real-model evaluation |
| T11 injected publish instruction | `analysis.test.ts` sends malicious source text as evidence, verifies no tools/functions are granted, rejects extra publish fields and observes no publication/invitation/notification effects | Controlled hostile source/output regression passed; real-model resistance not inferred |
| T12 invented date / number | `evidence.test.ts`, `drafting.test.ts` reject unsupported text, refs and private leakage | Covered conservative exact-evidence checks; paraphrase quality not evaluated |
| T13 edit invalidates confirmation | `interviews.test.ts`, `validation.test.ts` reject old hash and require new version | Covered |
| T14 duplicate publish / notify | `interviews.test.ts` concurrent publication and outbox replay; `reader-deletion.test.ts` removes old recipients | Covered |
| T15 withdraw / delete | Source/interview/activity tests plus `account-deletion.test.ts` credentials, author content, independent receipts and concurrent follow race | End-user active-store erasure covered; backup/provider retention remains explicitly separate |
| T16 Zhihu search errors | No Zhihu search integration or fake live results; authorized import is the Demo input | Not applicable under revised scope; no claim of tested Zhihu 429 behavior |
| T17 failure / quota | `llm-client.test.ts` timeout/retry; `interview-ai.test.ts` full-handler 429 and malformed JSON fallback preserves saved answers and hides provider body; daily admission cap test | HTTP failure handling covered; real-provider availability remains unverified |
| T18 restart / redeploy | Current fixture survived DB/API/worker restart and forced recreation, with nonempty isolated backup restore | Passed through runtime `65bcb27`; details and hashes in docker-acceptance.md |
| T19 no authorized result | `stories.test.ts` checks empty database and unlicensed-only fixtures return empty lists and no private text | Backend empty-state regression passed; no business UI in scope |
| T20 mixed windows / cohorts | `research.test.ts` date/cohort filtering, deidentified fields, fixed-duration window groups, deadline/late/unknown timing; `cases.test.ts` server-recorded response time | Backend reporting covered for new timestamped records; legacy missing times excluded rather than guessed. No real participant study claimed |
| T21 private/public isolation | Source, case, interview, draft, notification and job owner checks; public statement projection tests | Individual ownership tests plus `private-route-sweep.test.ts` cover anonymous, unrelated and expired sessions on nine core private reads and both public projections |
| T22 copied vs Zhihu published | No copy endpoint or Zhihu publisher; Demo publication is local only | Not applicable under backend scope; no external-publication success claim |

## PRD chapter 16 route audit

All paths below have `/api` prefix.

| Required route | Current status |
|---|---|
| POST sources; GET stories/:id; POST sources/:id/analyze | Implemented; AI task returns job ID and does not change case status |
| PUT stories/:id/interest; GET me/following | Implemented |
| POST cases; POST cases/:id/invitations; POST cases/:id/decision | Implemented with review/identity/decline gates |
| POST cases/:id/interviews; POST interviews/:id/messages | Implemented, with durable answer before model execution |
| POST interviews/:id/finish | Now returns persisted `draft_id`, draft and pending confirmation items; concurrent retry reuses the same draft. If all answers are skipped/empty, returns null draft with explicit reason |
| PATCH drafts/:id; POST drafts/:id/confirm; POST drafts/:id/publish | Implemented with hash/version checks |
| POST followups/:id/withdraw | Author, admin and case-assigned researcher paths implemented; optional reason and exactly-once audit, stranger/reader denied (`withdrawal.test.ts`) |
| GET me/notifications | Implemented as an alias of notifications, same owner filter |
| POST me/data-deletion | Explicit reader_activity scope; author source deletion is DELETE sources/:id and account closure is POST me/account-deletion with independent receipt credential |
| GET admin/research-export | Implemented with source authorization, date/cohort filters, deidentified event details and explicit denominator limitations; legacy research/export uses the same contract |

## Implementation-plan delivery gates

| Gate | Evidence / remaining work |
|---|---|
| P0 development agents | Scheduler, skills, worktree/session persistence and fixed-model/1M guards exist under tools/workbuddy and tests/orchestrator. Prior live short-session recovery verified. Three-process scale test/full-1M recall not verified; quota blocked original development workflow and user authorized takeover |
| P1 foundation | Node24/Fastify/PostgreSQL18/Drizzle; additive migrations; opaque hashed sessions; real-DB job lease/dedupe/fence tests; one-shot Compose migration |
| P2 business / AI / governance | Core modules implemented, including structured draft sections and accepted operator withdrawal |
| P3 complete backend fixture | Manual import→review→follow→interview→confirm→publish→notify→withdraw→delete exercised in tests and live Docker. Independent-model A/B/C/D paths use simulated providers in tests |
| P4 real model | No independent credentials supplied; explicit unverified boundary permitted by active goal. Do not report authentic AI interview evaluation or provider deletion |
| P5 Docker / persistence / performance | Runtime `65bcb27` deployed healthy with six migrations; fixture persistence/cleanup and nonempty restore verified. Final 10-session sample write p95 138.08 ms and async acknowledgment p95 80.20 ms |
| Prompts and schemas | Four versioned prompts and validators; five-question/skip and injection regressions. AI-C requires then/later/reflection section on each statement; unresolved_items is the separate private unknown block. Empty blocks remain empty. Older/manual drafts permit absent section, author can classify by a new version; section changes invalidate the hash. |
| Retention | 30-day private cleanup and 90-day consent checks implemented. Backup rotation is operator-invoked; no daily host schedule. External provider retention remains a documented dependency |
| Artifacts | Source, migrations, scheduler, skills, Compose and scripts exist; startup/frontend guides refreshed, static/live OpenAPI matched 50 paths. Runtime evidence tied to `65bcb27`; 35 application test files / 167 tests plus 38 scheduler tests passed |

Local backend engineering, documentation and Docker acceptance are complete under the user-authorized takeover. P4 requires an independent provider configuration, and no real-author pilot or external research result is claimed. Three-process WorkBuddy scale testing/full-1M recall remain unverified following its quota error; prior sessions and scheduler are preserved. Backup rotation requires the operator to run the supplied script, and external provider retention is not controlled by this repository.
