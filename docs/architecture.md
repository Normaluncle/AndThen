# Architecture

Scope: the foundation delivered in this commit (identity + database + jobs).
Business modules (sources, cases, interviews, followups, research) are reserved
slots that plug into the contracts described here.

## 1. Runtime topology

```
                    ┌──────────────────────────────────────┐
   HTTP clients ───▶│ api        node dist/server.js       │
                    │  Fastify 5 · /api/* · /docs          │
                    └───────────────┬──────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────┐
                    │ Postgres 18 (named volume, no LAN)   │
                    │  22 tables · Drizzle schema          │
                    └───────────────▲──────────────────────┘
                                    │
                    ┌───────────────┴──────────────────────┐
                    │ worker     node dist/worker.js       │
                    │  claim → handle → complete/fail      │
                    └──────────────────────────────────────┘
```

`api` and `worker` are the **same image**, different commands. `migrate` is a
one-shot service that runs `node dist/db/migrate.js` before either starts.

## 2. Request lifecycle (HTTP)

1. `genReqId` honours an inbound `x-request-id` or mints a UUID → `request.id`.
2. `helmet` sets security headers (CSP disabled only for the docs UI).
3. The route's zod schema validates body/params/query; failures become
   `validation_error` with per-field issues.
4. `app.authenticate` (preHandler) resolves `Authorization: Bearer <token>`:
   hash the token, look up a live session joined to a live user, attach
   `request.auth = { userId, role, cohort, sessionId, expiresAt }`.
5. `app.requireRole(...)` gates role-specific routes.
6. The handler returns `success(request.id, payload)`; the response serializer
   validates it against the declared schema and strips unknown fields.
7. `onSend` echoes `x-request-id`.

Errors are converted by a single error handler into the PRD envelope
(`request_id`, `status`, `error_code`, `message`). Vendor/provider errors are
never passed through verbatim.

**Ordering constraint:** `setErrorHandler`/`setNotFoundHandler` are installed
before any `app.register(...)`. Fastify child contexts capture the parent's
error handler at creation time; installing it later leaves plugin routes with
Fastify's default error shape.

## 3. Authentication model

- Credential: an opaque 256-bit random token (base64url). **Not a JWT** — nothing
  is client-decodable.
- Storage: only `sha256(token)` in `sessions.token_hash`. A non-secret
  `token_prefix` exists purely for operator display.
- Establishment: the bootstrap CLI (or an invitation flow) mints a **single-use**
  `login_tokens` row. `POST /api/auth/sessions` exchanges it for a session inside
  one transaction with `SELECT ... FOR UPDATE`, so a token cannot be redeemed
  twice under concurrency.
- Roles come from `users.role` only. The exchange body schema is `.strict()`, so
  a client sending `role` is rejected outright; changing the DB role takes effect
  on the next request with the same token (proven in
  `tests/integration/auth.test.ts`).
- Logout revokes one session; `revokeAllSessions` exists for incident response.

## 4. Job queue semantics

The queue is the correctness core, so its invariants are explicit:

| Concern | Mechanism |
|---|---|
| No double-claim | `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` |
| Short transaction | Claim is one statement; the handler runs outside any transaction |
| Crash recovery | `lease_expires_at`; `reclaimExpired()` returns expired `running` jobs to `queued` |
| Stale-result rejection | Every claim increments `fencing_token`; `complete`/`fail`/`heartbeat` require `id + fencing_token + status='running'` |
| Bounded retries | `attempts` vs `max_attempts`; retryable failures requeue with `2^attempts` backoff (capped 300s), otherwise dead-letter to `failed` |
| Serialization | `dedupe_key` has a **partial unique index over active jobs** (`queued`,`running`) |
| Observability | `worker_heartbeats` upserted each loop tick; `countByStatus()` |

A worker whose lease was reclaimed cannot commit: its `fencing_token` no longer
matches, the update affects 0 rows, and the worker logs "stale job result
rejected". This is asserted directly in `tests/integration/jobs.test.ts`.

Interview generation uses `interviewGenerateDedupeKey(sessionId)` →
`interview:<sessionId>:generate`, so one interview has at most one in-flight
generation.

## 5. Side effects: transactional outbox

Notification fan-out does not happen inline. A publish writes an `outbox` row
with:

- `(topic, dedupe_key)` unique — a retried publish never double-notifies;
- `recipients` **frozen** at enqueue time — a later interest cancellation cannot
  retroactively change who receives an update.

Outbox rows share the same lease/fencing columns as `jobs`.

## 6. Idempotency

`idempotency_keys` is a generic ledger (`scope`, `key`, `request_hash`,
`response_status`, `response_body`, `expires_at`) for write endpoints that accept
`Idempotency-Key`. Interview messages carry their own
`client_message_id`, unique per session when present.

## 7. Data model

22 tables. The PRD §15.1 logical entities map 1:1 onto physical tables; see
`docs/contracts.md` §6 for the full map and the foundation-only additions
(`sessions`, `login_tokens`, `jobs`, `outbox`, `idempotency_keys`,
`worker_heartbeats`).

Deliberate modelling decisions:

- **History vs. now are separate columns.** `sources` has no timestamps of its
  own for the material; `source_snapshots` carries `published_at` (upstream
  original) and `acquired_at` (when we captured it) as independent fields. A
  snapshot never overwrites a previous one — `(source_id, version)` is unique.
- **Material level is explicit.** Only `exact_excerpt` may ever be rendered as a
  verbatim quote; `api_summary` / `ai_summary` cannot masquerade as one.
- **Business state ≠ execution state.** `followup_cases.status` is the PRD state
  machine; `jobs.status` / `ai_runs.status` are `queued|running|succeeded|failed|cancelled`.
  A model failure can never move a case to `declined`.
- **Authenticity is layered.** Author linkage (`author_verifications`), author
  confirmation (`followup_versions.author_confirmations` + `confirmed_at`) and
  external evidence are stored separately. Nothing auto-upgrades to
  "independently verified".
- **`followup_cases.published_version_id`** is a plain `uuid`, not a DB-level FK,
  to avoid a circular FK with `followup_versions.case_id`. It is enforced by the
  publish transaction and asserted in tests.

## 8. Configuration

`src/config/env.ts` validates everything at boot and fails with a readable list
of problems. Key groups: HTTP (`HOST`/`PORT`/`PUBLIC_BASE_URL`), database
(`DATABASE_URL`, `DB_POOL_MAX`), LLM (`LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`,
timeout, retries), jobs (lease, poll interval, concurrency, max attempts), auth
(session and login-token TTLs).

The LLM provider is optional: with `LLM_BASE_URL`/`LLM_MODEL` unset,
`isLlmConfigured()` is false and AI handlers must stay disabled rather than
fabricate output.

## 9. Non-goals (explicit)

- No frontend, no server-rendered pages.
- No dependency on any third-party platform API; search/import adapters are a
  later module.
- No vector store, no model training, no multi-agent orchestration.
- No P1/P2 PRD features (share images, hot-list hints, personal history scan).
