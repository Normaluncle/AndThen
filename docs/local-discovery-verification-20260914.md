# 本地自动发现、CDN 封面与手机抽屉验收（2026-09-14）

## 已完成
- 自动发现通过 zhihu 模块 worker 生命周期注册，迁移 0018 保存运行记录与筛选结果，定时任务先安排下一批再执行官方搜索。
- 真实首批（02:20:55 UTC）：查询“辞职 转行 后来”，获取 10 条官方摘要，选中 5 条，5 条因每日测试额度暂缓。没有创建公开故事、作者授权或后来。规则初筛不代表 AI 质量判断。
- 短周期验证使用 1 分钟：02:21、02:22、02:23 的任务均成功执行并因额度已满跳过，不重复调用搜索。随后恢复 60 分钟，保留每天 5 条、3 次搜索限制。
- 250 个独立 CDN URL 逐条 GET 检查；第一次 249 成功、1 TLS 错误；复查后 250 均返回 200。HEAD 请求与 GET 响应不一致，因此以实际 GET 为准。记录在 assets/cover-library-250/connectivity-check.json，仅为本次网络快照。
- 0019 新增 250 项 CDN 目录，旧 150 项保留；浏览器直连 CDN，不经 API 转发图片。首页 5 张图片均 complete=true / naturalWidth>0。
- 手机 391×958：左侧个人中心拉杆打开纵向抽屉，7 项逐一切换、URL 正确、选择后关闭；设置项标为当前页面；Escape 关闭。1445×958 桌面拉杆隐藏、原侧栏显示。
- 修复 main.jsx 原先使用 demoEnabled 控制前端入口的问题。普通 URL 固定 DesignApp；仅显式 mode=live 使用旧功能界面。API 短暂失败不会换版。OAuth 回调目标统一到现有设置页，但没有调用外部 OAuth 做新验收。

## 验证命令和结果
- pnpm typecheck：通过。
- pnpm test：246 通过、1 跳过（外部 memU opt-in）。
- pnpm test:integration：185 通过、1 跳过。
- node --test demo/src/*.test.js demo/src/design/*.test.js：50 通过。
- demo Vite build：通过；JS 约 507 KB（gzip 138 KB），出现 500 KB 块大小提示。
- 从空数据库执行迁移与重复迁移：通过；OpenAPI 生成测试通过。
- CUA 浏览器检查：首页 5 个真实候选、5 张 CDN 图片、候选摘要弹窗及原帖链接；手机抽屉七个入口与桌面侧栏。

## 本地运行
正常启动前先应用迁移并构建镜像。开启本地候选预览：

```powershell
./scripts/start-ui-preview.ps1 -LocalDiscovery
```

不带 LocalDiscovery 则关闭候选预览与后续发现执行。调度配置在 docker-compose.discovery-local.yml；基础配置默认关闭，公网 URL 下即使误开预览开关也不运行。

## 当前运行限制
- Docker 在停止旧 API 容器时发生内核 D 状态（/proc/1/status 为 disk sleep，wchan=__vma_start_write），停止/强制停止均未收到退出事件。没有重启整机或 Docker、没有删除数据卷。
- 为恢复本地预览，在同一 API 容器内启动了新的 API 进程（DISCOVERY_INTERVAL_MINUTES=60），并启动已重建的 worker。API 已恢复响应，但旧 PID 1 的 Docker 内核阻塞仍未消除；这是临时恢复，不应描述为容器生命周期问题已修复。后续合适维护时段需处理 Docker/WSL，再正常重建预览服务。
- 本轮只验证本机，没有上传或部署服务器。没有为未授权摘要调用全文 AI 分析、创建作者资料或自动发布；这些仍需既有材料权限和独立同意。
- 规则仅粗筛，可能包含经验汇总和营销类内容；下一步需要经授权的 AI 样本评测来提高筛选质量。候选日期未知仍为空，不从正文年份猜原发布时间。

技能：backend-contracts、database-migrations、ai-evaluation、docker-ops；浏览器使用 CUA 工具说明。
