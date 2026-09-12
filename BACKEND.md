# 后端开发说明

Node.js 24、TypeScript、Fastify 5、PostgreSQL 18、Drizzle、Vitest。
后端包含身份与权限、来源、关注、回访、采访、草稿、发布通知、撤回和删除模块；通过官方知乎接口和独立模型服务扩展能力。

## 启动完整 Demo

按[团队启动说明](docs/team-quickstart.md)配置本地环境与虚构试玩数据。页面在5174，接口说明在8082。官方和模型凭证仅放本地配置，不进入仓库。

## 本机开发

需要Node24和package.json指定的pnpm版本：

```powershell
pnpm install --frozen-lockfile
pnpm docker:testdb:up
$env:DATABASE_URL='postgres://andthen:andthen@127.0.0.1:55432/andthen'
$env:TEST_DATABASE_URL=$env:DATABASE_URL
pnpm db:migrate
pnpm dev
# 在另一个具有相同配置的终端运行 pnpm worker
```

不要同时让本机API与容器API占用相同端口。`.env.local`需要按选用的启动方式显式加载；Docker方式使用 `--env-file .env.local`。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm exec tsx scripts/export-openapi.ts
```

`tests/`是可重复的产品检查，不是一次性调试垃圾：验证账号权限、回答保存、最多五问、重复请求去重、发布确认、撤回和资料删除等。测试在独立PostgreSQL数据库运行；真实模型用例需显式开启。`demo/src/*.test.js`检查页面状态；`services/memory/test_memory.py`检查作者记忆服务，不能因为扩展名是Python就删掉。

## 开发约定

- 请求身份以服务端认证结果为准，不接受客户端自报角色。
- 资料同意与登录分开；作者确认当前版本后才能发布。
- 路由和任务注册在各自模块，不直接给app.ts或worker.ts追加业务逻辑。
- 数据迁移只新增；不清空数据库卷，不覆盖其他成员工作。
- 临时调试脚本放Git忽略的tmp目录；个人代理配置不作为产品文件发布。
- 修改接口同步contracts与OpenAPI，修改需求增量更新PRD。

更多说明：[架构](docs/architecture.md)、[接口契约](docs/contracts.md)、[前端接入](docs/frontend-integration.md)、[业务接口](docs/business-api.md)、[AI接口](docs/ai-api.md)、[删除接口](docs/deletion-api.md)、[研究接口](docs/research-api.md)、[保留策略](docs/retention.md)。
