# 产品验收范围

这里保留团队判断功能是否可用的依据；个人运行日志、逐轮开发记录和代理调度记录不作为产品档案发布。

| 范围 | 可复现检查 | 当前边界 |
|---|---|---|
| 身份与权限 | tests/integration/auth.test.ts、tests/business/private-route-sweep.test.ts | 角色由服务端决定，不允许客户端自报 |
| 来源与关注 | tests/business/stories.test.ts、interest-reasons.test.ts | 同一人同一帖一票；取消关注不计入理由统计 |
| 五问采访 | tests/business/interview-ai.test.ts | 含跳过与澄清，最多五问；模型故障不丢已保存回答 |
| 草稿与发布 | tests/business/drafting.test.ts、validation.test.ts、tests/unit/article-context.test.ts | 问题与回答经作者确认后公开，不能编造依据 |
| 删除与撤回 | tests/business/account-deletion.test.ts、withdrawal.test.ts等 | 旧内容不可继续公开读取；外部模型数据保留依供应商规则 |
| 作者记忆 | tests/business/memory*.test.ts、services/memory/test_memory.py | 隔离、更新、失效、重建与故障恢复；真实调用需凭证 |
| 官方能力 | tests/business/zhihu*.test.ts、oauth*.test.ts | 官方搜索及真实 OAuth 登录已验证；本人内容列表为空，全文与评论正向样本跳过 |
| 页面状态 | demo/src/*.test.js | 未保存修改不能确认旧版本；页面离开后停止轮询更新 |
| 数据库与队列 | tests/integration/migrations.test.ts、jobs.test.ts | 增量迁移、去重和崩溃恢复 |

## 已观察到的结果

2026-09-13发布前：后端232项通过、1个真实模型opt-in测试默认跳过；页面10项通过，类型检查及前后端构建通过。GitHub首轮CI通过。此前项目级真实Qwen/向量/memU联调和本地虚构双账号发布链路已验证；这些不等同于真实作者试点或生产容量保证。

最近的页面验证包含：读者自定义疑问归类、作者工作台人数比例、旧稿补问题形成待确认版本、分段编辑、确认发布和读者读取。已存在的短稿不会自动改写或补造事实。

## 尚需外部条件

- 赛事凭证、HTTPS 回调及真实账号登录已完成；用户已确认显示姓名且刷新不掉登录。
- 真实作者参与、内容授权及采访质量评估。
- 服务器及可信 HTTPS 已部署；长期稳定性和生产容量不由本轮短时验收保证。

## 本地重跑

`pnpm docker:testdb:up` → `pnpm typecheck` → `pnpm test`。
页面：`node --test demo/src/*.test.js`、`pnpm --dir demo build`。
Python记忆服务测试需安装services/memory/requirements.txt：`python -m unittest discover -s services/memory -v`；真实向量调用显式设置MEMORY_LIVE_TEST=1，使用自己的配置。不要把模拟测试标成真实模型质量评估。

## 2026-09-13 云端集中验收更新

详见 [cloud-verification-20260913.md](cloud-verification-20260913.md)。真实 Qwen、memU、向量服务、草稿检查、发布通知及撤回删除已实测；三个独立浏览器账号完成管理/作者/读者操作。五问采访质量未通过：提前收尾及重复提问触发安全降级，重试后仍未稳定完成五问。不要将手动兜底闭环通过写成 AI 五问全通过。
