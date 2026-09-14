# 前后端收尾任务

- [x] T1 核对 origin 与当前工作区，记录非前端改动和 PRD 契约差异。
- [x] T2 解压 150 条图库清单，校验来源，建立全量分类/标签映射。
- [x] T3 在现有 AI-A 分析流程增加可溯源封面短句和主题字段，增量存储。
- [x] T4 将图库匹配与封面字段贯通导入、公开故事、关注、工作台；不修改页面布局。
- [x] T5 审计其他前端接口缺口，接入已有后端能力并列明外部阻塞。
- [x] T6 运行测试、迁移、更新现有预览并验证。

资料现状：压缩包只有清单，150 条中 18 条候选 Pexels 页面链接、132 条待补位，没有位图文件。

## 仓库差异核对

2026-09-14 GitHub API `/repos/Normaluncle/AndThen/commits/main` 实时返回 `a0db65e54897c09437fc2904fcd0426a6b4666a2`。git fetch 两次因网络失败；API 成功核实与本地 origin/main 同一 SHA，未把缓存当作最新。

当前 HEAD `847e596` 比 main 多两条前端提交：`cdace3f` 与 `847e596`。此外，任务开始前的未提交工作区已包含 community 模块（评论/收藏/点赞/举报/反馈）、0014/0015 迁移、搜索筛选/游客搜索、通知投影、读者活动删除扩展及相应测试。并非只有前端改动。

本轮新增 0016 图库与 0017 浏览历史，扩展 AI-A 可选展示字段和 DTO/数据绑定。没有改 app/worker 基础注册机制、身份模块、访谈生成流程、memU 服务、Compose 拓扑或旧迁移。

## 前端功能与后端支持

| 功能 | 结论 |
| --- | --- |
| 分类、配图、短句 | 本轮补充后端字段与自动分析/关键词匹配；150 条目录已入迁移，图片文件缺失是素材阻塞。 |
| 关注/收藏/点赞/评论/反馈 | 上轮已有接口，本轮补充列表的真实互动数与封面 DTO。 |
| 浏览历史 | 原来只记设计示例；本轮新增登录账号数据库记录与列表读取。 |
| 搜索候选 | 复用官方接口与本站查询；本轮补充非 AI 的本地分类匹配。 |
| OAuth 资料 | 后端存在；运行环境回调安全核验未完成，不能把开发者 Secret 当用户身份。 |
| memU 结构化资料 | 已有接口，依赖作者核验及独立同意；不造用户画像，不将其私有记忆当公开封面短句。 |
| @提及专用通知 | 目前仅文本提及，无通知投递协议；本轮未扩展消息产品范围。 |
| 设计稿展示内容 | 保留虚构示例模式，不能冒充已存数据库的真实资料。 |

## 素材阻塞

ZIP 含 CSV/JSON/说明，没有任何 JPG/PNG/WebP。18 条只有 Pexels 页面链接，其余 132 条待补。对提供的首个链接及其明确下载链接尝试下载均返回 HTTP 403；未绕过限制。所有 150 条保留稳定编号和分类，状态为 pending_asset。拿到实际图片后可用安装脚本激活，当前没有声称已安装 150 张图片。

## 最终验证与交付

- `pnpm typecheck` 通过。
- `pnpm test`：243 通过，1 跳过（外部 memU live 检查）；AI-A 模拟 HTTP 模型测试证明授权触发队列、短句校验及公开 DTO 全链路，未冒称本轮已运行真实模型。
- `pnpm test:integration`：182 通过，1 跳过。
- `node --test demo/src/*.test.js demo/src/design/*.test.js`：49 通过。
- `pnpm --dir demo build` 成功；没有修改 CSS 或页面骨架。
- 现有 andthen-v12-demo 应用 0016/0017 后已重建 API/worker/demo；API、worker、db、memory 健康。
- 实际 HTTP：`/api/covers` 返回 150 条，ready=0；`/api/stories` 返回真实分类、稳定 CF 编号、pending_asset 和本站统计；OpenAPI 3.1.0 包含 covers/history。
- 浏览器：游客原布局保留；演示读者关注中“转行”归职场发展、“烘焙”归家庭生活；读取烘焙后来后，在浏览历史看到数据库返回的原故事。身份、关注状态和原标题均来自已有账号/材料。

本轮主要文件：sources/presentation-schema.ts、presentation.ts、analysis.ts、service.ts、routes.ts；ai/tasks.ts、prompts.ts；community/counts.ts、index.ts；workbench/index.ts、zhihu/index.ts；schema/0016/0017；前端 StoryCover、Following、Connected、ConnectedSaved、workbench-card、SourceMaterials 的数据绑定；assets/cover-library-150、scripts/install-cover-images.mjs；相应测试及 docs/contracts.md。

技能已读：skills/backend-contracts/SKILL.md、skills/database-migrations/SKILL.md、skills/ai-evaluation/SKILL.md、skills/docker-ops/SKILL.md、skills/git-delivery/SKILL.md，以及 web-development 工程规范。沿用已读取的 computer-use 浏览器规则。

未创建提交；当前 HEAD 仍为 847e596。待补：实际图片文件；OAuth 回调核验仍为已有外部配置阻塞。上述任务勾选表示代码/映射/验证完成，不表示缺失图片已获取。
