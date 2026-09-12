# Independent model API

Runtime credentials are read only by `src/ai/client.ts` using `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`. WorkBuddy credentials and development-agent sessions are never product runtime inputs. Prompts live in `src/ai/prompts.ts` and compile into the backend image. Current version: `2026-09-12.1`.

## Source analysis (AI-A)

`POST /api/sources/:id/analyze` with `{ "snapshot_hash": "<current snapshot hash>" }` returns 202 with `job_id` and `deduped`. Caller must be allowed to read the private source. A source author must separately grant external model processing. Third-party links, unlicensed candidates, empty material, oversized inputs and stale snapshots are rejected before dispatch. Without provider configuration the non-risk path returns 503 and manual review remains available.

A conservative deterministic sensitive-content screen produces a clearly labeled `deterministic_rules` hold result without sending the material to the provider. It is not a complete classifier or a certification of safety.

Model candidates must match the analysis schema. Claims must be exact evidence fragments; references must name the pinned snapshot; time anchors require a verbatim supporting basis. Missing publication dates and non-exact material require human review. The worker records actual model metadata, usage and latency when available; unknown price remains unknown. Analysis does not create invitations or change case state.

`GET /api/sources/:id/analysis` returns the latest successful analysis matching the current snapshot or `analysis: null`. `GET /api/jobs/:id` is restricted to the task owner; an analysis failure is explicit in `result.analysis_status/error_code`, and does not become author rejection.

## Draft validation (AI-D)

`POST /api/drafts/:id/validate` with `{ "content_hash": "<current draft hash>" }` runs deterministic evidence checks first. A blocking rule, absent model permission, or absent model configuration returns 200 with `mode: rules_only`, a reason, and the rule result. This is not labeled AI completion.

With configuration and permission, returns 202 with `mode: ai_pending` and `job_id`. The worker sends only draft statements and their associated evidence, enforces a bounded input, validates model findings and checks the source, author, draft hash, current version, permission and job lease before writing back.

Rules cannot be cleared by a model. A model finding with blocking severity forces `blocking:true` even if its top-level flag says otherwise. Pending validation prevents confirmation/publication. Persisted blocking findings prevent confirmation/publication of that draft/hash; a new explicit author edit creates a new version. No model result confirms an author statement or publishes anything.

## Draft organization (AI-C)

`POST /api/interviews/:id/draft-ai` with `{ "expected_version": 0 }` queues a new draft for a finished interview. Use the current highest case draft version instead of zero if a version already exists. The endpoint requires the bound verified author, private interview consent, external processing consent, provider configuration, and available pinned snapshot/answers. It returns 202 with `job_id` and `deduped`. Without provider configuration use the existing manual `/interviews/:id/draft` endpoint; no generated output is fabricated.

The worker sends bounded evidence, validates the candidate schema and evidence/visibility references, and permits `source_quote` only for exact snapshot material. Author reports/reflections require interview-message evidence. The final write rechecks source availability, consents, interview revision and latest draft version under a job fence. A concurrent author edit makes the model result stale rather than overwriting it.

A successful run creates a new `draft` version with `aiAssisted: true`, no confirmations, a server-computed hash and pinned snapshot/interview references. The previous published version stays published. An invalid or failed model result creates no draft and returns `fallback_mode: manual_draft`. Audit rows close as cancelled when context changes; output is not retained on cancellation.

Shared global usage/concurrency quotas are still outstanding. AI-A/B/C/D have implemented handlers, but real-provider evaluation remains unverified without credentials; HTTP-provider tests are explicitly synthetic.

## Verification

`tests/business/analysis.test.ts`: consent prevents requests, private-read authorization, stale hashes, exact citation binding, actual usage persistence, invalid model references, sensitive-content no-send path, unchanged case state.

`tests/business/validation.test.ts`: rule-only/no-permission path, pending-job gate, model severity overriding an inconsistent flag, stale hash rejection, and new-version confirmation isolation.

`tests/business/drafting.test.ts`: no-permission zero calls, stale base version rejection, unconfirmed AI draft creation, old-publication preservation, invented-fact/private-leak rejection, and late result discard/audit cancellation after an author edit.
