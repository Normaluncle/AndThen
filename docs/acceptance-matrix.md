# Backend acceptance audit

Audit date: 2026-09-12. This is a gap-tracking audit, **not a declaration that every release gate passed**. The user changed the PRD scope to a local backend Demo with authorized imports and no required Zhihu integration or business pages. WorkBuddy quota failure was followed by explicit authorization for Codex to implement directly. Real-author participation and independent real-model evaluation have not occurred.

Evidence scope: PostgreSQL tests create isolated databases; simulated HTTP providers prove transport/control behavior, not model quality. Docker evidence in `docker-acceptance.md` belongs to runtime commit `1f0f59e` and must be refreshed for the final code. Source references below are repository-relative.

## PRD T01–T22

| ID | Backend evidence | Audit result / remaining work |
|---|---|---|
| T01 summary only | `sources-import.test.ts` rejects summary-as-quotation; `cases.test.ts` requires current-snapshot review before invitation | Backend rules covered; no page verification in backend scope |
| T02 independent dates | `sources-import.test.ts` preserves unknown/null and known dates; `migrations.test.ts` checks acquisition/publication independently | Covered by database/API assertions |
| T03 low likes vs knowledge | Import has no popularity cutoff; AI-A returns advisory candidates | Explicit paired experience/knowledge evaluation missing; do not call passed |
| T04 concurrent follows | `stories.test.ts` concurrent upsert, cancellation and restoration | Covered |
| T05 test-account exclusion | `stories.test.ts`, `research.test.ts` cover author, test_fixture, team and prompted exclusions | Covered for implemented aggregate metrics |
| T06 forwarded invitation / unrelated author | `cases.test.ts`, `verifications.test.ts`, `interviews.test.ts`, auth tests | Covered authorization checks; invitations cannot establish identity |
| T07 decline / do-not-contact | `cases.test.ts` prevents new invitation and reader access to private case | Covered; no external sender exists |
| T08 sensitive / unauthorized | `analysis.test.ts` sensitive rules-only path and zero provider requests; case review gate | Covered deterministic examples, not comprehensive sensitive-content classification |
| T09 different interview branches | `interview-ai.test.ts` completed/stopped/ongoing inputs reach different simulated replies | HTTP orchestration covered; real-model tone/branch evaluation pending |
| T10 skip / pause / resume | `interview-ai.test.ts` five questions including skips, no sixth request, pause/resume without duplicate question, repeated skipped question with punctuation variation rejected | Backend budget/replay covered; semantic paraphrases and process restart during active model generation still need evidence |
| T11 injected publish instruction | Runtime model has no tools and publication requires deterministic confirmation | Explicit malicious-source regression missing; architecture alone is insufficient proof |
| T12 invented date / number | `evidence.test.ts`, `drafting.test.ts` reject unsupported text, refs and private leakage | Covered conservative exact-evidence checks; paraphrase quality not evaluated |
| T13 edit invalidates confirmation | `interviews.test.ts`, `validation.test.ts` reject old hash and require new version | Covered |
| T14 duplicate publish / notify | `interviews.test.ts` concurrent publication and outbox replay; `reader-deletion.test.ts` removes old recipients | Covered |
| T15 withdraw / delete | `interviews.test.ts` source tombstone, public denial and physical cleanup; private retention and reader erasure tests | Source/activity scopes covered; whole-account closure and explicit standalone interview scope remain absent |
| T16 Zhihu search errors | No Zhihu search integration or fake live results; authorized import is the Demo input | Not applicable under revised scope; no claim of tested Zhihu 429 behavior |
| T17 failure / quota | `llm-client.test.ts` timeout/retry; `interview-ai.test.ts` full-handler 429 and malformed JSON fallback preserves saved answers and hides provider body; daily admission cap test | HTTP failure handling covered; real-provider availability remains unverified |
| T18 restart / redeploy | Live fixture survived DB/API/worker restart and API/worker recreation; nonempty backup restore | Passed for `1f0f59e`; final-runtime repetition pending |
| T19 no authorized result | Public query checks permission, tombstone and current published version | Explicit empty-list regression still needed; no real pilot claim |
| T20 mixed windows / cohorts | `research.test.ts` date/cohort filtering, deidentified fields, fixed-duration window groups, deadline/late/unknown timing; `cases.test.ts` server-recorded response time | Backend reporting covered for new timestamped records; legacy missing times excluded rather than guessed. No real participant study claimed |
| T21 private/public isolation | Source, case, interview, draft, notification and job owner checks; public statement projection tests | Covered sampled API paths; final core route sweep remains required |
| T22 copied vs Zhihu published | No copy endpoint or Zhihu publisher; Demo publication is local only | Not applicable under backend scope; no external-publication success claim |

## PRD chapter 16 route audit

All paths below have `/api` prefix.

| Required route | Current status |
|---|---|
| POST sources; GET stories/:id; POST sources/:id/analyze | Implemented; AI task returns job ID and does not change case status |
| PUT stories/:id/interest; GET me/following | Implemented |
| POST cases; POST cases/:id/invitations; POST cases/:id/decision | Implemented with review/identity/decline gates |
| POST cases/:id/interviews; POST interviews/:id/messages | Implemented, with durable answer before model execution |
| POST interviews/:id/finish | Now returns persisted `draft_id`, draft and pending confirmation items; concurrent retry reuses the same draft. If all answers are skipped/empty, returns null draft with explicit reason |
| PATCH drafts/:id; POST drafts/:id/confirm; POST drafts/:id/publish | Implemented with hash/version checks |
| POST followups/:id/withdraw | Author path implemented; separate accepted operator workflow still needs scope review |
| GET me/notifications | Implemented as an alias of notifications, same owner filter |
| POST me/data-deletion | Implemented only for explicit reader_activity; author source deletion is DELETE sources/:id. Whole-account closure absent |
| GET admin/research-export | Implemented with source authorization, date/cohort filters, deidentified event details and explicit denominator limitations; legacy research/export uses the same contract |

## Implementation-plan delivery gates

| Gate | Evidence / remaining work |
|---|---|
| P0 development agents | Scheduler, skills, worktree/session persistence and fixed-model/1M guards exist under tools/workbuddy and tests/orchestrator. Prior live short-session recovery verified. Three-process scale test/full-1M recall not verified; quota blocked original development workflow and user authorized takeover |
| P1 foundation | Node24/Fastify/PostgreSQL18/Drizzle; additive migrations; opaque hashed sessions; real-DB job lease/dedupe/fence tests; one-shot Compose migration |
| P2 business / AI / governance | Core modules present. Missing items above remain requirements, not optional polish |
| P3 complete backend fixture | Manual import→review→follow→interview→confirm→publish→notify→withdraw→delete exercised in tests and live Docker. Independent-model A/B/C/D paths use simulated providers in tests |
| P4 real model | No independent credentials supplied; explicit unverified boundary permitted by active goal. Do not report authentic AI interview evaluation or provider deletion |
| P5 Docker / persistence / performance | Prior nonempty restore and restart evidence; 10-session sample write p95 49.52 ms and async acknowledgment p95 45.92 ms. Final rebuild/migration/health/fixture/persistence/performance still pending |
| Prompts and schemas | Four versioned prompts and output validators exist. Need final review of five-question/skip policy, injection regression and structured “then/later/reflection/unknown” output fidelity |
| Retention | 30-day private cleanup and 90-day consent checks implemented. Backup rotation is operator-invoked; no daily host schedule. External provider retention remains a documented dependency |
| Artifacts | Source, migrations, scheduler, project skills, Compose, demo/performance/backup/restore scripts exist. Final OpenAPI export, coherent frontend integration guide/README and final Git/runtime correspondence pending |

No public pilot or external research result is claimed. The goal remains active while required implementation and final-runtime evidence are incomplete.
