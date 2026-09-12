# v1.2 实施与验证记录

当前为实施中，不能作为完整交付声明。

## 已写入，待统一验收

- 作者记忆独立服务、授权/刷新、原文引用校验及采访接入。
- 官方搜索、URL 精确匹配和待补全导入。
- React 功能页面与作者工作台接口。
- 本地配置、Compose memory/demo 服务，新增数据库迁移。

## 必须继续完成

- 来源准备材料的自动触发、确认后增量更新、24 小时刷新与删除/撤销全链路。
- 官方本人内容/评论适配及 OAuth 实现和联调。
- 前端状态与契约逐页浏览器核对，管理页、真实双账号全流程。
- 项目级真实 memU 测试、故障恢复、全套回归和镜像运行验证。

## 已知外部条件

OAuth App ID/App Key 尚未提供。任意作者全文不能由目前的官方搜索保证。现有 Access Secret 本人创作列表返回空，缺少本人全文/评论真实样本。

Docker 构建在拉取 Python/Nginx 基础镜像时，Docker Hub auth token 网络请求超时；未修改系统网络，原容器保持运行。

## Git 与验证检查点

- `e4f3634`：第一阶段基础存档。类型检查通过；174 项 Vitest 测试通过；前端 build 通过；Python 3 项测试通过，含真实 embedding 批量/检索/删除测试。
- 后续真实项目链路：`MEMORY_LIVE_TEST=1 pnpm exec vitest run tests/business/memory-live.test.ts` 通过。测试使用隔离 PostgreSQL、真实 Python memU 服务、真实 Qwen 整理和提问、真实 embedding；覆盖作者隔离及撤销后不可检索。测试资料明确为 fixture，未写入真实参与者内容。
- 目标仍未完成：页面与双账号操作、更多生命周期行为以及官方适配剩余项继续执行。
- `acc72d4`：第二阶段存档，记忆生命周期作废机制与真实项目级采访联调。
- 本机隔离运行：API 8081、记忆服务 8090、页面 5173，数据库 andthen_v12_demo；原 8080 容器和原数据库保持运行。
- 浏览器已验证：读者建会话、官方搜索、关注 fixture；独立作者会话接受回访、记忆 ready、真实提问、回答保存、暂停/恢复/结束。发现并修复无请求体 POST 错发 JSON Content-Type。待继续：草稿发布、通知、撤回，以及异步状态刷新与成功反馈。

## 运行

本地配置保存在 Git 忽略的 `.env.local`。Compose 必须显式加载：

```
docker compose --env-file .env.local up -d --build
```

目标页面 http://127.0.0.1:5173，API http://127.0.0.1:8080。Python 记忆服务不发布主机端口。现有数据库卷保留。

开发规范已读取：backend-contracts、ai-evaluation、database-migrations、docker-ops、git-delivery。

## 页面闭环检查点（2026-09-13）

- 草稿未保存时禁用确认/发布；保存后新版本需重新确认。发布/撤回后读取服务端最新状态，提供明确成功提示。
- 通知阅读改为正常正文页面，不再显示原始 JSON 错误。
- 采访仅在可回答时启用输入提交；暂停/恢复/结束按钮随状态变化。后台问题更新引起版本冲突时先刷新并提示重试。
- 采访和 pending 记忆串行轮询，离开页面/开始操作后忽略旧响应，轮询错误停止。
- 独立作者和原关注读者在浏览器完成：编辑第 2 版→确认→本站发布→读者通知→读取新文字→作者撤回→读者再次读取 410。测试素材显式标为虚构 fixture。
- 验证：174 项后端测试通过、1 项 opt-in 跳过；typecheck 通过；4 项页面逻辑测试通过；Vite build 通过。
- 新增读取技能：cloudbase:web-development（用于一般 React/Vite 验证，无 CloudBase 接入）。
- 仍需继续全计划：来源准备生命周期、剩余官方接口/OAuth、管理页面、更多 memU 故障与生命周期验收、Docker 新镜像验收。
