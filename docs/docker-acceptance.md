# Local Docker acceptance — 2026-09-12

**Current deployed runtime: `65bcb27`**, image manifest list `sha256:4639c80fc025ad49b72a98a05c84e61725fb60e40f03ccd86b81f831b45a8b34`. Current-run evidence is in the final sections below; earlier measurements are retained as history.

## Earlier foundation/runtime evidence

Runtime code revision: `1f0f59e`. Image manifest list: `sha256:4712226e57c58e6aeb8a32cd0a718ede6e53ec972ac96efde99eb0fe16151fd8`. Later commits adding delivery scripts do not change this runtime code. Rebuild and repeat checks after subsequent backend changes.

Observed: `docker compose build api` completed, including TypeScript compilation. Docker Hub metadata requests were slow but completed without changing system proxy/network settings. `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --no-build` recreated the services and applied migrations through the one-shot migrate service. API, PostgreSQL and worker are healthy; `/health/ready` reports database OK. API binds localhost:8080; the test overlay exposes PostgreSQL only on localhost:55432. No named data volume was deleted.

## Reproduce a backend-only manual demonstration

```powershell
New-Item -ItemType Directory data/demo -Force | Out-Null
docker compose exec -T api node dist/bootstrap/admin.js --email demo-ops@andthen.local --out /tmp/andthen-demo-admin.token | Out-Null
docker compose cp api:/tmp/andthen-demo-admin.token data/demo/admin.token
node scripts/demo.mjs --admin-token-file data/demo/admin.token
node scripts/demo.mjs --verify
```

The one-time administrator credential is read from a file, not a command argument. The demo creates a `test_fixture` author/source, performs manual author verification and case review, grants separate purposes, establishes a reader session, follows, interviews, confirms, publishes and waits for notification delivery. It deliberately performs no external model call and sends no invitation. `data/demo/state.json` contains private test session credentials until cleanup; this directory is Git-ignored. Do not publish it.

`--verify` reads the published statement, saved interview answer and reader following record. Verification passed after a restart of DB/API/worker and again after API/worker forced recreation. The script's initial following URL typo was corrected to `/api/me/following` before the successful verification.

`node scripts/demo.mjs --cleanup` withdraws and deletes only the saved test fixture, waits for the deletion receipt, then replaces its state with a content-free receipt. This completed against the running Docker worker. The one-time bootstrap file is already consumed but remains locally because automatic approval rejected a combined command containing file removal; no deletion workaround was used for that credential file.

## Backups and isolated recovery

```powershell
$backup = & ./scripts/backup.ps1
& ./scripts/restore-check.ps1 -BackupPath $backup.backup
```

Backup uses PostgreSQL custom format and a SHA-256 manifest under Git-ignored `data/backups`. Restore checks the manifest/hash, creates a uniquely named `andthen_restore_<uuid>` database, runs `pg_restore --exit-on-error`, counts core relations and removes only that isolated database. It never restores over the main database.

Verified a nonempty backup restoring 1 source, 1 snapshot, 1 interest, 1 interview, 1 message and 1 draft. Backup SHA-256: `BC7127E9B048ADB7F8BFF08777FC1C5933E649E09145D31518F4241E2873C1CB`. This is an engineering fixture, not real author data. An earlier empty backup was also restored but was not treated as the data-persistence proof.

Rotation is limited to matching managed dump names and valid manifests inside the selected directory. Tested an expired managed backup was removed while an unmanaged sentinel remained. Rotation runs when the backup script runs, **not as an installed daily host schedule**; uninterrupted 30-day automatic backup retention is therefore not yet promised. Restored backups may contain subsequently deleted material; do not expose a restored copy publicly without reapplying current deletion/consent decisions.

## Performance sample

`node scripts/performance.mjs` uses 10 concurrent reader sessions against the saved fixture. Successful observed sample:

| Operation | Samples | p95 | Maximum |
|---|---:|---:|---:|
| Non-model interest writes | 200 | 49.52 ms | 56.76 ms |
| Asynchronous deletion admission | 10 | 45.92 ms | 45.92 ms |

All asynchronous deletion jobs completed. Environment: local Windows host, Node v24.19.0, warm Linux Docker services, localhost HTTP. This passes the requested sampled write p95 ≤ 2 seconds and sampled asynchronous acknowledgment ≤ 1 second; it does not establish production capacity or AI request latency. The first performance attempt sent a JSON header on empty DELETE requests; after correcting the script, its partial fixtures were deleted and the whole sample rerun successfully.

OpenAPI was exported from the running API to `docs/openapi.json`. Re-export after backend changes. Outstanding overall goal work includes 30-day private-content physical cleanup, full requirement/test audit, and actual model-provider evaluation when credentials are available.

## Current backend rerun — 2026-09-12 19:22 CST

Runtime code `12f6b88` was built and deployed successfully. Image manifest list: `sha256:c9879c1668b329575a3193b1dcf22af72958b995c8dd6ae42d80021e17e1bd5a`. The migrate service completed; the live database reports six applied migrations (0000–0005). API, DB and worker reached healthy status, and readiness reported database OK.

The live manual fixture completed import/review/interest/interview/draft/confirmation/publication/notification. Source `9b9c3263-5bf9-48ef-b99d-71f372b9accd` and draft `ad090ca5-4922-4e7a-b510-750856533560` survived DB/API/worker restart with the saved answer and follow intact. This was synthetic `test_fixture` data; no independent model call or real invitation was made.

A separate live reader-account erasure succeeded: old session 401, dedicated receipt 200 (`6817b841-6479-4303-afee-6686d146d0f9`). Live OpenAPI exactly matched the source-generated static artifact, 50 paths.

Updated 10-session warm Docker sample: 200 interest writes p95 **183.97 ms**, max **460.56 ms**; 10 asynchronous deletion acknowledgments p95/max **70.71 ms**. All cleanup jobs completed. These meet the requested sampled bounds, not a production capacity claim.

Nonempty custom-format backup SHA-256: `6F5DDC223AE3DD6C92C87E04A110BE5E18DE0B76022170ACBC26D65BC1D3AAD2`. Restored into an isolated database with 1 source, 1 snapshot, 11 interests, 1 interview, 1 message and 1 draft; isolated restore database was removed by the restore script. Extra interests are the marked performance fixture sessions, not research participants.

Developer scheduler regression: **38/38 Node tests passed**, including fixed 1M configuration before prompt, resume, silent-300K refusal, model drift, permission handling and concurrency. These use a simulated ACP child and do not establish renewed WorkBuddy provider quota or full-1M recall.

This run discovered bootstrap `--out` still printed its token. Commit `5f43604` fixes file-only credential output, with an actual subprocess/isolated-PostgreSQL test. The emitted demo credential had already been consumed by the demo. No raw credential is copied into this report. The credential-output correction requires the subsequent image rebuild before declaring that CLI version deployed.

The subsequent `5f43604` image build also succeeded and was deployed with API/worker forced recreation. Manifest list: `sha256:b9552270fcbee1bd4ac425fbcf9767cbf0c8379481d7c19cbfccbea72c1e4fed`. All three persistent services are healthy. The fixture survived recreation; an immediate pre-readiness request had a socket failure, then verification passed after readiness became healthy. Only bootstrap output changed from the measured business runtime, so the earlier current-run business performance sample remains applicable to that unchanged code.

In the running container, bootstrap `--out --json` with silent logging produced no stdout. Its test credential was consumed through the session API and that session logged out. The saved demonstration was then withdrawn and physically deleted; cleanup receipt `dd9836d7-fdc6-43f0-b225-4f656f1160cc` succeeded. Local demo state now contains only the deletion receipt. Backups still follow their documented rotation policy; no raw credential or fixture body is included in this report.

## Final local engineering acceptance — runtime 65bcb27

Observed 2026-09-12 19:47–19:48 CST. Build from committed runtime `65bcb27`:
manifest list `sha256:4639c80fc025ad49b72a98a05c84e61725fb60e40f03ccd86b81f831b45a8b34`,
image config `sha256:2af9ef13f583ba13e3e5a233db068cf8183195aae982febfc0c03e6030bfff81`.
Later documentation-only commits do not change this runtime.

Executed `docker compose -f docker-compose.yml -f docker-compose.test.yml build api`
and `up -d --no-build --wait`; one-shot migration completed and all three
long-running services healthy. Host test DB port remains bound only to
127.0.0.1:55432; default Compose has no DB host port. API is 127.0.0.1:8080.

A fresh file-issued, one-time admin token was consumed by the demo script;
bootstrap stdout contained no credential. Manual fixture chain completed:
source `7b3259f5-c325-4507-8c6a-5a0f04b34b39`,
draft `e5d9c84c-9aab-438d-8df2-ca1f2c2e0784`.
`node scripts/demo.mjs --verify` passed after restarting DB/API/worker and again
after forced API/worker recreation. Source, follow, saved answer and draft were
retained. The original named PostgreSQL volume was preserved.

`node scripts/performance.mjs`: 10 concurrent sessions, 200 non-model interest
writes p95 **138.08 ms**, max 426.83 ms; 10 asynchronous deletion admissions
p95/max **80.20 ms**, all deletion workers completed. This is a local warm-run
sample on Windows / Node v24.19.0, not model latency or production capacity.

Nonempty backup `andthen-20260912T114748Z-cc1304eaa1794a8b86139dfa8981956a.dump`:
SHA-256 `0F30C917D446253CE4937FB46273E24569B63F37C2A30A67B6223A572F14D870`.
Hash-checked isolated restore succeeded: 1 source, 1 snapshot, 11 interests,
1 interview, 1 message, 1 draft. The isolated restore database was removed by
the restore-check script; the main database was not overwritten.

Final fixture withdrawal/deletion completed with receipt
`3b7264b0-f8e8-4266-a18d-d929cf71ebdf`; author/reader demo sessions logged out and
local demo state replaced by the content-free receipt. The consumed bootstrap
file remains Git-ignored. Final `docker compose ps`: api/db/worker healthy.
Live `/openapi.json` exactly matched the committed static file (50 paths).

Final code verification: typecheck clean; Vitest 35 files / 167 tests passed;
scheduler node:test 38 passed. The new tests cover actual worker process death,
structured section/hash compatibility, knowledge-only invite override,
operator withdrawal and private-route isolation. Runtime provider quality and
full-1M recall are not inferred from these engineering results.

## v1.2 isolated full stack — 2026-09-13

The earlier Python/Nginx registry blocker is resolved in this run. All three images built successfully:

- andthen-memory:v12: sha256:615211d81469208b55e1582c3a5c05149f57099ef540502d2f09f76e4a2cc315
- andthen-demo:v12: sha256:cd0cb3d615fa891da50a8a821785c4252ce83f788604bf64f7ebd210d6ed4ae1
- andthen-backend:v12: sha256:fc02e5ace552738468c4b2457fab6156298edbc36a3e375a94b515103c977d90

Frontend's initial build failed because unpinned Corepack selected pnpm 12 and esbuild had no build permission. demo/package.json now pins pnpm 11.19.0; demo/pnpm-workspace.yaml permits only esbuild. The subsequent frozen install and Vite build passed inside Docker.

Use Docker Compose supporting !override (tested with 5.5.1). From the repository root:

```powershell
docker compose --env-file .env.local -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml build
docker compose --env-file .env.local -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml up -d --no-build --wait --wait-timeout 60
docker compose -p andthen-v12-demo -f docker-compose.yml -f docker-compose.demo.yml ps
```

This starts an independent empty database, not the existing local-process fixture database. Frontend: http://127.0.0.1:5174; API/docs: http://127.0.0.1:8082/docs. PostgreSQL has no host port. The dedicated volume is andthen-v12-demo-pgdata; memory uses the Compose project-prefixed volume. Existing 8080 andthen services and andthen-pgdata were preserved and remained healthy. Do not add the test DB overlay to this stack. Do not delete volumes to restart it. The Git-ignored .env.local supplies provider keys and the internal memory token; never print resolved Compose environments.

Observed: migrations exited successfully; API, worker, database and memory healthy; frontend running and homepage HTTP 200. Nginx /api/stories returned the standard ok envelope; live OpenAPI includes interview retry. Browser showed the correct empty discovery page. A single explicitly fictional record completed real Bailian embedding, memU write/query and delete inside the memory container in 1303 ms. This is a vector smoke sample, not a complete Qwen interview or capacity measurement. Full two-account business acceptance in this new Docker database remains pending.

2026-09-13 Docker browser follow-up: updated backend/demo images preserved the isolated database. Operator created a test author in the UI; the author submitted explicitly fictional material and consents, operator verified/reviewed/recorded test invitation, author accepted and enabled memory. Real Qwen/memU memory became ready, two AI-B questions completed, a private answer persisted as private, and the interview was paused. Source and session IDs plus call metrics are in implementation-v1.2.md. Reader follow/publish/notification/withdrawal on this stack remains pending.
