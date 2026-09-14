![然后呢？And Then? — 让认真留下的回答，等到它的后来。](assets/design/Visual_Assets_10/03_GitHub社交预览.png)

一个连接旧回答与后续经历的独立网站 Demo：读者关注故事，AI 辅助回访，作者编辑、确认并在本站发布。

[项目企划 · 中文](docs/然后呢_项目企划书.md) · [English Proposal](docs/AndThen_Project_Proposal_EN.md) · [运行 Demo](#运行-demo) · [文档导航](docs/README.md)

## 故事不该停在回答发布的那一天

“我给自己半年时间转行。”

几年后，读者还会找到这篇回答：**后来怎么样了？当时的选择，今天还认同吗？**

「然后呢？」把这份好奇变成一次有边界的回访。作者决定是否参与、谈什么，以及哪些内容可以公开；读者在故事更新时收到站内通知。

## 项目企划与调研

新版[项目企划书](docs/然后呢_项目企划书.md)汇总了产品定位、用户调研、当前进展与版本路线，并提供[英文版](docs/AndThen_Project_Proposal_EN.md)。读者侧 26 份有效问卷中，73.1% 的受访者认可“关注旧帖后续”的价值；这是小样本探索，详见[调研数据汇总](docs/research/调研数据汇总.md)。

## 从一句追问，到一段后来

| 读者关注 | AI 辅助回访 | 作者发布 |
| --- | --- | --- |
| 发现旧回答，留下想了解的方向 | 依据获准使用的材料，一问一答 | 编辑并确认“后来”，通知关注者 |

<details>
<summary>展开三张界面概念稿</summary>

以下为 AI 生成的设计概念稿，人物、故事、日期与社区数字均为示例，不代表当前 Demo 的实际界面。

### 01 · 发现一个还想追问的故事

从搜索或链接导入开始，关注旧回答的后续，也可以补充自己最想了解的方向。

![发现页概念稿，社区数字与故事为设计示例](assets/design/Visual_Assets_10/05_发现页真实截图风格.png)

### 02 · 让作者讲述这些年的变化

作者接受回访后，AI 根据允许使用的材料辅助提问。最多五问，一问一答，把经历和转折留给作者自己讲述。

![AI 回访概念稿，不是当前运行截图](assets/design/Visual_Assets_10/06_AI回访截图风格.png)

### 03 · 等到故事的后来

作者编辑并确认内容后，在本站发布新的“后来”，关注者收到更新。

![后来阅读页概念稿，图内真实回访及作者声明均为虚构设计文案](assets/design/Visual_Assets_10/07_后来成品截图风格.png)

</details>

## AI 如何帮助这次回访

- **准备有依据的问题**：结合允许使用的原始材料与作者记忆，同时遵守拒谈偏好。
- **理解读者的好奇**：汇总关注方向，对自定义疑问进行语义归类。
- **保留作者的表达**：辅助采访与整理，公开内容始终经过作者确认。

## 项目状态

当前为功能 Demo，包含读者关注、作者回访、草稿确认、站内发布与通知。已验证范围及未完成事项见[验收矩阵](docs/acceptance-matrix.md)与[本地验收记录](docs/release-acceptance-20260914.md)。

本项目独立开发，不是知乎官方产品；不自动向知乎发文或私信，发布发生在本站。真实作者参与和内容使用需要各自授权，示例材料须标记为虚构。

## 运行 Demo

需要 Git、Docker 与 Docker Compose。首次构建需要能访问镜像和依赖源。

```bash
git clone https://github.com/Normaluncle/AndThen.git
cd AndThen
cp .env.example .env.local
```

Windows PowerShell 也可使用 `Copy-Item .env.example .env.local`。

在 `.env.local` 配置自己的服务凭证，详见[团队启动说明](docs/team-quickstart.md)。

```bash
docker compose --env-file .env.local -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml up -d --build
```

打开 [本地 Demo](http://127.0.0.1:5174) 或[本地接口说明](http://127.0.0.1:8082/docs)。试玩材料和账号切换方式见[启动说明](docs/team-quickstart.md)。

未配置模型或官方凭证时，相应能力不可用。本地试玩登录仅用于本机；公网部署前需要另行配置。

## 继续了解

| 你想了解什么 | 从这里开始 |
|---|---|
| 产品定位、调研与路线 | [中文企划](docs/然后呢_项目企划书.md) · [English](docs/AndThen_Project_Proposal_EN.md) |
| 详细需求与功能边界 | [PRD](docs/PRD.md) · [验收矩阵](docs/acceptance-matrix.md) |
| 15 张前端参考图与 10 张视觉素材 | [完整素材索引](assets/design/README.md) |
| 前端开发与接口 | [前端接入](docs/frontend-integration.md) · [OpenAPI](docs/openapi.json) |
| 后端结构与技术方案 | [后端说明](BACKEND.md) · [架构](docs/architecture.md) |
| 参与项目协作 | [贡献与协作约定](CONTRIBUTING.md) |

技术栈：Node.js 24 / TypeScript / Fastify 5 / PostgreSQL 18 / Drizzle / React / Vite / memU。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| [`demo/`](demo/) | React 前端与页面资源 |
| [`src/`](src/) | API、业务模块、任务队列与数据库迁移 |
| [`services/`](services/) | Python memU 记忆服务 |
| [`docs/`](docs/README.md) | 项目企划、调研、接口与验收记录 |
| [`assets/`](assets/README.md) | 设计参考、插画原图与封面素材清单 |
| [`tests/`](tests/) · [`scripts/`](scripts/) | 自动化验证与开发脚本 |

## 许可与内容归属

项目采用[保留所有权利与团队开发授权](LICENSE)。公开仓库不等于授予修改、再分发或商用许可；第三方依赖与内容遵循各自许可。

**读者问一句「然后呢？」 · 作者留下自己的「后来」。**
