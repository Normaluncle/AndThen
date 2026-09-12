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

## 运行

本地配置保存在 Git 忽略的 `.env.local`。Compose 必须显式加载：

```
docker compose --env-file .env.local up -d --build
```

目标页面 http://127.0.0.1:5173，API http://127.0.0.1:8080。Python 记忆服务不发布主机端口。现有数据库卷保留。

开发规范已读取：backend-contracts、ai-evaluation、database-migrations、docker-ops、git-delivery。
