# 团队本地启动

## 凭证与环境

复制根目录 `.env.example` 为 `.env.local`，仅在本地填写。不要把团队密钥发到公开Issue或PR。

| 配置 | 用途 |
|---|---|
| LLM_BASE_URL / LLM_API_KEY / LLM_MODEL | OpenAI兼容模型；当前联调使用百炼与 qwen3.8-flash |
| EMBEDDING_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL | memU向量接口；当前 qwen3.7-text-embedding |
| MEMORY_SERVICE_TOKEN | 自行生成的随机服务间令牌，Compose传给API和记忆服务 |
| ZHIHU_ACCESS_SECRET | 官方允许范围内的搜索/数据能力 |
| ZHIHU_APP_ID / ZHIHU_APP_KEY / ZHIHU_REDIRECT_URI | 真实OAuth，尚未取得就留空 |
| ZHIHU_TOKEN_ENCRYPTION_KEY | 32字节十六进制加密密钥；配置后妥善备份，不能随意更换 |
| POSTGRES_PASSWORD | 本机数据库密码；不在本地之外复用示例密码 |

用密码管理器生成令牌。不要提交生成值。OAuth缺失不阻止本地固定身份试玩，缺模型配置则不能验证真实AI能力。

## Docker 启动

在仓库根目录执行（PowerShell、bash均可）：

```bash
docker compose --env-file .env.local -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml up -d --build
docker compose --env-file .env.local -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml ps
```

完整构建包括Node和Python依赖。不要使用本机开发者的临时Dockerfile；它们不在仓库里，也不是队友启动的前提。

## 填充三个明确标记的虚构试玩故事

下面只写入固定测试账号及虚构材料，重复执行保留已有进度；不导入真实作者身份。

```bash
docker compose --env-file .env.local -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml exec -u root api mkdir -p /app/scripts
docker compose --env-file .env.local -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml cp scripts/seed-local-playground.mjs api:/app/scripts/seed-local-playground.mjs
docker compose --env-file .env.local -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml exec api node scripts/seed-local-playground.mjs
```

打开 http://127.0.0.1:5174 ，点“切换为演示读者”关注一个演示故事，再“切换为模拟作者”进入工作台接受回访、采访和确认发布。切回读者查看通知。真实搜索内容不能让模拟作者冒充原作者发布后续。

Swagger：http://127.0.0.1:8082/docs 。这些地址仅在启动服务的那台电脑上可用，不能直接发给异地队友当线上Demo。

## 分工开发

后端安装Node24、pnpm（package.json指定版本），运行 `pnpm install --frozen-lockfile`。前端运行 `pnpm --dir demo install --frozen-lockfile`。实际代理目标与启动命令见 demo/vite.config.js 和 BACKEND.md。

测试使用独立PostgreSQL：`pnpm docker:testdb:up` 后 `pnpm typecheck`、`pnpm test`。真实模型测试需要显式开启及自己的凭证，CI默认不调用。

## 数据保护

不要运行 `docker compose down -v`、删除卷或清空数据库来更新代码。重新构建会执行新增迁移并保留数据库卷。每位队友保留自己的本地环境；未来共享测试服务器需另行配置域名、HTTPS和正式登录，不能直接开放本机试玩身份。
