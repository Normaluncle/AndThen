# Implementation plan

This file preserves the original foundation handoff and work allocation. It is
not the current progress report: all five business modules are now implemented.
See acceptance-matrix.md for current P0–P5 gates and docker-acceptance.md for
measured local runtime evidence. WorkBuddy quota failure led to user-authorized
Codex takeover; independent real-model evaluation still requires credentials.

## 1. Status of this commit (foundation)

Delivered and verified:

| Area | State |
|---|---|
| Git repo, `.gitignore`, preserved probe docs | done |
| Agent docs + 5 project skills | done |
| package.json + `pnpm-lock.yaml` (pinned), tsconfig, vitest | done |
| Env schema, app factory, server entry, worker entry | done |
| HTTP auth middleware, error taxonomy, request_id, envelopes, OpenAPI | done |
| Drizzle schema (22 tables) + SQL migration + single migrate command | done |
| Identity module: users, sessions, login-token exchange, logout, me | done |
| Admin bootstrap CLI (one-time token, never logged) | done |
| Job queue: SKIP LOCKED claim, lease, fencing, retries, dedupe | done |
| Outbox with frozen recipients, idempotency ledger, worker heartbeats | done |
| OpenAI-compatible LLM client + frozen AI-A/B/C/D output contracts | done |
| Dockerfile (multi-stage, Node 24) + compose (db/migrate/api/worker) | done |
| Tests: auth isolation, migrations, job lease + stale rejection | done (37 passing) |

Reserved (registration slots only, no behaviour): `sources`, `cases`,
`interviews`, `followups`, `research`.

## 2. Worktree assignment for business modules

Each module gets its own worktree and owns its routes, services, job handlers and
tests. All of them depend only on the frozen contracts in `docs/contracts.md`.

| Module | Owns (PRD) | Depends on | Emits jobs |
|---|---|---|---|
| `sources` | FR-01, FR-02, FR-03 (§7) | db, identity | `ai.extract` |
| `cases` | FR-07..FR-11 (§9, §10) | sources, identity | — |
| `interviews` | FR-12..FR-16 (§11) | cases, ai | `ai.interview.next` |
| `followups` | FR-17..FR-20 (§12) | interviews, ai, outbox | `followup.notify`, deletion |
| `research` | FR-05 counts, §20/§21, admin surface | all (read-only) | — |

Recommended order: `sources` → `cases` → `interviews` → `followups` → `research`.
`interviews` can start in parallel once `cases` freezes its case-state helpers,
because it only needs `case_id` + ownership checks.

## 3. Per-module acceptance (P0 traceability)

| FR | Module | Endpoint(s) | Core tests (PRD §22.1) |
|---|---|---|---|
| FR-01 | sources | `POST /sources`, `GET /sources/:id` | T01, T02, T19 |
| FR-02 | sources | snapshot fields in `GET /stories/:id` | T01, T02, T12 |
| FR-03 | sources | degrade path + provenance | T16, T19 |
| FR-04 | cases | `PUT /stories/:id/interest`, `GET /me/following` | T04, T05 |
| FR-05 | research | excluded cohorts, counts | T05, T20 |
| FR-06 | followups | `GET /me/notifications` | T14, T15 |
| FR-07 | cases | `POST /sources/:id/analyze` + gating | T03, T08 |
| FR-08 | cases | deterministic ordering | T02, T03, T07 |
| FR-09 | cases | hold/excluded, one invitation per author | T07, T08 |
| FR-10 | cases | `POST /cases/:id/invitations` | T06, T07 |
| FR-11 | cases | `POST /cases/:id/decision` | T06, T07 |
| FR-12 | interviews | pre-interview confirmations | T06, T08 |
| FR-13 | interviews | `POST /cases/:id/interviews`, first question | T09, T12 |
| FR-14 | interviews | `POST /interviews/:id/messages` branching | T09, T11 |
| FR-15 | interviews | save-before-ask, timeout → manual form | T10, T17, T18 |
| FR-16 | interviews | `POST /interviews/:id/finish` → draft | T10, T12 |
| FR-17 | followups | `PATCH /drafts/:id`, `POST /drafts/:id/confirm` | T12, T13 |
| FR-18 | followups | `POST /drafts/:id/publish` | T06, T13, T21 |
| FR-19 | followups | publish → P02/P03/P07 + notifications | T14, T22 |
| FR-20 | followups | `POST /followups/:id/withdraw`, `POST /me/data-deletion` | T13, T15, T21 |

## 4. What the foundation already gives each module

- **Auth + roles**: `app.authenticate`, `app.requireRole`, `requireAuthContext`.
- **Ownership checks**: `request.auth.userId` is the only trusted identity.
- **Async work**: `ctx.jobs.enqueue(...)` + `registerJobHandlers`.
- **Serialization**: `dedupeKey` (partial unique index) — use
  `interviewGenerateDedupeKey(sessionId)` for interviews.
- **Fan-out**: `outbox` with frozen recipients and `(topic, dedupe_key)` uniqueness.
- **Retry safety**: `idempotency_keys` + `client_message_id`.
- **Model access**: `createLlmClient(ctx.env, ctx.logger)` and the zod output
  schemas; validate every model response before persisting.
- **Evidence trail**: `audit_logs`, `research_events`, `ai_runs`.

## 5. Required evidence for a module to be "done"

1. `pnpm typecheck` and `pnpm test` green; integration tests added for the
   module's DB paths.
2. Routes registered through the module registry (no `app.ts` edits).
3. OpenAPI document includes the new routes with request/response schemas.
4. Author-facing side effects (publish, withdraw, delete, invitation) write an
   `audit_logs` row.
5. The module's PRD test IDs (§22.1) are covered or explicitly listed as blocked
   with a reason.
6. Delivery report: skills read, files changed, commands + observed results,
   blockers. No claim of "verified" without a recorded run.

## 6. Explicit deferrals

- No P1 features (share images, hot-list hints, personal history scan, batch
  ranking) and no P2 features (voice, matching, RAG, fine-tuning).
- No third-party platform adapter in this phase; `sources` starts from
  author-paste / researcher-import with `provenance = 'test_fixture'` for demos.
- Real authorized sources and real author contact are a research-ops task, not an
  engineering deliverable of the foundation.
