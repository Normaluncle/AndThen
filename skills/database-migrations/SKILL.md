---
name: database-migrations
description: Use when changing the AndThen Postgres/Drizzle schema or writing SQL migrations. Covers generating migrations, applied-migration immutability, the constraints that other modules depend on, and how to test against a real Postgres.
---

# Database migrations

`src/db/schema.ts` is the source of truth. SQL under `src/db/migrations/` is
generated from it. `pnpm db:migrate` applies pending migrations and is
idempotent.

## Workflow

```bash
# 1. edit src/db/schema.ts
pnpm db:generate        # writes NNNN_*.sql + meta snapshot
pnpm docker:testdb:up   # real Postgres on 127.0.0.1:55432
TEST_DATABASE_URL=postgres://andthen:andthen@127.0.0.1:55432/andthen pnpm db:migrate
pnpm test
```

## Rules

- **Never edit an applied migration file.** Someone has already run it. Add a new
  migration. Editing one silently diverges environments.
- **Additive by default.** Dropping a column or table requires an explicit
  decision in the commit message; other modules may still read it.
- **Constraints are the API.** Later modules rely on these and they are asserted
  in `tests/integration/migrations.test.ts`:
  `jobs_dedupe_active_uq`, `outbox_topic_dedupe_uq`, `notifications_reader_version_uq`,
  `interests_reader_source_uq`, `sessions_token_hash_uq`,
  `interview_sessions_case_active_uq`, `idempotency_scope_key_uq`. If you must
  change one, update `docs/contracts.md` §7 and the test in the same commit.
- **Partial unique indexes** express "one active row" semantics
  (`where status in ('queued','running')`, `where revoked_at is null`). Prefer
  them over application checks.
- **Timestamps are `timestamptz`.** Never store a date as `text`.
- **Historical vs. current are separate columns.** e.g. `source_snapshots`
  carries `published_at` (upstream) and `acquired_at` (our capture) independently;
  never overwrite a snapshot to "update" it — insert a new version.
- **Enums** are Postgres enums. Adding a value is a migration; removing one is not
  safe once data exists.

## Circular references

`followup_cases.published_version_id` is deliberately a plain `uuid`, not a FK,
because `followup_versions.case_id` already references `followup_cases`. Enforce
it in the publish transaction, not with a constraint.

## Verify

Migration tests create a throwaway database, migrate it from empty, assert the
table/index set, re-run to prove idempotency, and probe the dedupe index
behaviour. Run them against real Postgres — SQLite or a mock will not catch
partial-index or `gen_random_uuid()` problems.
