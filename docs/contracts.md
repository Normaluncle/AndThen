# Frozen interfaces

Anything in this document is a contract between modules and with later
worktrees. Change it only with a deliberate edit here plus the code, and note it
in the commit message. Sections marked **FROZEN** must not be altered by a
business module.

## 1. HTTP envelope — **FROZEN**

Every `/api` response is one of:

```jsonc
// success
{ "request_id": "uuid-or-inbound-x-request-id", "status": "ok", "data": { /* payload */ } }

// error
{ "request_id": "...", "status": "error", "error_code": "forbidden", "message": "...",
  "details": { /* optional, non-secret */ } }
```

Helpers: `success(requestId, data)` and `failure(requestId, code, message, details?)`
in `src/http/errors.ts`. Route response schemas use `envelopeSchema(zodSchema)`
from `src/http/envelope.ts`. The `request_id` also appears as the `x-request-id`
response header.

## 2. Error codes — **FROZEN**

| code | HTTP | Meaning |
|---|---|---|
| `validation_error` | 400 | Schema/body/params invalid |
| `unsupported_media_type` | 415 | Framework-rejected content type (client error, never reported as 500) |
| `unauthorized` | 401 | Missing/invalid/expired/revoked credential |
| `forbidden` | 403 | Authenticated but not permitted |
| `not_found` | 404 | Unknown route or resource |
| `conflict` | 409 | Version/state conflict (e.g. stale draft hash) |
| `rate_limited` | 429 | Caller throttled |
| `source_incomplete` | 422 | Source material insufficient |
| `consent_required` | 422 | Required per-purpose consent missing/revoked |
| `author_unverified` | 422 | Author ownership not verified |
| `quota_exhausted` | 429 | Model/API quota exhausted |
| `model_timeout` | 504 | Model call exceeded its budget |
| `withdrawn` | 410 | Resource withdrawn by its author |
| `service_unavailable` | 503 | Dependency unavailable |
| `internal_error` | 500 | Unclassified; detail is logged, never returned |

Construct with `AppError.unauthorized()` etc. Never throw bare `Error` for a
client-visible failure.

## 3. Authentication — **FROZEN**

- Header: `Authorization: Bearer <opaque-token>`.
- `app.authenticate` — preHandler; resolves the session or throws `unauthorized`.
- `app.requireRole('admin', ...)` — preHandler; must follow `authenticate`.
- `requireAuthContext(request)` — returns `AuthContext` or throws.
- `AuthContext = { userId, role, cohort, sessionId, expiresAt }`, all
  server-derived. `role ∈ reader | author | researcher | admin`.

Routes (implemented):

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/sessions` | none | Body `{ login_token }` (strict). Single-use exchange → session. |
| GET | `/api/auth/me` | bearer | Current user + session metadata |
| POST | `/api/auth/logout` | bearer | Revokes the current session |
| GET | `/healthz` | none | Liveness |
| GET | `/readyz` | none | DB readiness |
| GET | `/openapi.json`, `/docs` | none | OpenAPI document / UI |

`GET /api/auth/me` returns `{ user, session: { id, cohort, expires_at } }`.
`POST /api/auth/sessions` returns
`{ session_token, token_prefix, expires_at, user }`.

## 4. Module contract — **FROZEN**

```ts
// src/shared/types.ts
export interface ModuleContext {
  db: Database;            // Drizzle client (see §7)
  env: Env;                // validated config
  logger: Logger;          // redacting pino logger
  jobs: JobQueue;          // enqueue durable work
  now: () => Date;         // injectable clock
}

export type ModuleRegistrar = (app: AppInstance, ctx: ModuleContext) => Promise<void> | void;

export interface ModuleDefinition {
  name: string;
  registerRoutes?: ModuleRegistrar;
  registerJobHandlers?: (ctx: ModuleContext, registry: JobHandlerRegistry) => void;
}
```

Registration: add your `ModuleDefinition` to the `modules` array in
`src/modules/index.ts`. `app.ts` calls `registerRoutes` under the `/api` prefix;
`worker.ts` calls `registerJobHandlers`. **No business route or handler may be
added by editing `app.ts` or `worker.ts`.**

## 5. Job contract — **FROZEN**

```ts
export interface EnqueueOptions {
  kind: string;
  payload?: Record<string, unknown>;
  runAt?: Date;            // default now
  priority?: number;       // higher first, default 0
  maxAttempts?: number;    // default 5
  dedupeKey?: string;      // partial-unique over queued|running
}
export interface EnqueueResult { job: JobRow; deduped: boolean }

export interface JobHandlerContext {
  job: JobRow;
  payload: Record<string, unknown>;
  attempt: number;         // 1-based on first run
  maxAttempts: number;
  signal: AbortSignal;     // aborted when the lease is lost
  logger: Logger;
  heartbeat: () => Promise<void>;  // throws if the lease was lost
}
export type JobHandler = (ctx: JobHandlerContext) => Promise<{ data?: Record<string, unknown> } | void>;
```

`JobQueue` API: `enqueue`, `claim`, `heartbeat`, `complete`, `fail`,
`reclaimExpired`, `getById`, `cancel`, `countByStatus`.

Rules a handler must follow:

1. Observe `signal`; long work must call `heartbeat()` periodically.
2. Be idempotent — a job may run more than once after a lease expiry.
3. Do not assume you can commit: a reclaimed job's result is discarded by design.

`worker_heartbeats` is upserted via `recordWorkerHeartbeat(db, { workerId, kind, meta })`.

## 6. AI contracts — **FROZEN**

Provider: OpenAI-compatible. `createLlmClient(env, logger)` →
`{ configured, model, baseUrl, complete(request) }`. The client is the only place
`LLM_API_KEY` is read; it never logs the key. With `LLM_BASE_URL`/`LLM_MODEL`
unset, `complete()` throws `service_unavailable`.

Validated output shapes (zod, `src/ai/tasks.ts`):

- `analysisResultSchema` — AI-A: `analysis_id, schema_version, source_id,
  snapshot_hash, material_level, case_type, claims[], missing_information[],
  safety, safety_reasons[], recommended_action, action_reasons[],
  reviewer_required, model_id, prompt_version, created_at`.
  `material_level ∈ exact_excerpt | summary_only | author_recollection`;
  `safety ∈ clear_for_pilot | manual_review | excluded`;
  `recommended_action ∈ invite | hold | not_suitable | author_initiated`.
  `evidence_refs` must resolve inside the current snapshot.
- `interviewTurnSchema` — AI-B: one main question + `purpose` + `basis_refs`.
- `followupDraftSchema` — AI-C: `statements[]` with
  `kind ∈ source_quote | author_report | author_reflection | ai_summary`,
  `visibility`, `content_hash`, `ai_assisted`.
- `validationResultSchema` — AI-D: rule-first findings with
  `severity ∈ blocking | warning`.

Job kinds: `AI_JOB_KINDS = { extract: 'ai.extract', interviewNext:
'ai.interview.next', draft: 'ai.draft', validate: 'ai.validate' }`.
Serialization helper: `interviewGenerateDedupeKey(sessionId)`.

## 7. Database contract — **FROZEN**

- Schema source of truth: `src/db/schema.ts`. SQL: `src/db/migrations/*.sql`,
  generated by `pnpm db:generate`, applied by `pnpm db:migrate` (idempotent).
- `Database` / `Transaction` / `Executor` types from `src/db/client.ts`.
- All timestamps are `timestamptz`; all ids are `uuid` with `gen_random_uuid()`.

Entity map (PRD §15.1 → physical):

| PRD entity | Table(s) |
|---|---|
| users | `users` |
| sources | `sources` |
| source_snapshots | `source_snapshots` |
| consents | `consents` |
| author_verifications | `author_verifications` |
| interests | `interests` |
| followup_cases | `followup_cases` |
| invitations | `invitations` |
| interview_sessions / messages | `interview_sessions`, `interview_messages` |
| followup_versions | `followup_versions` |
| notifications | `notifications` |
| ai_runs / research_events | `ai_runs`, `research_events` |
| deletion_jobs / audit_logs | `deletion_jobs`, `audit_logs` |
| *(foundation)* | `sessions`, `login_tokens`, `jobs`, `outbox`, `idempotency_keys`, `worker_heartbeats` |

Invariants later modules depend on:

| Invariant | Where enforced |
|---|---|
| one active interest per `(reader_key, source_id)` | `interests_reader_source_uq` |
| one live interview session per case | `interview_sessions_case_active_uq` (partial) |
| one message per `(session, client_message_id)` | `interview_messages_client_id_uq` (partial) |
| one version per `(case, version)` | `followup_versions_case_version_uq` |
| one notification per `(reader, published version)` | `notifications_reader_version_uq` |
| one active job per `dedupe_key` | `jobs_dedupe_active_uq` (partial) |
| one outbox row per `(topic, dedupe_key)` | `outbox_topic_dedupe_uq` |
| one idempotency record per `(scope, key)` | `idempotency_scope_key_uq` |
| one consent per `(user, source, purpose, version)` | `consents_user_source_purpose_version_uq` |

`followup_cases.published_version_id` is intentionally not a DB-level FK
(circular with `followup_versions.case_id`); the publish transaction owns it.

## 8. Identity module exports

```ts
// src/modules/identity/index.ts
export const identityModule: ModuleDefinition;

export function registerAuth(app: AppInstance, db: Database): void;
export function parseBearerToken(header?: string): string | null;
export function requireAuthContext(request): AuthContext;

export function createUser(db: Executor, input?: CreateUserInput): Promise<UserRow>;
export function findUserById(db: Executor, id: string): Promise<UserRow | undefined>;
export function findUserByEmail(db: Executor, email: string): Promise<UserRow | undefined>;
export function issueLoginToken(db: Executor, input: IssueLoginTokenInput): Promise<IssuedToken & { id: string }>;
export function exchangeLoginToken(db: Database, rawLoginToken: string, opts): Promise<{ user; session }>;
export function createSession(db: Executor, input: CreateSessionInput): Promise<IssuedToken & { id: string; userId: string }>;
export function resolveSession(db: Database, rawToken: string, opts?): Promise<AuthenticatedSession | null>;
export function revokeSession(db: Executor, sessionId: string, now?: Date): Promise<boolean>;
export function revokeAllSessions(db: Executor, userId: string, now?: Date): Promise<number>;

export function generateOpaqueToken(): OpaqueToken;   // { token, tokenHash, tokenPrefix }
export function hashToken(token: string): string;
export function sha256(input: string): string;
export function newId(): string;
export function tokenHashEquals(a: string, b: string): boolean;
```

## 9. CLI contract

| Command | Purpose |
|---|---|
| `pnpm bootstrap:admin -- [--email e] [--role r] [--name n] [--issue-for e] [--out path] [--json]` | Create/choose an account and mint a one-time login token. The raw token is printed to stdout (or `--out`, mode 0600) and never logged. |
| `pnpm db:migrate` | Apply pending migrations. |
| `pnpm db:generate` | Regenerate SQL from `schema.ts`. |

## 10. Changing a frozen interface

1. Edit this document and the code in the same commit.
2. Add or update a test that pins the new behaviour.
3. Note the change under "Contract changes" in the commit message.
4. Never edit an applied migration; add a new one.
