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

1. AI-A analysis, AI-C optional structured drafting, AI-D validation routes/handlers and usage/input/output/concurrency quotas; case review transition. B implemented; prompts alone do not implement other stages.
2. Research events/export, PRD core route compatibility, stricter schema responses and frontend docs.
3. Full acceptance coverage: five-question cap, skip/repeat, pause/restart, faults and concurrent revocation/publication; source public consent version renewal and expiry; performance.
4. Retention automation, user/case/followup deletion scope as appropriate, backup rotation/restore. Source deletion active-store test passes but external model deletion API is not available.
5. Docker rebuild/migrate/cold-start/persistence/backup-restore/performance against final commit; existing containers still run the old foundation image.
6. OpenAPI artifact, reproducible API demo, requirement/test matrix, final docs/commit.
7. Real model credentials absent: use local `.env`, never claim simulated HTTP tests are real-model evaluation. P4 remains unverified until real configuration is provided.

## Review notes to resolve

- Source snapshot import uses natural-key advisory locking; coordinate source-row lock with deletion, prevent a new snapshot being attached while deleting.
- `getInterview`/`getDraft` should enforce synchronous deletion tombstone before returning private content (source APIs already do).
- Notification reads contain metadata only; ensure revocation status reflects source availability even before cleanup.
- Default public consent expiry is not yet assigned at grant. Private 30-day retention sweep and public 90-day review need implementation.
- `draftEvidence` treats source snapshot as public after publication permission check. Author edits explicitly become author evidence; private-to-public edits must remain an explicit author action.
- Interview job dedupe includes revision so a just-persisted question whose job completion is pending cannot swallow the next answer's generation.
- Worker locks source before job fence to match revocation ordering; `withJobFence` supports an existing transaction/savepoint.
- Existing module placeholder comments and frozen docs need updating to actual behavior.

Commands: bundled `pnpm.cmd typecheck`, `pnpm.cmd test`; tests use real Postgres at localhost:55432 and create/drop isolated test databases. Never remove main Docker data volume.
