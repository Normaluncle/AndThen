# 然后呢？后端运行说明

Node.js 24、TypeScript、Fastify 5、PostgreSQL 18、Drizzle、Vitest。仅后端；不依赖知乎官方接口。

已实现来源导入、关注、人工核验/复核、案例决策、采访、四阶段模型候选流程、草稿确认、Demo 发布、通知、撤回、来源删除、读者活动删除和研究导出。本机工程验收已完成；真实模型联调和真实作者试点尚未进行，详见 [验收矩阵](docs/acceptance-matrix.md)。

## 本机 Docker 启动

从仓库根目录执行：

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose build api
docker compose up -d --no-build
docker compose ps
Invoke-RestMethod http://127.0.0.1:8080/health/ready
```

Compose 启动 db、一次性 migrate、api 和 worker；迁移成功后应用才启动。API 绑定本机 8080，数据库默认不对主机发布端口。数据库保存在具名卷，普通停止/重建不删除数据。当前容器版本及已执行证据见 [Docker 验收](docs/docker-acceptance.md)；代码更新后需要重新构建。

```powershell
docker compose logs --tail 100 api worker migrate
docker compose stop
docker compose start
```

实时接口：`http://127.0.0.1:8080/docs`、`/openapi.json`。`/health/live` 只证明进程可响应，`/health/ready` 检查数据库；worker 使用持久心跳健康检查。

## 本机开发与测试

需要 Node 24 和 package.json 指定的 pnpm 版本。依赖由锁文件固定。

```powershell
pnpm install --frozen-lockfile
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d db
$env:DATABASE_URL='postgres://andthen:andthen@127.0.0.1:55432/andthen'
$env:TEST_DATABASE_URL=$env:DATABASE_URL
pnpm db:migrate
pnpm dev
# 在另一个设有相同 DATABASE_URL 的终端运行 pnpm worker
```

若配置了不同的 PostgreSQL 密码，连接字符串也必须对应。`DATABASE_URL` 用于应用和迁移；`TEST_DATABASE_URL` 只用于测试。不要同时让本机 API 和容器 API 占用同一端口。

```powershell
pnpm typecheck
pnpm test
node --test tests/orchestrator/*.test.cjs
pnpm build
pnpm exec tsx scripts/export-openapi.ts
```

应用测试在真实 PostgreSQL 中建立独立测试库；单元测试可用 `pnpm test:unit`。开发代理调度器使用独立 Node 测试，不包含在 Vitest 计数中。导出脚本从实际路由注册生成静态 OpenAPI，不启动监听器或 worker；它不能替代运行容器验收。

## 可复现演示与凭证

参见 [Docker 验收中的完整命令](docs/docker-acceptance.md)。演示脚本 `scripts/demo.mjs` 建立明确标记的 test_fixture，跑通人工采访到发布/通知的链路。`--verify` 检查保存结果，`--cleanup` 撤回并删除脚本保存的演示材料。

管理员凭证只通过受控 CLI 签发，例如容器内 `node dist/bootstrap/admin.js --email demo-ops@andthen.local --out /tmp/andthen-demo-admin.token`。将文件复制到 Git 忽略的 `data/demo/admin.token` 后传给演示脚本；不把凭证写入命令参数、仓库或共享报告。邀请不是登录凭证。

## 模型与配置

参考 [.env.example](.env.example)。独立业务模型使用 `LLM_BASE_URL`、`LLM_MODEL` 和按供应商要求设置的 `LLM_API_KEY`，采用 OpenAI-compatible Chat Completions。未配置时保留真实手动流程，不伪造 AI 成功。容器中的本机服务地址需要能够从容器访问，不能假定容器 loopback 就是 Windows 主机。

默认单次超时 30 秒、最多重试一次；输入/响应字节、输出 token、共享并发和每日任务数均有独立限制。每日任务限制是本地资源策略，不是供应商费用账单。WorkBuddy 仅用于开发编排，不能作为运行时模型凭证来源。

## 接口和运维文档

- [前端接入](docs/frontend-integration.md)：会话、异步任务、版本冲突、完整流程与状态处理。
- [业务接口](docs/business-api.md)、[AI 接口](docs/ai-api.md)、[删除接口](docs/deletion-api.md)、[研究导出](docs/research-api.md)。
- [备份、恢复与性能证据](docs/docker-acceptance.md)、[保留策略](docs/retention.md)。备份脚本输出哈希清单，恢复检查只使用隔离数据库；备份轮替当前需要操作员执行。
- [开发约定](AGENTS.md)、[WorkBuddy 调度器](docs/workbuddy-orchestration.md)、[最新检查点](docs/checkpoints/codex-takeover.md)。

读者/作者整账号注销和独立采访删除已提供，具体范围及独立回执查询见删除接口文档。最终 Docker 构建、重启持久化、备份恢复及性能样本已通过。没有真实模型配置或授权样本时，不宣称完成真实动态采访评测或真实作者试点。不购买云资源、不发布公网、不自动发送邀请。
