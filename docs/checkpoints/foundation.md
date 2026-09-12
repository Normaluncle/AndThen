# Checkpoint — foundation

Date: 2026-09-12
Scope: infrastructure and contracts only (identity + database + jobs).
Status: **complete and verified**. Business modules are intentionally not
implemented.

## 1. Environment actually used

| Tool | Version |
|---|---|
| Node | 24.19.0 |
| pnpm | 11.19.0 (via corepack in the image; via the runtime shim locally) |
| Docker Engine | 29.7.2 |
| Docker Compose | v5.5.1 |
| Postgres | 18-alpine (container `andthen-db-1`) |

`npm` is **not installed** in this runtime. pnpm is used as the package manager
and `packageManager` is pinned in `package.json`; `pnpm-lock.yaml` is committed.

## 2. Evidence

### 2.1 Typecheck

```
$ pnpm typecheck
$ tsc --noEmit
TYPECHECK=0
```

### 2.2 Tests (real Postgres 18 on 127.0.0.1:55432)

```
$ pnpm test
 ✓ tests/integration/migrations.test.ts (5 tests)
 ✓ tests/integration/auth.test.ts (12 tests)
 ✓ tests/integration/jobs.test.ts (8 tests)
 ✓ tests/integration/openapi.test.ts (3 tests)
 ✓ tests/unit/tokens.test.ts (3 tests)
 ✓ tests/unit/ai-contracts.test.ts (5 tests)
 ✓ tests/unit/env.test.ts (4 tests)
 ✓ tests/unit/errors.test.ts (3 tests)

 Test Files  8 passed (8)
      Tests  43 passed (43)
```

What the required tests actually assert:

- **Authentication isolation** (`auth.test.ts`): missing / malformed / non-Bearer
  / expired / revoked credentials all yield 401 with the error envelope; a login
  token is single-use (replay → 401); only the SHA-256 hash of a session token is
  stored; a client-supplied `role` is rejected by the strict body schema and the
  DB row is unchanged; promotion/demotion in the database changes access with the
  **same** session token (proves role is server-authoritative); two identities
  cannot act as each other and one logout does not revoke the other; no response
  body contains the raw token or its hash.
- **Database migration** (`migrations.test.ts`): a throwaway database is created,
  migrated from empty, and asserted to contain exactly the 22 expected tables and
  the concurrency-critical indexes; re-running is a no-op; the `jobs` dedupe
  partial unique index blocks a duplicate active job but allows one after the
  first finishes and never blocks null keys; `source_snapshots.published_at` and
  `acquired_at` are independent and correctly ordered.
- **Job lease + stale result rejection** (`jobs.test.ts`): a live lease is not
  claimable by another worker; an expired lease is reclaimed; the reclaiming
  worker gets `fencing_token = 2`; the original worker's `complete` **and** `fail`
  both return false and change nothing; the current owner commits successfully;
  a stale `heartbeat` returns false; dedupe key serializes identical work and
  releases after completion; retryable failure requeues with attempts preserved,
  exhaustion dead-letters; the worker runs registered handlers and dead-letters an
  unregistered kind; the outbox rejects a duplicate `(topic, dedupe_key)`.

### 2.3 Docker: empty-database migration

```
$ docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build
 Container andthen-migrate-1 Exited
$ docker inspect --format '{{.State.ExitCode}}' andthen-migrate-1
0
$ docker compose logs migrate
{"service":"andthen-migrate","env":"production","migrationsFolder":"/app/src/db/migrations","msg":"applying database migrations"}
{"service":"andthen-migrate","env":"production","migrationsFolder":"/app/src/db/migrations","msg":"database migrations complete"}
```

### 2.4 Docker: health smoke

```
$ docker compose ps
andthen-api-1     | Up (healthy)  | 127.0.0.1:8080->8080/tcp
andthen-db-1      | Up (healthy)  | 127.0.0.1:55432->5432/tcp
andthen-worker-1  | Up            | 8080/tcp

$ GET /healthz  → {"request_id":"...","status":"ok","data":{"status":"ok","time":"2026-09-12T08:30:47.715Z"}}
$ GET /readyz   → {"request_id":"...","status":"ok","data":{"status":"ready","database":"ok"}}

$ GET /openapi.json
openapi: title='然后呢？ (AndThen) API' version=0.1.0
paths=/healthz, /readyz, /api/auth/sessions, /api/auth/me, /api/auth/logout
$ GET /docs/ → 200
```

### 2.5 Docker: end-to-end auth flow (in containers)

```
$ docker compose exec api node dist/bootstrap/admin.js --email ops3@andthen.local --name Ops3 --json
created=False role=admin prefix=... token_len=43

$ POST /api/auth/sessions   → status=ok role=admin
$ GET  /api/auth/me         → role=admin session=6d75d0f7-...
$ POST /api/auth/logout     → revoked=True
$ GET  /api/auth/me (after) → 401 code=unauthorized
$ POST /api/auth/sessions (replay of used login token) → 401 "Login token has already been used"
$ POST with application/x-www-form-urlencoded → 415 code=unsupported_media_type
$ docker compose logs api | contains raw session token? False
$ docker compose logs api | contains raw login token?  False
```

### 2.6 Worker

```
{"service":"andthen-worker","workerId":"worker-def01536-...","kinds":[],"msg":"registered job handlers"}
{"service":"andthen-worker","workerId":"worker-def01536-...","concurrency":4,"kinds":"all","msg":"worker started"}
```

`kinds` is empty because no business module registers handlers yet — expected at
this stage, and the loop still runs, reclaims expired leases and writes
`worker_heartbeats`.

## 3. Delivered artefacts

| Area | Files |
|---|---|
| Repo | `.gitignore`, `.npmrc`, `.env.example`, `.dockerignore` |
| Build | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `drizzle.config.ts` |
| Runtime | `src/app.ts`, `src/server.ts`, `src/worker.ts`, `src/bootstrap/admin.ts`, `src/config/env.ts` |
| HTTP | `src/http/{auth,errors,envelope,openapi,request-id}.ts` |
| DB | `src/db/{client,index,schema,migrate}.ts`, `src/db/migrations/0000_shallow_storm.sql` (+ `meta/`) |
| Jobs | `src/jobs/{queue,worker,types,heartbeat,index}.ts` |
| AI | `src/ai/{client,tasks,index}.ts` |
| Modules | `src/modules/identity/{routes,service,tokens,index}.ts`; reserved: `sources`, `cases`, `interviews`, `followups`, `research` |
| Shared | `src/shared/{types,logger}.ts` |
| Tests | `tests/helpers/testdb.ts`, `tests/unit/*.test.ts`, `tests/integration/*.test.ts` |
| Ops | `Dockerfile`, `docker-compose.yml`, `docker-compose.test.yml` |
| Docs | `AGENTS.md`, `BACKEND.md`, `README.md` (entry added, probe docs preserved), `docs/{architecture,contracts,implementation-plan}.md`, `docs/checkpoints/foundation.md` |
| Skills | `skills/{backend-contracts,database-migrations,ai-evaluation,docker-ops,git-delivery}/SKILL.md` |

Database: 22 tables, verified present in a freshly migrated database.

## 4. Module export signatures

The full list is in [docs/contracts.md](../contracts.md) §8. Summary:

```ts
// src/modules/identity/index.ts
identityModule: ModuleDefinition
registerAuth(app, db): void
parseBearerToken(header?): string | null
requireAuthContext(request): AuthContext
createUser / findUserById / findUserByEmail
issueLoginToken / exchangeLoginToken / createSession / resolveSession
revokeSession / revokeAllSessions
generateOpaqueToken / hashToken / sha256 / newId / tokenHashEquals

// src/jobs/index.ts
JobQueue { enqueue, claim, heartbeat, complete, fail, reclaimExpired, getById, cancel, countByStatus }
JobWorker { start, stop, runOnce }
JobRegistry { register, get, kinds }
recordWorkerHeartbeat / getWorkerHeartbeat

// src/ai/index.ts
createLlmClient(env, logger)
analysisResultSchema / interviewTurnSchema / followupDraftSchema / validationResultSchema
AI_JOB_KINDS / interviewGenerateDedupeKey
```

## 5. How the next agent joins

1. Read `AGENTS.md` §2 and the skills relevant to the task; report them in the
   delivery.
2. Create `src/modules/<name>/routes.ts` (+ `service.ts`, `handlers.ts`).
3. Set `registerRoutes` / `registerJobHandlers` on the module's `ModuleDefinition`
   in `src/modules/<name>/index.ts`. **Do not edit `app.ts` or `worker.ts`.**
4. Use `ctx.db`, `ctx.jobs`, `ctx.logger`, `ctx.env`, `ctx.now`; guard with
   `app.authenticate` / `app.requireRole(...)`; return `success(request.id, …)`.
5. Add integration tests, run `pnpm typecheck` and `pnpm test`, and confirm
   `/openapi.json` includes the new routes.

## 6. Blockers, deviations and open items

1. **`npm` is unavailable in this runtime.** pnpm is used and pinned. If a
   consumer requires `npm ci`, a `package-lock.json` must be generated elsewhere.
2. **Registry access.** The container could not reliably reach
   `registry.npmjs.org` (`ECONNRESET`). The project now pins
   `registry=https://registry.npmmirror.com` in `.npmrc` and sets
   `COREPACK_NPM_REGISTRY` in the Dockerfile. No global/proxy/firewall settings
   were changed. Change the registry and regenerate the lockfile if your
   environment reaches npmjs directly.
3. **BuildKit cache mounts removed.** Two stages installing concurrently against
   one shared pnpm store mount crashed (`exit 139`). The Dockerfile now installs
   without cache mounts; builds are slightly slower but deterministic.
4. **Contract addition during verification:** `unsupported_media_type` (HTTP 415)
   was added to the error taxonomy because a framework-raised 415 was previously
   surfacing as `internal_error`/500. Recorded in `docs/contracts.md` §2.
5. **No LLM provider configured.** `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` are
   empty by default, so `createLlmClient(...).configured === false` and AI
   handlers must stay disabled. Nothing was fabricated to work around this.
6. **Business modules are not implemented** — `sources`, `cases`, `interviews`,
   `followups`, `research` export registration placeholders with no routes and no
   handlers. Any claim of those features working would be false.
7. **No real participant data.** Only `test_fixture` provenance exists. Real
   authorized sources, author verification and contact are research-ops work.
8. **Not covered by tests:** concurrent multi-process claim contention (verified
   logically via `SKIP LOCKED` + fencing, and by single-process reclaim tests),
   and p95 latency targets from PRD §18.3 (design targets, unmeasured).
9. Existing Docker volumes were not modified or deleted. `docker compose down -v`
   was never run.
