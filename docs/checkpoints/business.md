# Checkpoint — business (sources + cases)

Date: 2026-09-12
Worktree: `D:/AndThen/.worktrees/business`, branch `agent/business`
Scope: PRD FR-01..FR-06, FR-07..FR-12 (the sources / consent / verification /
interest / following / case parts).
Status: **implemented and verified**. AI analysis, interviews, drafts and
publishing are owned by other worktrees and are intentionally not implemented
here.

## 1. Skills and documents read

- `AGENTS.md`
- `docs/contracts.md`
- `docs/architecture.md`
- `skills/backend-contracts/SKILL.md`
- `skills/git-delivery/SKILL.md`
- `.orchestrator/inputs/prd.txt`
- `docs/checkpoints/foundation.md`

No schema, migration, identity, AI, `package.json`, lockfile, `app.ts` or
`worker.ts` file was modified.

## 2. Files changed

| Purpose | Files |
|---|---|
| Sources module | `src/modules/sources/{access,service,routes,index}.ts` |
| Cases module | `src/modules/cases/{service,routes,index}.ts` |
| Business tests | `tests/business/{helpers,sources-import,stories,verifications,cases,openapi}.test.ts` |
| Docs | `docs/checkpoints/business.md`, `docs/business-api.md` |

## 3. Evidence

```
$ pnpm typecheck
$ tsc --noEmit
TYPECHECK=0

$ TEST_DATABASE_URL=postgres://andthen:andthen@127.0.0.1:55432/andthen_test_business pnpm test
 Test Files  13 passed (13)
      Tests  80 passed (80)
```

Business tests only: `pnpm vitest run tests/business` → 37 passed.

What the tests assert (each fails without the corresponding behaviour):

- **Import idempotency** — same material twice → one source, one snapshot,
  `deduped: true`; changed material → version 2.
- **Material rules** — `exact_excerpt` without `excerpt` → 422; a summary with
  `excerpt` → 400; unknown times stay `null`, known times preserved.
- **Role/source-type gates** — reader `author_paste` → 403; author
  `real_authorized` → 403; reader third-party link → `pending`.
- **Cross-user denial** — another user's private source and an unrelated
  researcher's controlled source both return 404; admin can read; only the
  responsible researcher gains access after opening a case.
- **Weak verification** — manual default `pending`; researcher approve → 403;
  admin approve without evidence → 422; self-verification → 403; a second user
  on an already-verified source → 409; approving binds the open case.
- **Consent** — researcher/admin cannot grant (403); unverified author grant
  keeps `private_only`; verified author grant flips `public_approved`.
- **Consent revocation** — public story 404 and removed from the list
  immediately; `permission_status = 'revoked'`; `external_model_processing`
  revoke cancels an in-flight job and its `complete()` returns false.
- **Interest** — 5 concurrent follows → one row; cancel then restore reuses the
  row; team cohort, author self-interest and `test_fixture` sources are marked
  `excluded`; `interest_changed` research events recorded.
- **Following** — only the caller's own rows; content disappears (still listed
  as unavailable) once the source stops being public; no private text leaks.
- **Cases** — one case per source; reader/unrelated author → 403; unauthorized
  source → case `hold` and invitation → 409; invitation recorded once,
  idempotent, never sent; non-assignee researcher → 404; forwarded invitation
  cannot decide (404); decline sets `decline_flag`, flips the invitation result
  and blocks both re-invitation and re-opening; `do_not_contact` distinct.
- **OpenAPI** — all 14 business routes documented; `/api/sources/{id}/analyze`
  deliberately absent.

### Database isolation

Tests use `TEST_DATABASE_URL` → `andthen_test_business`, created inside the
existing compose container (`docker exec andthen-db-1 psql -U andthen -d postgres
-c "CREATE DATABASE andthen_test_business"`). The main `andthen` database and
other agents' databases were never truncated or reset.

## 4. Interface constraints for later worktrees

These are the contracts the AI / interviews / publish worktrees must respect.
They are implemented against the frozen `src/db/schema.ts`; no new migration was
needed.

1. **Story id is the source id.** `GET/PUT /stories/:id` operate on
   `sources.id`, so interest stays keyed by `(reader_key, source_id)`.
2. **Public visibility gate** (`isPubliclyVisible`): a source is public only
   when `sources.permission_status = 'public_approved'` **and** no
   `demo_public_display` consent row is `revoked`. Revoking consent therefore
   invalidates public reads even if the publish module has not yet updated
   `permission_status`.
3. **Public projection** reads `followup_cases.status = 'published'` joined to
   `followup_versions.id = followup_cases.published_version_id` with
   `followup_versions.status = 'published'`; it projects only
   `statements[].visibility === 'public'` as `{ id, text, kind }`. The publish
   module owns writing those rows.
4. **Notifications** are created by the followups/publish module. `GET
   /me/following` only *reads* `notifications` by `(reader_key,
   followup_version_id, status = 'unread')` to set `has_unread`; it never
   creates them.
5. **AI job cancellation convention:** to make `external_model_processing`
   revocation cancel in-flight AI work, an AI job's `payload` must contain
   `source_id` (top-level). Revocation runs
   `update jobs set status='cancelled' … where payload->>'source_id' = $1`.
   A cancelled `running` job can no longer commit (the `complete()` fence fails).
6. **Case binding:** `followup_cases.author_user_id` is set when the author
   self-imports (`author_paste`) or when an admin approves a verification. The
   decision endpoint only accepts `request.auth.userId === author_user_id`.
7. **Invitations:** at most one per case; only the responsible researcher
   (`created_by_user_id`) or an admin may record one; blocked when
   `decline_flag`/`do_not_contact` is set or the source is unauthorized.
8. **Researcher scoping:** a researcher reaches a source only if they imported
   it or created a case for it; an admin may read but can never grant consent
   (`POST /sources/:id/consents` is author-only).
9. **Excluded cohorts:** `team`, `test`, `demo`, `internal`, `fixture`,
   `pressure_test`; author self-interest and `test_fixture` sources are also
   marked `excluded`. Public counters are not exposed anywhere by these routes.

## 5. Blockers / open items

1. **No shared-contract change.** `docs/contracts.md` was not edited (out of
   scope). If the orchestrator wants these routes listed there, that is a
   main-control edit. No frozen interface changed.
2. **Suitability gating (`candidate → eligible/hold`) is not owned here.** The
   AI/research worktrees produce the safety/eligibility decision; a case on an
   unauthorized source starts as `hold` and cannot be invited until its
   permission is sufficient.
3. **Consent is the display license.** There is no separate
   permission-approval endpoint in this scope; a source becomes
   `public_approved` only through a verified author's `demo_public_display`
   consent. If a reviewer needs a researcher-driven permission flip, add it as
   a new route in a later worktree.
4. **Anonymous reader interest** is not supported: `PUT /stories/:id/interest`
   requires a bearer session and uses `auth.userId` as `reader_key`. A
   first-party anonymous session id would need an identity-module change.
5. **AI not configured** (`LLM_*` empty). Nothing in this worktree calls a
   model; `POST /sources/:id/analyze` is the AI module's route.
