# Codex takeover checkpoint — 2026-09-12

User explicitly requested a goal and authorized Codex to take over after WorkBuddy quota failure. Goal is active. No Codex native subagents were started. Runtime model remains an independent API.

## Implemented in this checkpoint

- Preserved and committed interrupted foundation work (`61220ec`), merged business modules (`753a56c`).
- Fixed business/foundation type contract integration and isolated business test databases.
- Transactional consent grant/revoke; effective active consent controls public listing and read; model/private consent revocation cancels jobs and switches active interviews to manual mode.
- Additive migration `0002`: deleted source marker, consent expiry, pinned interview snapshot, revision, message visibility, draft snapshot/interview links.
- AI adapter: fresh timeout per attempt, at most one retry, no provider-body logging, correct quota/timeout errors, caller cancellation, malformed/empty response rejection.
- Four versioned prompts in TypeScript (included in compiled image), conservative deterministic evidence/hash rules.
- Interview HTTP routes, durable answers, deduplication, pause/resume/finish, manual fallback, AI-B worker with revision and job fences.
- Manual draft creation, explicit author edit versions, per-item confirmation, atomic publication/outbox, withdrawal and public projection.
- Notification job freezes publication-time followers and rechecks cancellation; duplicate replay is harmless.
- Source deletion blocks access synchronously, then physically deletes content/derivatives; content-free receipt states external-provider and backup limits explicitly.
- Integration tests cover the manual chain, concurrent answer/publication replay, new/cancelled followers, withdrawal/deletion; simulated HTTP provider covers three interview branches, no-permission zero calls, late output rejection after revocation.

## Still required before goal completion

1. Remaining AI behavior and full workflow acceptance, including review expectations for author-initiated publication. Case review/invitation gate and shared budgets now implemented; real provider evaluation remains unverified.
2. PRD core route compatibility, stricter schema responses and frontend docs. Research observation/export routes now implemented (see continuation evidence below); fixed-window acceptance timing still needs an authoritative response timestamp before that rate can be claimed.
3. Full acceptance coverage: five-question cap, skip/repeat, pause/restart, faults and concurrent revocation/publication; source public consent version renewal and expiry; performance.
4. User data-deletion endpoint and scope audit. Private interview/draft 30-day cleanup is implemented and tested (below). Managed backup rotation/restore is tested but requires an operator invocation; no daily host schedule or external model deletion API is available.
5. Repeat Docker acceptance against final runtime commit after remaining changes. Containers now run `1f0f59e`; that revision passed build/migration/health, nonempty backup restore, restart/recreation persistence, manual HTTP closure and sampled performance.
6. OpenAPI artifact, reproducible API demo, requirement/test matrix, final docs/commit.
7. Real model credentials absent: use local `.env`, never claim simulated HTTP tests are real-model evaluation. P4 remains unverified until real configuration is provided.

## Review notes to resolve

- Source snapshot import uses natural-key advisory locking; coordinate source-row lock with deletion, prevent a new snapshot being attached while deleting.
- `getInterview`/`getDraft` should enforce synchronous deletion tombstone before returning private content (source APIs already do).
- Notification reads contain metadata only; ensure revocation status reflects source availability even before cleanup.
- Default public consent expiry, 90-day maintenance and private 30-day cleanup are implemented. Public source snapshot retention remains separate from the private interview/draft TTL.
- `draftEvidence` treats source snapshot as public after publication permission check. Author edits explicitly become author evidence; private-to-public edits must remain an explicit author action.
- Interview job dedupe includes revision so a just-persisted question whose job completion is pending cannot swallow the next answer's generation.
- Worker locks source before job fence to match revocation ordering; `withJobFence` supports an existing transaction/savepoint.
- Existing module placeholder comments and frozen docs need updating to actual behavior.

Commands: bundled `pnpm.cmd typecheck`, `pnpm.cmd test`; tests use real Postgres at localhost:55432 and create/drop isolated test databases. Never remove main Docker data volume.

## Continuation evidence — research module

The preceding turn made concrete progress (commit `af5adac`), not a wait or no-progress turn. This continuation verified clean main at that commit and Docker containers healthy but still on the older image.

Implemented `POST /api/research/events` with strict event allowlist, server-side identity/cohort/exclusion, source/public-version checks, concurrent replay deduplication and conflict detection. Implemented scoped aggregate `GET /api/research/export`, excluding test/author/prompted behavior, with explicit matching denominator and null missing rates. Export contains no raw participant IDs or content. Invitation figures use current outcome among records whose windows have completed, with an explicit limitation because reply timestamps are not stored.

Read `skills/backend-contracts/SKILL.md` and `skills/git-delivery/SKILL.md`. Contract documentation: `docs/research-api.md`. Verification: bundled `pnpm.cmd typecheck` passed; `pnpm.cmd test` passed 22 files / 129 tests. Focused research suite covers concurrent event replay, forged cohort/business events, researcher scope isolation, exclusion and null denominator behavior. Goal remains active; remaining AI stages, retention, Docker final build/restore/performance and real model verification remain outstanding.

## Continuation evidence — AI-A and AI-D

Previous turn was progress (`f34a350`). Implemented source analysis routes/worker with source/consent/hash/risk gates, strict candidate/citation/time-basis validation, fenced writeback, truthful deterministic no-send risk result, and recorded provider usage. Added draft validation routes/worker with rule-only downgrade, current-version checks, per-draft persisted findings, pending validation gate and blocking-findings checks at confirmation/publication. Tests use a local simulated HTTP provider, never real author/model evidence. Read `skills/ai-evaluation/SKILL.md` in addition to previously read backend-contracts/git-delivery. See `docs/ai-api.md`.

Outstanding review: stale/cancelled AI jobs should consistently close their audit run status without persisting a late output (currently some preflight/finalization rejection paths can leave a `running` audit row). AI-C, shared quotas, case review, retention and final Docker acceptance remain required.

Verification for AI-A/D: typecheck passed. Initial full suite found an obsolete assertion that the analysis route must not exist; changed it to require the integrated analysis and validation OpenAPI paths. Rerun passed all 24 files / 132 tests. No real provider credentials were used. This continuation is concrete implementation/test progress, and the goal is still active.

## Continuation evidence — AI-C and cancelled run audits

Previous turn was progress (`e80dbf6`). Added `/interviews/:id/draft-ai` and `ai.draft` handler with finished-interview/author/consent gates, pinned evidence, expected latest-version check, bounded input and strict draft output. Generated statements must pass evidence/visibility checks and kind-specific provenance checks. Successful output creates a new unconfirmed version without removing an old publication. Concurrent manual edits invalidate late generated drafts. The module registry now closes AI audit metadata on thrown context/lease errors without writing model output or business state; source-deleted audit rows are not recreated.

New tests use a simulated HTTP server and cover no-consent zero calls, unconfirmed draft creation, stale versions, invented numbers/dates, private-to-public leakage and delayed response after author edit, including cancelled audit status. Read/apply existing AI-evaluation, backend-contracts and git-delivery project skills. `docs/ai-api.md` updated. Process-crash audit reconciliation (as opposed to caught handler errors) remains to implement with operational cleanup. Goal stays active pending quotas/review/retention/Docker/delivery acceptance.

Verification: bundled `pnpm.cmd typecheck` passed and `pnpm.cmd test` passed 25 files / 133 tests. Existing Docker containers were not rebuilt in this milestone.

## Continuation evidence — shared AI budgets

Previous turn was concrete progress (`662b337`). Added validated env settings for UTF-8 input bytes, bounded response stream bytes, output tokens, shared active AI leases and UTC daily AI job admissions. Every stage uses the bounded HTTP client; it also rejects per-request model switching. PostgreSQL advisory locks serialize claim/admission checks across queue instances; ordinary work remains available at the AI cap. Deduplicated active requests remain replayable at the daily limit. Interview answer transactions catch admission quota errors and commit the answer with explicit manual fallback.

App/worker edits only pass infrastructure budget settings to JobQueue, not business route wiring. Compose forwards the same settings to both services. Read database-migrations and docker-ops project skills for SQL/config review alongside the existing backend/AI/git skills; no migration or volume operation was needed. Tests prove cross-instance admission caps, replay, ordinary-job availability, oversized stream cancellation, UTF-8 byte limits, capped output tokens and preserved answers on quota exhaustion.

Verification: `pnpm.cmd typecheck` passed, `pnpm.cmd test` passed 26 files / 138 tests, and `docker compose config --quiet` passed. This does not prove the running old containers use these settings; rebuild and final runtime acceptance remain pending. Daily admissions are not monetary/token billing; cancelled remote requests may outlive a local lease, as documented. Goal remains active for case review, retention, deletion scope, full acceptance, Docker persistence/restore/performance and final docs.

## Continuation evidence — human review and invitation gate

Previous turn was progress (`9daac47`). Added an assigned-researcher/admin review endpoint using case updated-at optimistic revision, current snapshot hash, structured reason, evidence reference and explicit human-review acknowledgment. Candidate/hold/eligible cases can progress to eligible/hold/excluded; declined/do-not-contact and progressed cases cannot be reopened. Invitation recording now requires eligible state plus an eligible audit for the current snapshot, so a changed snapshot requires renewed review. Invitation and decision mutations now acquire source before case locks to align with deletion/review.

The case test harness now explicitly performs human review rather than seeding an implicit eligible path. Tests exercise unreviewed invitation denial, author/unassigned-reviewer denial, concurrent stale review conflict, changed snapshot re-review, and declined case protection. Project backend-contracts and git-delivery skills remain applied; docs/business-api.md describes the new contract. Goal remains active; review expectations for author-initiated publication still need complete-path scrutiny, and retention/Docker/final evidence work remains.

Follow-up within this milestone: publication now blocks reviewer_required cases. Affirmative human review is allowed for accepted/interviewing/paused/draft/confirmed author workflows while preserving that workflow status, so an author need not restart an existing interview/draft. The manual closure integration test proves a confirmed draft is blocked until admin review, then proceeds through publish/withdraw/delete. Verification: full suite passed 26 files / 139 tests before this last gate refinement; after it, typecheck and the affected case/interview suites passed 12 tests. No external invitation was sent. The final full-path audit and retention/runtime work remain required.

## Continuation evidence — consent expiration and maintenance

Previous turn was progress (`6429b56`). Public consent grants default to 90-day expiry with optional shorter requested deadline; same-version replay does not extend the deadline, and revoked/expired/changed-deadline renewals require a new version. Public read/list rejects expiry immediately, including legacy null expiry beyond 90 days. A recurring fenced maintenance job starts with the worker, processes expiry, withdraws notification metadata, cancels expired model/private-purpose work, and reconciles orphan running AI audit metadata. Next sweep is durably queued at a ten-minute boundary.

Tests cover deadline/replay/renewal, immediate denial, legacy expiry, notification withdrawal, audit cleanup and recurrence. Typecheck and focused suites passed. `docs/retention.md` explicitly distinguishes permission expiry from still-pending private 30-day physical cleanup and backup rotation. No Docker volumes removed; final Docker build and retention/backup acceptance remain required. Goal stays active.

Final milestone verification: `pnpm.cmd test` passed 27 files / 141 tests and `pnpm.cmd typecheck` passed. The recurring job is implemented and tested locally but not yet deployed into the currently running old worker image.

## Continuation evidence — Docker build and runtime acceptance

Previous turn was progress (`1f0f59e`). Built current backend image (manifest `4712226e57c58e6aeb8a32cd0a718ede6e53ec972ac96efde99eb0fe16151fd8`), restarted Compose including migrations, and verified API/DB/worker healthy. Slow Docker Hub metadata lookup completed; no global network changes or volume deletion. New `scripts/demo.mjs` ran the full manual backend HTTP flow against the real containers and verified publication, interview answer and following data after service restart and forced API/worker recreation. It then completed withdrawal and source deletion through the live worker.

Added PowerShell custom-format backup and isolated restore/checksum scripts. A nonempty backup restored one row in each of six core business relations. Managed expired-backup rotation was verified against an unmanaged sentinel. Rotation only runs with the backup command; an automatic daily host schedule is NOT installed, so uninterrupted maximum backup age is not yet proven. Added performance script: 10 concurrent sessions, 200 interest writes p95 49.52 ms / max 56.76 ms, 10 async deletion acknowledgments max 45.92 ms; all deletion jobs completed. Scripts had initial route/header typos corrected before successful reruns; partial performance fixtures were deleted through authorized API.

Exported runtime OpenAPI (45 paths) to docs/openapi.json. Full evidence/reproduction commands and limitations are in docs/docker-acceptance.md. Read Docker-ops/git-delivery skills; runtime build compiles TypeScript, delivery scripts were executed live and node syntax checks pass. After live cleanup, added logout calls and an existing-state overwrite guard to the demo script; these small refinements need a second complete demo invocation before final delivery.

Automatic approval rejected a combined command containing demo cleanup, credential file removal and checks with only 'blocked by policy'. Independent health/export calls and the scoped backend cleanup command succeeded. The consumed bootstrap token file remains locally; no alternate file-removal attempt was made. This is not a blocker to continued implementation.

Goal remains active: private 30-day physical cleanup, broader deletion scope/API compatibility and full acceptance matrix remain incomplete; rerun final Docker checks after runtime changes, and keep real model verification explicitly unverified without configuration.

Final script refinement verification: a second full `demo.mjs` create → verify → cleanup invocation succeeded against Docker, including the new session logout calls. The prior note that these refinements need a second invocation is now resolved. Fixture state was replaced with a content-free deletion receipt.

## Private retention continuation — 2026-09-12

- Additive migration `0003_skinny_spirit` records physical private/all-content purge timestamps on draft versions.
- Immediate 30-day deadline guards cover private interview/draft reads and mutations, job-result reads, manual/AI drafting and AI validation. Published owner projections omit expired private fields before the sweep without claiming physical cleanup already happened.
- Maintenance now deletes expired interview sessions/messages and associated AI artifacts/result caches, cancels pending/running model jobs, and clears unpublished version content while preserving version sequence/hash receipts. Public version text remains readable under its separate consent check; private auxiliary fields are removed. Automatic consent expiration does not prolong interview retention.
- Source-first locking and both preflight/writeback checks prevent a provider reply from recreating content after expiry or cleanup. Existing original WorkBuddy evidence is untouched.
- Verified: typecheck; full real-PostgreSQL/unit suite **28 files / 144 tests passed**. New tests cover immediate denial, physical cleanup, preserved public text, retained recent private material, empty association lists, repeated sweeps, zero provider requests for expired input, and late reply rejection after physical cleanup. One first-pass migration test saw a transient database authentication failure; isolated rerun and final full run passed without modifying credentials or weakening tests.
- Docker is still running runtime revision `1f0f59e`; this migration/runtime change has not yet been included in a new Docker image. Final rebuild, OpenAPI export and acceptance remain required after the remaining API work.
- Next: implement PRD `POST /api/me/data-deletion`, audit core route and T01-T22 coverage, update delivery docs and run final Docker acceptance. Real provider P4 remains unverified without independent model configuration.

## Reader activity deletion continuation — 2026-09-12

- Added PRD-named `POST /api/me/data-deletion` with explicit `reader_activity` scope, reader authentication, confirmation and caller-scoped hashed replay key.
- Transactionally removes own prior activity and frozen outbox recipient membership, preserving other users, author material and subsequent interactions. Replies HTTP 200 with a completed content-free receipt; existing `GET /api/deletions/:id` enforces requester ownership.
- This is scoped activity erasure, not account closure. Identity/login deletion and standalone case/interview scopes remain unimplemented and are explicitly documented in `docs/deletion-api.md`; do not claim whole-account deletion is complete.
- Typecheck and affected regression suites passed: 5 files / 9 tests (reader deletion, research, full manual workflow, OpenAPI, registry). Source deletion remains asynchronous via its existing endpoint. The final Docker image/OpenAPI artifact still need refreshing after remaining work.
- Next: finish deletion scope audit, full PRD interface/acceptance matrix and final Docker delivery. Previous goal turn was concrete progress (retention code, migration, tests, commit); this turn adds actual API behavior and independently executed tests.

## PRD route and acceptance audit continuation — 2026-09-12

- Added `docs/acceptance-matrix.md` with every T01-T22 item, chapter-16 core route and implementation-plan gate, distinguishing executed evidence, partial coverage, missing behavior and revised-scope exclusions. Goal remains active; prior test counts do not prove full delivery.
- Found and fixed two concrete chapter-16 gaps: `/api/me/notifications` now uses the existing owner-scoped notification handler; finish now returns an evidence-preserving draft and pending confirmation items. Repeated/concurrent finish requests reuse one draft. Skipped-only interviews return an explicit null draft rather than fabricated content.
- Typecheck passed. Affected suites passed (4 files / 11 tests); after adding the skipped-only regression, the full manual workflow suite passed both tests. No Docker rebuild or OpenAPI artifact refresh yet.
- Outstanding requirements are now centralized in the acceptance matrix: whole-account scope, research export path/date/cohort/event contract, specific AI adversarial/budget/failure cases, final runtime and delivery documentation.

## Research export contract continuation — 2026-09-12

- Added `/api/admin/research-export` and extended both export paths with source-scoped authorization, optional ISO timestamp bounds and exact cohort filtering. Event windows use `[from,to)` and report normalized bounds.
- Added deidentified event details using an explicit field/type allowlist, UTC-day timestamps and no user/event IDs, arbitrary properties or content. More than 10,000 matching events produces an explicit narrowing error, never a silently partial export.
- Current follower snapshots and current bound-author invitation cohorts are labeled as such; invitation cohort exclusions now remove internal/test/unassigned author cohorts. Fixed-window response-time acceptance remains unimplemented and explicitly unclaimed.
- Typecheck and affected tests passed: 3 files / 6 tests. The new real-PostgreSQL test proves lower-bound inclusion, upper-bound exclusion, cohort filtering, denied unrelated researcher, empty selection and private-property omission. OpenAPI route registration is tested; static artifact/final Docker refresh remain pending.
- Updated research API and acceptance matrix. Next unresolved work remains account/interview deletion scope, specific AI budget/injection/failure regressions, fixed-window invitation evidence, and final runtime/documentation delivery.

## Fixed invitation window continuation — 2026-09-12

- Migration 0004 adds nullable invitation response time without fabricating historical values. Bound-author final decisions timestamp pending/no-response/replied records; first final outcomes are not overwritten by unrelated later case transitions.
- Research exports now include fixed-duration, per-author-cohort groups with eligible denominator, on-time accepts/declines, late replies, no response and unknown timing. Deadline equality is included; invalid windows and unknown historical responses are excluded from the fixed-window denominator. The old current-state ratio remains explicitly labeled separately.
- Verified migration from empty and regressions (3 files / 20 tests before extending prior-status coverage), followed by typecheck and 2 files / 17 tests covering pending, no-response and replied decisions. Database-backed boundary fixtures distinguish 24/48-hour groups, late-by-one-second, legacy-null responses, no-response and invalid windows.
- Docker and static OpenAPI remain at earlier evidence revisions pending final rebuild. Goal still requires deletion scope closure, remaining AI behavioral regressions and final delivery/acceptance.

## Interview budget and failure continuation — 2026-09-12

- Added actual handler/HTTP/real-PostgreSQL regressions for five questions including skips, no sixth model request, pause/resume retaining the already generated question, 429 and malformed model JSON preserving saved answers and switching to manual mode without exposing provider error text.
- Repeated skipped questions now compare Unicode-normalized text after punctuation/whitespace removal; the test uses an ASCII-vs-Chinese question mark and whitespace variation. This is deterministic duplicate detection, not semantic paraphrase equivalence.
- Typecheck passed; interview suites passed 2 files / 13 tests. Provider responses remain explicitly simulated. Updated T10/T17 evidence in the acceptance matrix; process-crash-during-model and real-model qualitative evaluation are not inferred from these tests.
- Next unresolved implementation/acceptance remains deletion scopes, injection/empty-state and other matrix gaps, then final Docker rebuild and documentation/export.

## Injection and empty-state evidence continuation — 2026-09-12

- Added real-PostgreSQL regressions for an injected source instruction requesting publication/admin access/invitations. Source text reaches the provider as evidence; request grants no tools/functions. A simulated hostile reply with a publish field/tool call fails validation and causes no case transition, confirmation, publication, invitation, outbox or notification write.
- Added empty-public-list assertions for an empty database and for unlicensed-only material, including no private excerpt leakage and denied direct read.
- Typecheck passed; affected suites passed 2 files / 14 tests. Updated T11/T19 evidence. These tests prove deterministic backend boundaries using simulated output, not real-model quality.
- Goal remains active. Outstanding scope and final-runtime checks remain tracked in the acceptance matrix; no new Docker deployment or external model call occurred.

## Delivery documentation continuation — 2026-09-12

- Replaced stale foundation-only BACKEND.md with current Windows/Docker/local-development instructions, correct DATABASE_URL migration setup, separate runtime/dev-agent model boundaries and explicit outstanding scope.
- Updated README current-status paragraph while preserving the original WorkBuddy probe history. Added docs/frontend-integration.md covering sessions, asynchronous saved-input semantics, version conflicts, finish/draft/publication, privacy-safe reads, deletion limitations and same-origin browser proxy requirements.
- Added scripts/export-openapi.ts and actually ran it: current source registry exported 48 paths to docs/openapi.json. The first run exposed missing DATABASE_URL; the route-only exporter now provides a local fallback connection configuration and does not execute database work or start workers. This is source-schema evidence, not evidence of a new deployed image.
- OpenAPI regression suites passed: 2 files / 4 tests. Final Docker rebuild and live acceptance remain required, as do the unimplemented scopes in the acceptance matrix.
