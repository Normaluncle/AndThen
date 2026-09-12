# Orchestration Checkpoint

- Branch: `agent/orchestration` (worktree `D:/AndThen/.worktrees/orchestration`)
- Baseline commit (main): `784a68945740c99de8180ee8cbdf1c6e4de90eb0`
- Implementation commit: `b5ac137e24beaac032f1141df47c17fc6655fb4d`
- Scope: WorkBuddy ACP development-agent scheduler only. No business code, no
  root `package.json` / lockfile / shared-DB edits.

## Real acceptance (not a fake-child test)

The scheduler was exercised for real through `tools/workbuddy/cli.cjs` against
the installed WorkBuddy CLI:

- Agent `scheduler-smoke`, session `0cc2a4c0-0e65-4507-bfe8-8f4f69692e25`.
- `start`: the agent really used `Read` / `Write` / `PowerShell` and asserted a
  written file's contents (`ASSERT_OK`); both runs reported `READY ... 1M` and
  `outcome=SUCCESS` at window `1000000`.
- `resume`: after the process exited, a resume with no file reads correctly
  returned the continuity marker `ANDTHEN-CONTINUITY-84619`, confirming the
  session survived the process boundary.
- Evidence (read-only): `D:/AndThen/.orchestrator/managed/checkpoints/scheduler-smoke/`
  and `D:/AndThen/.orchestrator/managed/agents/scheduler-smoke.json`
  (new: `used=24041`, `replayedEvents=0`; resume: `used=23732`,
  `replayedEvents=21`).

This is a real acceptance, not only the automated fake-ACP suite below.

## Acceptance results (automated)

Command: `node --test tests/orchestrator/*.test.cjs`

Result after the second pass (streaming + cwd binding): **38 tests, 38 pass,
0 fail**. The original implementation commit had 34/34 (Node v24.19.0).

Stability: after hardening test-only timeouts to 10s and fixing a
violation/transport error-code race, the suite passed 6/6 consecutive full runs
(34/34) plus 8/8 isolated `acp-guards` stress runs. Two earlier flakes (a 2s
request timeout under parallel load, and the error-code race) were fixed; both
were test-harness or determinism issues, not relaxed assertions.

Covered behaviours:

| Requirement | Test |
|---|---|
| Model + 1M set and read back before the first prompt | `acp-guards` confirms ordering and `context_window=1000000` |
| Resume re-sets model/context after `session/load` | `acp-guards` resume re-set; no `session/new` |
| Replayed load events are not treated as current output | `acp-guards` replay ignored; checkpoint `replayedEvents>=2` |
| Silent 300K fallback rejected | `acp-guards` `context_window_mismatch` → failed |
| Model drift rejected | `acp-guards` `model_drift` → failed |
| Process exit 0 != success | `acp-guards` non-SUCCESS outcome → `needs_review` |
| Resume without sessionId refused, no child spawned | `acp-guards` `E_NO_SESSION`, no fake log file |
| Failed `session/load` does not recreate session | `acp-guards` `E_RESUME_FAILED`, no `session/new` |
| Disconnect cleanup (lock released, failed) | `lifecycle` disconnect |
| Timeout cleanup (child killed, lock released) | `lifecycle` hang + prompt timeout |
| Redaction of secrets in logs | `lifecycle` stderr secret; `policy-config` unit |
| Forbidden permission denied + audited | `lifecycle` `permission_forbidden` |
| Ordinary permission allowed + audited | `lifecycle` `permission_allowed` |
| Same-agent/session mutex | `scheduler` mutex test |
| Global concurrency limit + queueing (event-based) | `scheduler` 3 tasks, max 2 |
| Cancel only the target agent | `scheduler` cancel isolation |
| Stale lock reclamation by dead PID | `locks` stale + gate stale slot |
| Live lock refuses acquisition | `locks` live PID `E_LOCKED` |
| Concurrency gate caps + wakes waiters | `locks` gate |
| Config pins model/1M/concurrency guard | `policy-config` |
| Doctor validates CLI + product snapshot | `policy-config`, `cli` |
| CLI start/resume/status/cancel/doctor end to end | `cli` (fake ACP child) |
| Same-task retry guard (side effects → needs_review) | `cli` blocked + allowed cases |
| Compact streaming output (no `TOOL_RESULT undefined`, line-buffered text) | `streaming` stream mode |
| Quiet mode suppresses text but keeps tool/status lines | `streaming` quiet |
| Resume uses saved worktree cwd, not shell cwd | `cli` different-shell-cwd test |
| Conflicting `--cwd` refused; `--migrate-cwd` moves the session | `cli` cwd binding test |

## Follow-up fixes (second pass)

- Streaming output: one line per tool start and per terminal tool result; ignore
  status-less `tool_call_update` events; buffer assistant chunks into whole
  lines; `--quiet` for status-only output. Tool titles are summarized to the
  tool name; the full redacted detail is stored in the local checkpoint/audit
  only, never printed.
- Resume cwd binding: an existing agent resumes in its saved worktree; a
  conflicting explicit `--cwd` is refused (`E_CONFIG`) unless `--migrate-cwd` is
  passed. Covered by a test that resumes from a different shell directory.
- Permission policy clarified as advisory: `Bash`/`PowerShell` are pre-approved,
  so the command regexes only filter permission requests the agent raises and
  must not be described as guaranteed execution blocking. No system security
  configuration was changed.

## Design decisions recorded

- The real CLI only reveals `context_window` **after** the model refresh, so the
  runner sets `model` first, then `context_window`, then verifies both from the
  returned `configOptions` before prompting.
- Only explicit `codebuddy.ai/outcome === "SUCCESS"` yields `completed`;
  everything else is `needs_review`.
- Auto-retry is limited to read-only init/network steps (`initialize`,
  `session/new`, `session/load`), max 3; the development prompt is never
  auto-replayed.
- `--max-concurrency 3` requires explicit verification; values > 3 are capped.
- Cross-process waiting uses `fs.watch` on the locks dir with a slow fallback
  heartbeat (no fixed long poll).
- A runtime violation terminates the child, which can surface as a transport
  error (`E_DISCONNECT`). The runner normalizes the reported error code to
  `E_VIOLATION`, so cancellation timing cannot change the outcome. This was a
  real race found by repeated test runs and is now covered by the stress runs
  below.

## Unverified boundaries

- Real tool-use and cross-process memory were exercised once (see above); the
  automated suite still uses a fake ACP child and does not re-run the real model.
- The permission policy is not a sandbox and is not a complete execution
  interceptor: pre-approved `Bash`/`PowerShell` can run without a permission
  round-trip, so forbidden-command regexes are not a guaranteed block. It cannot
  constrain arbitrary child processes an agent may spawn.
- Cross-process concurrency was not stress-tested with many simultaneous
  `start` invocations.
- `product-resolved.json` is a versioned snapshot (root work snapshot,
  `genieVersion 5.5.2`); it is not committed in this worktree. Re-run `doctor`
  after any WorkBuddy upgrade. Doctor compares the snapshot version against the
  installed `product.json` and warns on mismatch.
- Long-context recall after autocompact at 1M was not load-tested.
