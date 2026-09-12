# AndThen（然后呢？）项目仓库

本仓库包含两部分内容。

## 1. 后端工程（当前主线）

纯后端：Node 24 · TypeScript · Fastify 5 · Postgres 18 · Drizzle · Vitest ·
OpenAPI。不依赖任何第三方平台 API，不做前端。

| 文档 | 内容 |
|---|---|
| [BACKEND.md](BACKEND.md) | 入口：快速开始、脚本、环境变量、HTTP 路由、Docker、测试 |
| [AGENTS.md](AGENTS.md) | 开发代理工作约定（必读）：模块契约、如何加路由/任务处理器 |
| [docs/architecture.md](docs/architecture.md) | 架构：请求生命周期、认证、任务队列语义、数据模型 |
| [docs/contracts.md](docs/contracts.md) | 冻结接口契约：响应封装、错误码、模块/任务/AI/数据库契约 |
| [docs/implementation-plan.md](docs/implementation-plan.md) | 实施计划、模块分工、PRD 需求与测试覆盖映射 |
| [docs/checkpoints/foundation.md](docs/checkpoints/foundation.md) | 基础设施检查点：证据、导出签名、阻塞项 |
| [skills/](skills/) | 五个项目技能：backend-contracts / database-migrations / ai-evaluation / docker-ops / git-delivery |

当前状态：业务模块已实现，包含来源、采访、发布通知、删除和研究导出。完整验收仍在进行；请以 [验收矩阵](docs/acceptance-matrix.md) 和 [最新检查点](docs/checkpoints/codex-takeover.md) 为准。前端接入见 [接入指南](docs/frontend-integration.md)。下方 WorkBuddy 探针属于历史证据，不代表当前配额或运行状态。

---

## 附：Codex 调用 WorkBuddy 探针（历史验证记录，原文保留）

# Codex 调用 WorkBuddy：实测结果与使用方法

验证日期：2026-09-12。环境为 Windows、WorkBuddy AI 5.5.2，使用安装包内置 CodeBuddy CLI。请求参数和响应元数据中的模型均为 `deepseek-v4.1-flash`。

## 已验证的结果

| 项目 | 结果 | 证据与范围 |
|---|---|---|
| CLI 连通性 | 成功 | 无需重新登录或手动复制凭据，返回正确测试标记和算术结果 |
| 两个 agent 并发 | 成功 | 两个独立 CLI 进程、不同会话 ID，启动相隔 9 毫秒，运行重叠 6.694 秒 |
| 自动接收结果 | 成功 | CLI 使用 `stream-json`；ACP 使用事件流和完成响应，不依赖截图或固定十分钟轮询 |
| 跨进程会话记忆 | 成功 | 原进程退出后，新进程恢复同一会话，准确复述随机标记；独立新会话回答 `UNKNOWN` |
| 实际消耗 | 已核实的六次 CLI 调用均为 0 | 用户提供的账户账单截图确认；不覆盖后续 ACP 请求，也不能推出永久免费或无限并发 |
| 300K 上下文设置 | 成功 | ACP 读回 `300000`，用量事件窗口为 `300000`，短对话成功 |
| 1M 上下文设置 | 成功 | ACP 读回 `1000000`，用量事件窗口为 `1000000`，短对话成功 |

因此可以由 Codex 分派任务，经本地 CLI / ACP 调用 WorkBuddy，接收输出后检查和整合。当前文件是验证脚本，尚未实现完整的任务队列、生产级 MCP 服务或开发任务隔离。

## 使用方法

在 PowerShell 中进入本目录，使用统一入口：

```powershell
Set-Location D:\AndThen

# 单次连通性测试
.\Run-WorkBuddyProbe.ps1 single

# 两个独立 agent 并发测试
.\Run-WorkBuddyProbe.ps1 parallel

# 跨进程会话记忆测试，含独立会话对照
.\Run-WorkBuddyProbe.ps1 memory

# 验证 300K 和 1M 两档上下文
.\Run-WorkBuddyProbe.ps1 context

# 只验证指定档位
.\Run-WorkBuddyProbe.ps1 context -ContextWindow 300000
.\Run-WorkBuddyProbe.ps1 context -ContextWindow 1000000
```

这些命令会实际发起模型请求。重复运行会覆盖同名结果文件；记忆测试另建带时间戳的工作目录。依赖本机 Node.js、现有 WorkBuddy 安装和登录状态。

## TLS 与代理

首次未设置代理环境变量的 CLI 调用出现 TLS 握手错误；显式使用本机系统代理 `http://127.0.0.1:7897` 后成功。六次基础测试在设置代理后均成功，但短样本不保证未来没有网络故障。

统一入口读取当前启用的 Windows 系统代理，为测试子进程设置 `HTTP_PROXY` 和 `HTTPS_PROXY`，结束后恢复原环境变量。它没有修改系统代理，也没有关闭证书校验。当前仅处理单一代理地址，代理未启用或为复杂分协议格式时会报错。

CLI 退出码为 `0` 也可能返回 `result/error_during_execution`。主控应检查业务完成状态；有文件修改等副作用的任务不能盲目重试。

## 会话记忆与多 agent

初始连通性脚本使用 `--no-session-persistence`，主动关闭会话保存。持续协作时需去掉该参数，保存结果中的 `session_id`，后续使用 `--resume <session_id>`。

每个 agent 应分别保存自己的会话 ID 和工作目录，同一会话串行续接。不要用全局 `--continue` 路由多个并发 agent。

已验证的是同一会话跨进程恢复，不是所有会话共享记忆。长期保存、应用升级后的恢复、超长对话压缩后的召回效果尚未验证。上下文档位的跨进程持久性也未验证，恢复后应重新设置并读回。

## 费用的正确判定

用户账单截图确认以下六次 CLI 请求实际消耗均为 0（北京时间）：15:33:20、15:33:36 两次、15:40:59、15:41:06 两次。截图中的模型为 `deepseek-v4.1-flash`，客户端为 `CLI`。

进一步检查发现内置 CLI 的结果构造代码将 `total_cost_usd` 直接写为 `0`，因此这个字段不能单独证明免费。应以账户账单为依据；后续 ACP 调用未在该截图中核账。

## 300K / 1M 的设置方法

桌面端模型元数据声明默认预算为 `300000`，支持 `[300000, 1000000]`，`maxInputTokens` 为 `1000000`。

通过 ACP 方法 `session/set_config_option` 设置：

```json
{
  "sessionId": "目标会话ID",
  "configId": "context_window",
  "value": "1000000"
}
```

300K 使用字符串 `"300000"`。验证时读回 `configOptions` 中的 `context_window.currentValue`，并检查 `usage_update.size`；不能让模型自行声称窗口大小来代替验证。

当前直接启动 CLI 暴露的初始模型目录不完整。测试将从桌面日志提取的 DeepSeek 元数据合并到安装包产品配置的本地副本，通过子进程 `ACC_PRODUCT_CONFIG_PATH` 加载；首次请求后刷新模型配置，再设置上下文。该副本位于 `workbuddy-probe-results/acp/product-resolved.json`，未修改安装目录或桌面设置。它是版本相关快照，应用升级后需要重新核对。

`--autocompact 300k` / `--autocompact 1m` 控制自动压缩窗口，与上述上下文档位不同。源码会结合实际模型预算及触发比例计算压缩时机，不能把该参数当成模型上下文扩容。

两档均已重复验证设置成功和短对话成功，但没有填入 1M token 做容量或长文本召回压力测试。

## 文件与证据

| 文件 | 用途 |
|---|---|
| [Run-WorkBuddyProbe.ps1](Run-WorkBuddyProbe.ps1) | 统一入口及代理处理 |
| [workbuddy-cli-probe.cjs](workbuddy-cli-probe.cjs) | 单次及并发调用 |
| [workbuddy-memory-probe.cjs](workbuddy-memory-probe.cjs) | 持久会话恢复和对照测试 |
| [workbuddy-acp-probe.cjs](workbuddy-acp-probe.cjs) | ACP 连接与上下文设置 |
| [详细测试记录](workbuddy-probe-results/README.md) | 耗时、调用细节及限制 |
| [记忆测试结果](workbuddy-probe-results/memory-summary.json) | 恢复与独立会话对照 |
| [上下文测试摘要](workbuddy-probe-results/acp/summary.json) | 两档读回值、用量窗口和完成状态 |
| [ACP 原始事件](workbuddy-probe-results/acp/events.json) | 完整协议响应 |

本次没有验证内置 Team/Swarm 模式、最大并发数、服务端推理调度或复杂开发任务。纯文本测试中没有观察到工具调用；虽然传入 `--tools` 空字符串，初始化元数据仍列出工具全集，因此不能把这些脚本视为经过验证的权限沙箱。
