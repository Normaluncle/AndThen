# 团队协作指南

第一次使用 GitHub，可以把仓库理解为团队共同的工程档案：main 是整合版本，分支是个人工作区，commit 是存档，PR 是合并前的检查窗口。

## 最短工作流

```bash
git clone https://github.com/Normaluncle/AndThen.git
cd AndThen
git switch main
git pull --ff-only
git switch -c feat/your-task
# 修改并验证
git add <本次修改的文件>
git commit -m "demo: describe the change"
git push -u origin feat/your-task
```

然后在 GitHub 打开 Pull Request，按模板填写，请一位队友 review。优先使用 Squash merge 合并一项完整任务。开始下一项任务前回到 main 并 pull。Codex 新分支使用 `codex/` 前缀，人工队友可用 `feat/`、`fix/`、`docs/`。

没有仓库写权限的参与者先 Fork，再从自己的仓库发 PR；公开并不代表陌生人能改 main。首次邀请队友需由仓库所有者在 Settings → Collaborators 添加其 GitHub 用户名。不要共享 GitHub 账号或 API key。

## 按工作内容分工

| 角色 | 常用位置 | 协作约定 |
|---|---|---|
| 产品 | docs/PRD.md、Issue | 增量改需求，写明验收行为 |
| 前端 | demo/、docs/frontend-integration.md | 复用现有接口与业务状态，优先美化体验 |
| 后端 | src/、docs/contracts.md | 接口变化同步契约与 OpenAPI |
| AI/记忆 | src/ai/、services/memory/ | 不伪造事实；说明真实调用与模拟测试区别 |
| 验收 | tests/、Issue | 用明确步骤和预期结果报告问题 |

同一任务一个负责人；需要同时修改同一文件时先在 Issue 说明。多人或多个代理并行工作建议使用各自 clone 或 git worktree，不共享同一个正在切换分支的目录。

## 提交前

- 后端行为变化：`pnpm typecheck`、`pnpm test`；测试需要本机测试数据库，可运行 `pnpm docker:testdb:up`。
- 页面变化：`node --test demo/src/*.test.js`、`pnpm --dir demo build`；交互变化实际走一遍浏览器。
- 集中完成一批相关修改再验证；只对新增变化或失败项补充重测。
- SQL 只添加新迁移，不改已应用的迁移。不要删除数据库卷来“解决”冲突。
- 不提交 `.env.local`、账号凭证、真实采访材料、数据库、日志或个人运行证据。
- 代理开发先读 AGENTS.md 及对应 skills；提交身份按其当前授权执行。

GitHub Actions 配置会执行类型、后端测试及前端构建，不使用真实模型密钥。首轮远端结果以 Actions 页面为准，不能仅凭配置文件存在称为通过。

## main 的保护建议

仓库所有者在 Settings → Rules / Branches 为 main 开启：通过 PR 合并、至少一人批准、要求 `checks` 成功、禁止强推和删除。团队成员用户名尚未明确，所以不预设 CODEOWNERS，不把所有人设为管理员。这些是设置步骤，只有 GitHub 上实际启用后才构成强制保护。

## 遇到冲突

先保存自己的提交，拉取 main，再在自己的分支合并或 rebase。看懂双方变化后逐处解决；不要使用 `reset --hard` 或强推覆盖队友的工作。不确定就请原作者一起看 diff。

## 版本与反馈

用 Issue 模板记录功能和缺陷，PR 关联 `Closes #编号`。达到可演示里程碑后再创建版本标签；不把尚未完成的 OAuth、公网部署或真实用户验证标成已发布能力。
