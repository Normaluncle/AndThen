# Orchestration Checkpoint

- Branch: `agent/orchestration` (worktree `D:/AndThen/.worktrees/orchestration`)
- Baseline commit (main): `784a68945740c99de8180ee8cbdf1c6e4de90eb0`
- Implementation commit: `b5ac137e24beaac032f1141df47c17fc6655fb4d`
- Scope: WorkBuddy ACP development-agent scheduler only. No business code, no
  root `package.json` / lockfile / shared-DB edits.

## Acceptance results (automated)

Command: `node --test tests/orchestrator/*.test.cjs`

Result at implementation commit: **34 tests, 34 pass, 0 fail** (Node v24.19.0).

Stability: 5 consecutive clean runs after hardening test-only timeouts to 10s.
One earlier run under parallel load flaked on a 2s request timeout; the timeout
was raised in the test helper (not a production code change).

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

## Unverified boundaries

- Real tool-use and cross-process memory acceptance was **not** run here; the
  suite uses a fake ACP child. The main controller is expected to run the real
  acceptance through `tools/workbuddy/cli.cjs`.
- The permission policy is not a sandbox and cannot constrain arbitrary child
  processes an agent may spawn.
- Cross-process concurrency was not stress-tested with many simultaneous
  `start` invocations.
- `product-resolved.json` is a versioned snapshot (root work snapshot,
  `genieVersion 5.5.2`); it is not committed in this worktree. Re-run `doctor`
  after any WorkBuddy upgrade. Doctor compares the snapshot version against the
  installed `product.json` and warns on mismatch.
- Long-context recall after autocompact at 1M was not load-tested.
