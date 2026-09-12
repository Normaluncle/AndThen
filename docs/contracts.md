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

## 11. Contract changes — final implementation audit

- AI-C prompt version `2026-09-12.2` requires statement `section`:
  `then`, `later`, or `reflection`. `unresolved_items` remains the separate
  private unknown block. Missing evidence means an empty block, not invented
  filler. Private statements keep their section but never enter public output.
- Existing/manual statements may omit section; no legacy stored hash is
  rewritten. Authors can classify their answers with PATCH, producing a new
  version/hash and requiring fresh confirmation. Both public story and followup
  projections preserve the optional section and exclude evidence/private data.
- AI-A knowledge-only classification forces `not_suitable`, regardless of a
  model's contradictory invite recommendation; popularity is not an input gate.
  Classification itself still requires real-model evaluation.
- POST `/api/followups/:id/withdraw` accepts no body or `{reason?: string}`.
  Verified author, admin, or researcher who created the case may withdraw the
  current publication. An unrelated researcher cannot. This operation grants
  no private draft-read permission; repeated withdrawal produces no new audit.
  Audit records actor, optional reason and operator flag. Private-retention
  expiry does not prevent withdrawal of a still-public version.
# v1.2 additions (implementation in progress)

`GET /api/integrations/zhihu/capabilities` reports real configuration boundaries.
`GET /api/discovery/search?q=...` requires a session and returns official summaries and selected comments.
`POST /api/sources/resolve {url}` registers an exact canonical URL, with `summary_available` or `pending_content`; never accepts supplied author identity.
`GET /api/me/workbench` resolves verified own cases.
`GET /api/me/memory`, `PUT /api/me/memory/consent {enabled}`, and `POST /api/me/memory/refresh` act only on the authenticated account.
Memory processing additionally requires verified source ownership and source-specific external-model/private-interview consent.
Private memU HTTP service uses a server-only token and UUID-scoped generation paths. PostgreSQL owns the active generation; SQLite is rebuildable. No embedding or credentials are returned to the browser.

## v1.2 官方本人内容与评论（2026-09-13）

以下 GET 只向管理员开放，使用配置的 Access Secret 所属账号，不接受客户端 user_id、账号标识或 OAuth token：

- `/api/integrations/zhihu/creator/contents?offset=0`：最多 20 条回答/文章摘要，带 `paging.is_end/next_offset/stopped_reason`。
- `/api/integrations/zhihu/creator/content?url=...`：官方全文，`body_format=untrusted_html`。功能页面以文本显示，不执行 HTML。
- `/api/integrations/zhihu/creator/comments?url=...&offset=0`：根评论与上游附带回复；`coverage=paged_roots_with_partial_children`，不代表楼中楼完整。作者链接仅由官方 AuthorToken 生成。
- `POST /api/sources/:id/zhihu/comments/sync`：管理员为已有来源排入单页同步任务，返回 202 与 `job_id`，按来源去重；GET `/api/jobs/:id` 查看本人任务结果。达到官方额度/授权错误时本次任务失败，不自动反复请求。
- `GET /api/stories/:id/comments`：只在原故事仍满足公开规则时返回已同步评论及同步时间。没有对应许可不返回评论正文。缓存不充当作者记忆或发布证据。

游标按官方 NextOffset 原样回传并作 Int64 校验，不按页长度猜测。游标缺失或不递增时显式标记；每页事务写入，按精确评论 ID 更新。末页下次从原末页继续获取增量；缺失评论不推断为上游删除。最多缓存 2000 条，达到上限不部分提交。删除来源时缓存级联清理，来源失效/任务失去租约后不能回写。

新增表 `zhihu_comment_syncs`；新增迁移 0007，旧迁移保持原样。能力状态新增 `creator_account_reads` 与 `comment_sync_scope=access_secret_owner_only`，不表示任意 OAuth 作者可调用全文/评论。

## v1.2 作者记忆回写与内部返回

`recallMemory` 内部返回分为 `preferences`（全部有效明确拒谈边界）与 `records`（最多五条、总计约两千字的相关经历）。两组都必须通过当前来源权限、版本校验，不把检索排名当作边界过滤器。记忆页面复用相同有效性检查。外部 HTTP 响应保持兼容。

`memory.refresh` 新索引激活采用来源→作者记忆→任务租约的事务检查，并将旧索引清理入队。同意切换与相关任务入队同事务提交。成功/复用/过时结果保存在 job.result，包含不带正文的模型调用量、token 和时延；向量 token 未知，不推算。工作台超过 24 小时触发去重刷新。
# v1.2 official candidate interest and preparation

`GET /api/drafts/:id/evidence` is restricted to the case's author (including against unrelated admin sessions). It returns `draft_id`, `content_hash`, referenced `items` only, and `missing_refs`. Each item has `id`, `text`, `visibility`, `source_kind` (`original`, `interview`, `author_edit`) and nullable `material_level`. Missing or expired interview evidence is not invented; expired/purged private draft evidence returns 410 even if a public projection remains. Public story/followup projections never use this route. Reads use a transaction and the existing source lock/author checks.

Operator page reads: `GET /api/operator/sources?offset=0` is restricted to admins/researchers. Admins see nondeleted source metadata; researchers see only their imports or assigned cases. Responses contain `items` and nullable `next_offset` (50 per page), with source ID/title/permission, case ID/status and preparation status, never source bodies. Existing private source routes continue to authorize detailed reads.

`GET /api/operator/jobs?offset=0` is admin-only and lists failed task IDs, kind, status, attempts and update time (50 per page). It omits payloads, results and provider error text. This is an inspection endpoint, not generic task replay. No role or ownership is accepted from these query strings.

Verified owners granting `private_interview` for a pending source move it to `private_only`, never `public_approved`. Review of a `third_party_link` requires the case's verified owner and active interview consent in addition to the existing snapshot/revision and permission checks. Operator case creation resolves any already verified owner from the database; callers do not supply ownership. Author verification, conflict checks and case binding commit under the source row lock.

All paths below use `/api`. Authentication is required. `GET /discovery/feed` returns up to 50 recently stored official candidates; `GET /discovery/following` returns up to 100 candidates followed by the caller. Candidate fields include `candidate_id`, nullable `linked_source_id`, `interested`, and the official summary fields. Search and exact link resolution persist server-observed candidates without running memory extraction.

`PUT /discovery/candidates/:id/interest` accepts only `{ "active": boolean }`. Identity comes from the session. The server loads the official material, records an interest, and on first interest enqueues `memory.prepare` for the source snapshot. It returns `{ active, source_id }` in the standard envelope. Unknown candidates return 404; deleted/revoked sources cannot be followed. Candidate interests are excluded from historical organic research metrics.

Migration 0008 adds `discovery_candidates` and `source_preparations`. Preparation records are source-scoped, never a verified author identity. Unchanged pending/ready snapshots are reused. Index generation, source permission, latest snapshot, known-author consents and worker lease are checked before activation. Failed preparation stays failed and schedules provisional-index cleanup; an explicit later follow can request a fresh generation, with a generation-specific dedupe key. Current preparation jobs have one automatic attempt. Material replacement and consent revocation invalidate preparation. Author adoption additionally requires verified ownership and purpose-specific consents. Memory summaries remain ineligible as standalone publication evidence.

Memory scheduling: refresh admission locks the author profile and enqueues by author and generation in the same transaction. Consent enable uses the same dedupe key. A disabled profile returns the existing consent_required (422); an error profile becomes pending with error_code cleared after enqueue, while ready profiles remain ready. Across workers, live memory leases serialize refresh/preparation/delete per user_id (or source_id for preparation), including different generations. memory.refresh and memory.prepare share MAX_CONCURRENT_AI_JOBS with ai.*; delete does not consume that model limit. This does not extend daily AI enqueue quotas to memory tasks. Lease expiry permits recovery; fencing and index tombstones remain required.

GET /api/me/memory additionally returns materials: { items: [{source_id, title: string|null, material_level: string|null, status}], truncated: boolean }. Status is indexed, consent_required, material_missing, batch_limit, or no_current_memory. Only nondeleted sources with verified ownership for the authenticated caller are listed, most recently updated first, capped at 50 with a truthful truncation flag. indexed requires a ready profile and a currently valid record; metadata contains no material body. Material eligibility still uses the existing first 20 authorized sources. Login does not imply complete provider content access.

POST /api/interviews/:id/retry accepts strict {expected_version: positive integer}. It is owner-only, with verified source ownership, fresh private content, active interviewing case/session, manual fallback stopReason, active private_interview and external_model_processing consents, configured model, and remaining main-question budget. An existing unanswered AI question blocks retry. Under source/case/session locks, it cancels active session jobs, increments revision, clears fallback, and enqueues the existing AI-B handler. It returns the normal {session,job_id} envelope (202 when queued, 200 on explicit quota fallback). Stale/duplicate versions and invalid state return 409, missing consent 422, missing model 503. Messages are not rewritten; model evidence validation and question limits remain unchanged.

### OAuth client preparation (not an enabled HTTP contract)

`zhihu/oauth-client.ts` implements the official fixed-origin authorization URL, form code exchange, bearer-only user lookup, state comparison and account-bound AES-256-GCM token encryption. It preserves the registered callback bytes and large numeric UID. Provider bodies/errors do not escape; responses are capped at 64 KiB with 20-second timeout and redirects rejected. Optional empty profile display fields are omitted; email/phone/gender are not imported as identity keys. Missing/mismatched state and ambiguous code aliases fail closed.

The HTTP start route remains unavailable; this helper does not implement a persistent one-time attempt, token repository, binding or login session. Official Skill downloaded on 2026-09-13 still records historical missing state echo. Real activation awaits confirmed callback correlation plus App ID/App Key and registered HTTPS callback. No new public route or schema migration in this checkpoint.

Subsequent persistence checkpoint: additive migration 0009 introduces zhihu_oauth_attempts. oauth-attempts.ts starts a ten-minute attempt bound to a server-resolved session, storing only state/browser-proof hashes. Starting again invalidates that session's older attempts. Consumption requires both random values, an unexpired unused attempt, an active session and enabled user; a database transaction permits exactly one concurrent consumer. Consumption precedes provider exchange, so a later failure requires a fresh start. The service returns identity only from the session join; it does not promote roles or grant consent. Expired-row cleanup is provided as an internal function; route/cookie/cleanup scheduling and final account binding remain to be wired. Token persistence is not part of this table.

Source replacement authorization: after snapshot dedupe and before a new version is appended, require administrator, verified owner, assigned researcher, or original importer while no verified owner exists. Unrelated callers and former importers after ownership verification receive 403; no snapshot or memory invalidation is committed. Internal official_api-to-official_api refresh remains allowed from the official adapter; HTTP source import provenance excludes official_api. Identical content still deduplicates without changing material. SourceMaterials frontend uses existing import/read/consent contracts; it does not create verification or publication side effects.

## v1.2 集中补齐：OAuth 与管理接口

POST /api/auth/zhihu/start（站内登录，严格空对象）创建一次性请求，返回 authorization_url/expires_at，并设置十分钟 HttpOnly Secure SameSite=Lax Cookie。GET /api/auth/zhihu/callback 接收 state 和 authorization_code（兼容 code）；同时核验 Cookie 与一次性请求，在服务端换令牌和读取官方 UID，完成唯一绑定后返回无令牌的结果。缺少应用配置、HTTPS 回调或 ZHIHU_OAUTH_STATE_VERIFIED 时拒绝启动。GET 的旧 start 路径仅保留不可用提示；页面改用 POST。回调页完成后返回原账号页刷新，站内 session 不进入 URL。

GET /api/me/zhihu 返回授权状态、UID、显示名、过期时间、资料处理同意与最近同步时间；无令牌或密文。DELETE /api/me/zhihu 删除本地密文，取消待回调请求、撤销 OAuth 材料处理同意/核验并使相关记忆失效。身份保留以防转绑冲突；不声称调用了官方未提供的远程撤销接口。

POST /api/me/zhihu/sync 要求 {accept_material_processing:true}：明确同意官方本人摘要用于私有采访、模型处理和记忆。按账号去重入队，后台最多读取首批 20 条回答/文章摘要，依据官方本人列表核验归属，给未绑定回访关联作者，按来源记录两项同意；不授予公开展示。已有不同核验归属则拒绝。读者账号仅在取得本人内容后由服务端升为作者。重新进入账号页/作者工作台超过 24 小时才后台检查。令牌/同意/版本改变或账户失效时旧结果不落库；关闭记忆同时停止自动资料同步。

新增迁移 0010（zhihu_accounts 加密令牌与 UID 唯一约束）和 0011（资料同意、同步时间）。旧迁移保持原样；用户删除时凭证表通过外键级联清除。令牌过期后不能读取本人数据，只有 OAuth 依据的材料不能继续用于记忆。

POST /api/operator/jobs/:id/retry（管理员）要求 expected_updated_at，复制失败任务到新任务并关闭旧失败项；原处理器重新执行当前权限/版本/同意校验，不直接重放业务副作用。响应仅新 job_id/deduped。任务变更或重复提交返回 409。采访业务已降级但任务本身成功时，仍由作者采访重试接口处理。

返回账号登录补充：迁移 0012 为授权请求增加 completed_user_id/completed_at/delivered_at。回调以经过官方 /user 核验的 UID 找到既有账号，不能把它重新绑定到发起的新临时读者。POST /api/auth/zhihu/finish 要求原发起会话与 attempt_id，在有效期内一次性交付 ready/session_token/user；未完成 ready=false，其他会话/重复领取/失效请求拒绝。站内 token 仅此响应返回一次，数据库仍只存哈希。原页点击“我已完成知乎授权”接收并进入账号，回调页不含站内令牌。
