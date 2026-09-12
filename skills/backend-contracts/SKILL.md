---
name: backend-contracts
description: Use when adding or changing an AndThen backend HTTP route, service, module, or job handler. Covers the frozen module contract, response envelope, auth rules, and the wiring steps that avoid editing app.ts.
---

# Backend contracts

Read `docs/contracts.md` for the authoritative interface list. This skill covers
the decisions that are easy to get wrong.

## Non-negotiables

- **Identity is server-side.** Read `request.auth` (set by `app.authenticate`)
  and the database. Never accept `role`, `cohort`, `author_id` or `user_id` from
  a request body/query/header. This is why the session-exchange body schema is
  `.strict()`: a client sending `role` gets a 400 rather than silently being
  trusted.
- **Ownership is re-checked on every write.** `request.auth.userId` is the only
  trusted owner. Front-end state is never an authorization boundary.
- **Envelope everything.** `success(request.id, payload)` for success, `AppError`
  for failure. Declare response schemas with `envelopeSchema(...)` so the
  serializer strips accidental extra fields.
- **Consent is not login.** Consent is a separate, per-purpose row
  (`consents`), checked at publish time — not derived from being signed in.

## Wiring a route (the only correct path)

1. Add `src/modules/<name>/routes.ts` exporting
   `register<Name>Routes(app: AppInstance, ctx: ModuleContext)`.
2. Inside, get a typed handle: `const r = app.withTypeProvider<ZodTypeProvider>()`.
3. Guard with `preHandler: [app.authenticate, app.requireRole(...)]`.
4. Set `registerRoutes` on the module's `ModuleDefinition` in
   `src/modules/<name>/index.ts`.
5. Do **not** touch `src/app.ts`. It registers modules under `/api` from the
   registry.

Job handlers follow the same pattern via `registerJobHandlers` in the module
definition. Do not touch `src/worker.ts`.

## Choosing the right failure code

`validation_error` (schema), `unauthorized` (no/bad credential), `forbidden`
(wrong role), `consent_required` (missing per-purpose consent),
`author_unverified` (ownership not established), `source_incomplete` (material
insufficient), `conflict` (version/hash conflict), `withdrawn` (author withdrew),
`quota_exhausted`/`model_timeout` (provider), `service_unavailable` (dependency
down). Use `AppError.<helper>()`; never throw a bare `Error` for a client-visible
failure.

## Idempotency and retries

Write endpoints that a client may retry must accept `Idempotency-Key` (use the
`idempotency_keys` table) or a `client_message_id` unique per parent. Retried
writes must not create duplicates — the unique indexes in the schema are the
enforcement, not application `if` statements.

## Verification before you report done

`pnpm typecheck` and `pnpm test`. Add an integration test that fails without your
change. Confirm `/openapi.json` still generates.
