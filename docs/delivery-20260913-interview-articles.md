# 2026-09-13 问答后来增量交付

实现范围：保留问题的草稿及公开阅读、五问叙述型提示词、作者小文章输入与无损段落整理、读者三项预设/自定义疑问及按帖语义归类、分享文字链接解析。PRD.md保留全部原章节，仅增加本次要求；frontend-integration.md、contracts.md和OpenAPI同步。

验证：
- pnpm typecheck：通过。
- pnpm test：232通过、1个显式开启的memU真实调用测试跳过，55.62秒。本次未重复整套既有memU真实验收。
- node --test demo/src/*.test.js：10通过。
- pnpm build / pnpm --dir demo build：通过。
- 新增0013迁移在隔离Demo数据库执行成功，未重置任何已有数据。
- /openapi.json成功导出；api/db/worker/memory健康，demo运行。
- 浏览器真实操作：演示读者填写“练习中遇到了哪些转折和困难”，Qwen归入“过程中的转折与经历”；作者工作台显示1人、100%。真实任务succeeded，2082ms，115输入token、8输出token。这不是采访质量评分。
- 浏览器旧烘焙试玩稿v1补回原采访问题成为待确认v2，编辑188字虚构正文、自动分段、保存v3、确认并站内发布；读者看到问题标题与两段正文，通知数由1变2。原故事和历史版本保留，虚构文字明确标识。

边界：五问引导质量仍需真实作者试写反馈，不能用提示词检查宣称稳定产出800–1500字。少于100字的提示/按钮限制是Demo体验，未改变后端发布契约。格式整理不扩写事实。受限官方OAuth能力仍等待凭证；本次未推送GitHub。

已阅读并采用：skills/backend-contracts/SKILL.md、skills/database-migrations/SKILL.md、skills/ai-evaluation/SKILL.md、skills/docker-ops/SKILL.md、skills/git-delivery/SKILL.md。
