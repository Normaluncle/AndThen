# BACKEND.md — 然后呢？ (AndThen) backend

Pure backend. Node 24 · TypeScript · Fastify 5 · Postgres 18 · Drizzle · Vitest ·
OpenAPI. No frontend, no dependency on any third-party platform API.

This file is the entry point for running the service. For the interface contract
see [docs/contracts.md](docs/contracts.md); for the working agreement see
[AGENTS.md](AGENTS.md).

## Current scope

This commit is the **foundation**: identity, database, and the job/worker
platform. It ships:

- Opaque bearer-token auth (server stores only the SHA-256 hash), session
  establish/exchange/logout/me, and an admin bootstrap CLI.
- A 22-table Drizzle schema covering every PRD §15.1 entity, plus
  `sessions`, `jobs`, `outbox`, `idempotency_keys`, `worker_heartbeats`.
- A durable job queue with `SKIP LOCKED` claiming, leases, fencing tokens,
  bounded retries and a dedupe key for serialized work.
- An OpenAI-compatible LLM client and the frozen AI-A/B/C/D output contracts.
- Docker/compose for `db`, `migrate`, `api`, `worker`.

Business modules (`sources`, `cases`, `interviews`, `followups`, `research`) are
reserved registration slots and are **not** implemented yet. See
[docs/implementation-plan.md](docs/implementation-plan.md).

## Quick start (local, with Docker Postgres)

```bash
# 1. dependencies
pnpm install

# 2. environment
cp .env.example .env          # then set DATABASE_URL

# 3. database
pnpm docker:testdb:up         # Postgres 18 on 127.0.0.1:55432
TEST_DATABASE_URL=postgres://andthen:andthen@127.0.0.1:55432/andthen pnpm db:migrate

# 4. run
pnpm dev                      # API on http://127.0.0.1:8080
pnpm worker                   # in a second terminal

# 5. create an admin and get a one-time login token
pnpm bootstrap:admin -- --email admin@andthen.local
```

Then exchange the printed token for a session:

```bash
curl -sX POST http://127.0.0.1:8080/api/auth/sessions \
  -H 'content-type: application/json' \
  -d '{"login_token":"<printed-token>"}'
```

The response contains `data.session_token`; use it as
`Authorization: Bearer <session_token>`.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | API with watch mode |
| `pnpm worker` | Worker loop |
| `pnpm build` / `pnpm start` / `pnpm start:worker` | Compile to `dist/` and run the compiled entrypoints |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit + integration tests |
| `pnpm test:unit` | Tests that need no database |
| `pnpm test:integration` | Tests that require real Postgres |
| `pnpm db:generate` | Regenerate SQL migrations from `src/db/schema.ts` |
| `pnpm db:migrate` | Apply pending migrations (idempotent) |
| `pnpm bootstrap:admin` | Create an account and mint a one-time login token |
| `pnpm docker:testdb:up` / `down` | Test Postgres on `127.0.0.1:55432` |

## HTTP surface

| Method | Path | Auth |
|---|---|---|
| GET | `/healthz` | none |
| GET | `/readyz` | none (checks the DB) |
| GET | `/openapi.json`, `/docs` | none |
| POST | `/api/auth/sessions` | none — exchanges a one-time login token |
| GET | `/api/auth/me` | bearer |
| POST | `/api/auth/logout` | bearer |

All responses use the `{ request_id, status, data }` / `{ request_id, status,
error_code, message }` envelope. `x-request-id` is echoed on every response.

## Configuration

See [.env.example](.env.example). Validated at boot by `src/config/env.ts`; a
bad configuration fails fast with a list of problems.

Notable: `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` are **optional**. When
unset, AI handlers must remain disabled rather than produce fabricated output.

## Docker

```bash
docker compose up -d --build       # db + migrate + api + worker
docker compose ps
docker compose logs -f migrate
```

The database has no published port in the base compose file. The test overlay
(`docker-compose.test.yml`) publishes `127.0.0.1:55432` only, for integration
tests. Never run `docker compose down -v` — the `andthen-pgdata` volume may hold
real data.

## Tests

`pnpm test` runs 37 tests: token/auth unit tests, AI contract tests, and
integration tests against real Postgres covering authentication isolation,
migration from an empty database, and job lease + stale-result rejection.

Integration tests read `TEST_DATABASE_URL` (falling back to `DATABASE_URL`, then
`postgres://andthen:andthen@127.0.0.1:55432/andthen`).
