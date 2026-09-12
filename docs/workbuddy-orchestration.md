# WorkBuddy Orchestration Scheduler

A local development-agent scheduler that drives the installed WorkBuddy CLI over
ACP. It dispatches tasks to named agents, enforces the fixed model / 1M context
contract, keeps durable per-agent state, and audits tool permissions.

Scope: this is **only the scheduler**. It contains no business/product code and
does not modify the root `package.json`, business source, shared databases, or
lockfiles. Pure Node 24 (`node:test` only), no runtime dependencies.

> A git worktree is **not** a security sandbox. The permission rules here block
> explicitly destructive commands and refuse to auto-approve ambiguous ones, but
> they are **not** a complete shell sandbox.

## Delivered files

```
tools/workbuddy/
  cli.cjs                 # CLI entrypoint: doctor/start/resume/status/cancel
  lib/config.cjs          # config resolution + discovery + concurrency guard
  lib/acp-client.cjs      # ACP JSON-RPC client over child stdio
  lib/runner.cjs          # one task lifecycle: new/resume, guards, checkpoint
  lib/scheduler.cjs       # bounded concurrency pool + FIFO queue + per-agent mutex
  lib/locks.cjs           # file locks (PID staleness) + cross-process concurrency gate
  lib/state.cjs           # atomic state store under the gitignored state dir
  lib/policy.cjs          # tool allow/deny/escalate policy + manifest
  lib/redact.cjs          # secret redaction for logs and CLI output
  lib/proxy.cjs           # detect enabled system proxy (read-only, no global change)
  lib/doctor.cjs          # environment + snapshot preflight
  lib/exec.cjs            # process-tree kill, git info, PID liveness
tests/orchestrator/*.test.cjs
docs/workbuddy-orchestration.md
docs/checkpoints/orchestration.md
```

## Prerequisites

- Node.js 24+ (`node --version`).
- WorkBuddy installed (the CLI entry is auto-discovered).
- A `product-resolved.json` snapshot that includes `deepseek-v4.1-flash` with a
  supported `1000000` context window.

## Configuration

Resolution order is CLI flag → environment variable → auto-discovery.

| Setting | Flag | Env | Default |
|---|---|---|---|
| State dir | `--state-dir` | `WORKBUDDY_STATE_DIR` | `<project-root>/.orchestrator` |
| CLI entry | `--cli` | `WORKBUDDY_CLI_PATH` | auto-discovered install path |
| Product snapshot | `--product-config` | `ACC_PRODUCT_CONFIG_PATH` | `<repo-root>/workbuddy-probe-results/acp/product-resolved.json` |
| Proxy | `--proxy` | `WORKBUDDY_PROXY` | detected enabled system proxy |
| Max concurrency | `--max-concurrency` | `WORKBUDDY_MAX_CONCURRENCY` | `2` |
| Concurrency-3 ack | `--verified-concurrency-3` | `WORKBUDDY_CONCURRENCY_VERIFIED=1` | off |

- **State dir** is created on demand and is covered by the root `.gitignore`
  (`.orchestrator/`). Nothing sensitive is written outside it.
- **CLI discovery** checks `%LOCALAPPDATA%\Programs\WorkBuddyAI\resources\app.asar.unpacked\cli\bin\codebuddy`
  and the equivalent Program Files locations.
- **Proxy**: the enabled system HTTP proxy is read (env first, then the Windows
  registry) and injected into the child process env only. Global proxy settings
  are never modified. Per-protocol proxy strings (`http=...;https=...`) are
  rejected rather than guessed.
- **Concurrency**: `--max-concurrency 3` is refused unless explicitly verified
  (`--verified-concurrency-3` or `WORKBUDDY_CONCURRENCY_VERIFIED=1`); values above
  3 are capped at 3.

## CLI usage (copy-paste)

Run from the worktree root. Replace the absolute paths with your own.

### 1. Preflight

```powershell
node tools/workbuddy/cli.cjs doctor
node tools/workbuddy/cli.cjs doctor --json
```

`doctor` checks Node >= 24, `git`, the CLI entry, the product snapshot (model
present and `1000000` supported, version vs the installed `product.json`), a
writable state dir, the proxy, and the permission manifest. It never prints
credentials. Exit code `3` means a hard failure.

### 2. Start a new agent task

```powershell
node tools/workbuddy/cli.cjs start `
  --agent dev-a `
  --task-file D:/AndThen/.worktrees/orchestration/tasks/dev-a.md `
  --cwd D:/AndThen/.worktrees/orchestration `
  --json
```

- `--agent` is the logical agent name (state key).
- `--task-file` is the prompt text sent to the agent.
- `--cwd` is the working directory / git worktree the agent runs in.
- `--task-id` is optional; by default it is a hash of the task file.
- Exit codes: `0` completed, `5` needs_review, `6` violation, `4` locked.

### 3. Resume the same session

```powershell
node tools/workbuddy/cli.cjs resume --agent dev-a --json
```

`resume` requires a recorded `sessionId`; without one it exits `7`
(`E_NO_SESSION`) and never creates a new session. After `session/load` it
re-sets the model and context window and reads them back before prompting.

**Session ↔ worktree binding.** An existing agent is bound to the `--cwd` saved
at first run. `resume` always uses that saved directory, even when launched from
a different shell directory. Passing an explicit `--cwd` that differs is refused
with exit `8` (`E_CONFIG`) unless `--migrate-cwd` is given, which moves the
session to the new worktree and records the migration in the agent audit log.

### 4. Status

```powershell
node tools/workbuddy/cli.cjs status
node tools/workbuddy/cli.cjs status --agent dev-a --json
```

### 5. Cancel

```powershell
node tools/workbuddy/cli.cjs cancel --agent dev-a --json
```

`cancel` terminates the target agent's child process tree (and its runner
process) only, then clears the agent lock. Other agents are unaffected.

### Output

Live output is compact and line-oriented:

- One `TOOL <name> start` line per tool call and one `TOOL <name> <status>` line
  per terminal result (`completed`/`failed`/`error`/`cancelled`). Streaming
  `tool_call_update` events without a status produce no line.
- Tool labels are the short tool name only; titles that embed scripts or secrets
  are summarized and redacted. The full redacted detail is written to the local
  state-dir checkpoint and audit log, never printed.
- Assistant text is streamed as whole lines (token chunks are buffered), not one
  line per chunk.
- `--quiet` suppresses assistant text while keeping tool/status/model/window
  lines; the text is still stored in the redacted local log.

### Global flags

Add any of these to `start`/`resume`:

```powershell
--state-dir D:/AndThen/.worktrees/orchestration/.orchestrator
--cli "C:/Users/Administrator/AppData/Local/Programs/WorkBuddyAI/resources/app.asar.unpacked/cli/bin/codebuddy"
--product-config D:/AndThen/workbuddy-probe-results/acp/product-resolved.json
--max-concurrency 2
--quiet              # suppress streamed assistant text (keep tool/status lines)
--migrate-cwd        # allow moving an existing agent session to a new --cwd
--no-wait            # return immediately if no slot is free instead of waiting
--force-retry        # override the same-task side-effect guard
```

## What the scheduler launches

For each task the runner spawns Node with the CLI entry and these exact ACP
arguments (also visible in `lib/runner.cjs:buildSpawnSpec`):

```
node <cli> --acp \
  --model deepseek-v4.1-flash \
  --permission-mode acceptEdits \
  --allowedTools Read Write Edit Glob Grep Bash PowerShell TodoWrite \
  --disallowedTools Task Agent TeamCreate TeamDelete EnterPlanMode ExitPlanMode Workflow \
  --strict-mcp-config --mcp-config {"mcpServers":{}} --setting-sources "" \
  --autocompact 1000000 \
  --append-system-prompt "<non-delegation, no-network, no-reset rules>"
```

Child env: `CODEBUDDY_SKIP_GIT_BASH_CHECK=1`, `HTTP_PROXY`/`HTTPS_PROXY` when a
proxy is detected, and `ACC_PRODUCT_CONFIG_PATH` when a snapshot is resolved.

## Session contract (enforced before any prompt)

For both `session/new` and `session/load`:

1. `session/set_config_option` `model=deepseek-v4.1-flash` and read it back.
2. `session/set_config_option` `context_window=1000000` and read it back.
3. Only then `session/prompt`.

The real CLI reveals `context_window` only after the model refresh, so the
client sets model first, then context, then verifies both from the returned
`configOptions`.

Runtime violations terminate the agent and mark it `failed`:

- `usage_update.size !== 1000000` → **silent 300K fallback rejected**.
- `codebuddy.ai/requestModelId` / `responseModelId` != fixed model → **model drift rejected**.
- config not confirmed after set → failed.

During `session/load` replay, old events are counted as `replay_event` and are
never emitted as current output and never trigger violations.

## State layout (gitignored)

```
.orchestrator/
  agents/<agent>.json            # name, cwd, branch, git base sha, sessionId, status, checkpoint
  checkpoints/<agent>/<task>.json# outcome, window, usage, tools, violations, git base
  locks/agent-<agent>.lock       # holder pid + child pid + token
  locks/slot-<agent>.lock        # cross-process concurrency slots
  logs/<agent>.log               # redacted text log
  logs/<agent>.audit.jsonl       # tool manifest, permission request/result, violations
  queue.json                     # pending tasks
```

## Concurrency, locking and retries

- **Per-agent/session mutex**: a file lock keyed by agent name. A live holder
  raises `E_LOCKED`; a lock whose PID is dead is reclaimed as stale.
- **Global concurrency**: max 2 by default (3 only after explicit verification).
  Excess tasks wait for a free slot. The wait is event-driven (`fs.watch` on the
  locks dir) with a slow fallback heartbeat, not a fixed long poll.
- **Cancel** kills only the target process tree and clears its lock.
- **Same-task retry guard**: re-running a task id whose previous outcome was
  ambiguous (`needs_review`/`failed`) checks the cwd git state against the
  recorded base sha. If the worktree changed, the retry is blocked and marked
  `needs_review`; a clean tree is allowed to retry.
- **Auto-retry** applies only to read-only initialization / network steps
  (`initialize`, `session/new`, `session/load`), at most 3 attempts. A
  development prompt is **never** replayed automatically.
- A process exit code of `0` is not success: only an explicit
  `codebuddy.ai/outcome === "SUCCESS"` marks a task `completed`.

## Permissions and audit

- `permission-mode=acceptEdits`; `bypassPermissions` is never used.
- Agent-delegation tools (`Task`, `Agent`, `TeamCreate`, `TeamDelete`, plan
  modes) are disallowed.
- Destructive commands (hard git reset, force clean/push, volume deletion,
  disk/network/registry/power changes, pipe-to-shell) are denied **when they
  arrive as a permission request**.
- Ambiguous commands (soft `git reset`, generic `rm`/`Remove-Item`, process
  termination) are escalated: denied in-line and flagged `needsMainControl` for
  the main controller.
- Every tool call, permission request, and permission result is written to the
  agent's `audit.jsonl`.

### Interception is advisory, not a hard block

`Bash` and `PowerShell` are listed in `--allowedTools`, so shell commands may
execute **without** a `session/request_permission` round-trip. The command
regexes above only filter the permission requests the agent chooses to raise.
They are **not** a guaranteed execution interceptor, and it must not be claimed
that every forbidden command is always blocked. This is intentional: the policy
is a guardrail plus an audit trail, not a sandbox, and no system security
configuration is changed to enforce it. `buildToolManifest()` reports
`interception: advisory-only` for this reason.

## Running the tests

```powershell
node --test tests/orchestrator/*.test.cjs
```

Tests use a fake ACP child (`tests/orchestrator/fake-acp-child.cjs`) and cover:
first prompt only after 1M, resume re-set, 300K rejection, model drift
rejection, non-SUCCESS outcome, disconnect/timeout cleanup, same-session mutex,
cross-session concurrency limit, cancel isolation, redaction, stale locks,
"missing session is not recreated", compact streaming output, and resume cwd
binding. Real tool-use and memory acceptance is recorded in
`docs/checkpoints/orchestration.md`.

## Unverified boundaries

- Real end-to-end tool/memory acceptance is run by the main controller through
  this entrypoint. It has been exercised once for real (see the checkpoint); the
  automated suite still uses a fake ACP child.
- The permission policy is not a sandbox and is not a complete execution
  interceptor (see above). It cannot see inside arbitrary child processes the
  agent may spawn.
- Cross-process waiting uses `fs.watch` with a fallback heartbeat; very large
  numbers of simultaneous `start` invocations were not stress-tested.
- `product-resolved.json` is a versioned snapshot; re-run `doctor` after any
  WorkBuddy upgrade.
