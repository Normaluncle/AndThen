# AGENTS.md — working agreement for this repository

## Current authorization (2026-09-12)

The user explicitly authorized Codex to take over implementation after the
WorkBuddy quota failure. Existing WorkBuddy work and sessions must be preserved.
Codex-authored commits use command-scoped `Codex Development Agent
<codex@localhost>` identity, rather than attributing new work to WorkBuddy.
Token issuance responses necessarily return a new opaque token once; the secret
rule below prohibits logs, storage of raw tokens, and unrelated responses.

This file is binding for every development agent (including future worktrees).
Read it before writing code. Then read the skill(s) relevant to your task and
say which ones you read in your delivery report.

## 1. What this repository is

Backend only. "然后呢？ (AndThen)" — a reader asks *"然后呢？"*, an author writes
*"后来"*. Pure Node 24 + TypeScript + Fastify 5 + Postgres 18 + Drizzle, Vitest,
OpenAPI. No frontend. No dependency on any external platform API.

The foundation commit (identity + database + jobs) is done. Business modules are
assigned to separate worktrees. **Do not rewrite the foundation to suit your
module.**

## 2. Required reading per task type

| Your task | Read at minimum |
|---|---|
| Any module route / service work | `skills/backend-contracts/SKILL.md` |
| Schema or SQL changes | `skills/database-migrations/SKILL.md` |
| AI task handlers, prompts, evals | `skills/ai-evaluation/SKILL.md` |
| Docker, compose, runtime config | `skills/docker-ops/SKILL.md` |
| Committing / branching / PRs | `skills/git-delivery/SKILL.md` |

## 3. Hard rules

1. **Roles are server-authoritative.** Never read a role, cohort, `author_id`,
   `user_id` or permission from a request body, query string or header. Resolve
   identity through `request.auth` (populated by `app.authenticate`) and read
   everything else from the database. Test/demo accounts must not be able to
   self-report a role.
2. **Never log or return secrets.** Bearer tokens, login tokens, `token_hash`,
   provider keys. Only hashes are stored. The logger redacts known paths — do
   not add new paths that carry credentials.
3. **No fake data.** Demo data is `provenance = 'test_fixture'`. Never present
   fixture content as a real author's story. Never write "published to
   <platform>" — publishing is internal to this demo.
4. **Authorization is not derived from login.** Consent is a separate table,
   per purpose, checked at publish time.
5. **Envelopes are mandatory.** Success responses use `success(request.id, payload)`;
   errors are `AppError`. Both are documented in `docs/contracts.md`.
6. **Do not edit `src/app.ts` or `src/worker.ts` to add business routes or
   handlers.** Register through your module's `ModuleDefinition` in
   `src/modules/<name>/index.ts`.
7. **Every behaviour change needs a test that would fail without it.** Run
   `pnpm typecheck` and `pnpm test` before committing. Integration tests need the
   compose test database (`pnpm docker:testdb:up`).
8. **Do not delete or reset volumes, branches or other agents' work.** Migrations
   are additive; never edit an already-applied migration file — add a new one.
9. **Commit identity** is command-scoped:
   `git -c user.name='WorkBuddy Development Agent' -c user.email='workbuddy@localhost' commit ...`
   Never change global git config.

## 4. Layout

```
src/
  app.ts            HTTP factory: plugins, error handling, system routes, module registry
  server.ts         API entrypoint
  worker.ts         Worker entrypoint (same image, different command)
  bootstrap/admin.ts Admin bootstrap CLI (mints a one-time login token)
  config/env.ts     Validated environment schema
  http/             auth middleware, error taxonomy, envelopes, request id, OpenAPI
  db/               Drizzle client, schema.ts, migrations/, single migrate command
  jobs/             queue (SKIP LOCKED + lease/fencing), worker loop, handler registry
  ai/               OpenAI-compatible client + frozen AI-A/B/C/D output contracts
  modules/
    identity/       IMPLEMENTED — users, sessions, login-token exchange, auth contract
    sources/        reserved
    cases/          reserved
    interviews/     reserved
    followups/      reserved
    research/       reserved
  shared/           logger, shared types (AppInstance, ModuleContext, ModuleRegistrar)
tests/
  unit/             no database required
  integration/      real Postgres (compose test db)
docs/               architecture, contracts, implementation plan, checkpoints
skills/             task skills (see §2)
```

## 5. How to add a route

Inside your module's `routes.ts`:

```ts
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { success } from '../../http/errors.js';
import { requireAuthContext } from '../../http/auth.js';
import type { AppInstance, ModuleContext } from '../../shared/types.js';

export async function registerSourcesRoutes(app: AppInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/sources',
    {
      preHandler: [app.authenticate, app.requireRole('author', 'researcher')],
      schema: {
        tags: ['sources'],
        security: [{ bearerAuth: [] }],
        body: z.object({ original_url: z.string().url() }).strict(),
        response: { 200: envelopeSchema(z.object({ source_id: z.string().uuid() })), 403: errorEnvelopeSchema },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      // ... use ctx.db, ctx.jobs, ctx.logger, ctx.env, ctx.now
      return success(request.id, { source_id: '...' });
    },
  );
}
```

Then in `src/modules/sources/index.ts` set
`registerRoutes: registerSourcesRoutes` on the exported `ModuleDefinition`.
That is the only wiring needed — `app.ts` picks it up from the registry.

## 6. How to add a job handler

```ts
// src/modules/interviews/handlers.ts
import type { JobHandler } from '../../jobs/types.js';

export const generateNextQuestion: JobHandler = async ({ payload, logger, signal, heartbeat }) => {
  // long work: call heartbeat() periodically and observe `signal`
  return { data: { ok: true } };
};
```

Register it from your module definition:

```ts
export const interviewsModule: ModuleDefinition = {
  name: 'interviews',
  registerJobHandlers(ctx, registry) {
    registry.register('ai.interview.next', generateNextQuestion);
  },
};
```

Enqueue with `ctx.jobs.enqueue({ kind, payload, dedupeKey })`. Use
`interviewGenerateDedupeKey(sessionId)` so a single interview can never run two
generations concurrently. `worker.ts` needs no changes.

## 7. Serialization and side-effect rules

- Serialize work with `dedupeKey` (partial unique index over active jobs).
- Fan-out side effects (notifications) go through the `outbox` table, keyed by
  `(topic, dedupe_key)`, with `recipients` frozen at enqueue time.
- Retries must be safe: use `Idempotency-Key` / `client_message_id` for write
  endpoints, unique keys for state changes.

## 8. Definition of done

- `pnpm typecheck` clean, `pnpm test` green (and `pnpm test:integration` when you
  touched the database).
- OpenAPI document still generates (`/openapi.json`).
- New module registered via the registry, not by editing `app.ts`.
- `docs/contracts.md` updated if you changed a shared interface.
- Delivery report states: skills read, files changed, evidence (commands +
  results), blockers.
