# Business API — sources, consents, stories, cases

Owner: business worktree (`src/modules/sources`, `src/modules/cases`).
Scope: PRD FR-01..FR-06 (sources/interest/following), FR-10/FR-12 partial
(verification, consent), FR-07..FR-11 (cases, invitations, decisions).

All routes live under `/api`, use the frozen success/error envelope, return
`request_id`, and are validated by zod (body/params/query + OpenAPI response).
Roles, ownership, cohorts and consent are always resolved server-side.

## Route table

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/sources` | bearer | Idempotent import. Role/source-type gated. |
| GET | `/api/sources/:id` | bearer | Owner/importer, author, assigned researcher or admin. |
| GET | `/api/sources/:id/snapshots` | bearer | Same access as above. |
| GET | `/api/sources/:id/consents` | bearer | Readable source only. |
| POST | `/api/sources/:id/consents` | bearer | **Author only**; body `{ purpose, version? }`. |
| DELETE | `/api/sources/:id/consents/:purpose` | bearer | Author or admin. Takes effect immediately. |
| GET | `/api/sources/:id/author-verifications` | bearer | Readable source only. |
| POST | `/api/sources/:id/author-verifications` | researcher/admin | Weak manual evidence never auto-passes. |
| GET | `/api/stories` | public | Licensed stories; paginated. |
| GET | `/api/stories/:id` | public | `:id` is the **source id**. 404 when not licensed. |
| PUT | `/api/stories/:id/interest` | bearer | `{ active: boolean }`; unique per reader×source. |
| GET | `/api/me/following` | bearer | Caller's own following, public info only. |
| POST | `/api/cases` | author/researcher/admin | One case per source; declined cases never reopen. |
| GET | `/api/cases/:id` | bound author/assigned researcher/admin | 404 otherwise. |
| POST | `/api/cases/:id/invitations` | researcher/admin (assignee) | Records a human send; never sends. |
| POST | `/api/cases/:id/decision` | **bound author only** | `accept` \| `decline` \| `do_not_contact`. |

Not implemented here on purpose: `POST /api/sources/:id/analyze` (AI module),
`POST /api/cases/:id/interviews` (interviews module), publish/withdraw
(followups module).

## Key request/response shapes

### POST /api/sources

```jsonc
{
  "source_type": "author_paste",
  "original_url": "https://example.test/a/1",
  "original_account_ref": null,
  "title": "一段旧经历",
  "material_level": "exact_excerpt",
  "body": null,
  "excerpt": "当时我决定先完成这个项目。",
  "excerpt_location": "第 2 段",
  "published_at": "2021-03-01T00:00:00Z",
  "upstream_updated_at": null,
  "notes": null,
  "provenance": "test_fixture"
}
```

Response `data`:

```jsonc
{ "source_id": "…", "snapshot_id": "…", "version": 1,
  "permission_status": "private_only", "provenance": "test_fixture",
  "material_level": "exact_excerpt", "content_hash": "…", "deduped": false }
```

Rules:
- Role/source-type: `author` → `author_paste`/`third_party_link`; `researcher` →
  `official_search`/`researcher_import`/`third_party_link`; `reader` →
  `third_party_link` only; `admin` → any.
- `provenance: "real_authorized"` is rejected for non research/ops roles.
- `material_level: "exact_excerpt"` requires `excerpt`; a non-exact level must
  not carry `excerpt` (a summary can never masquerade as a verbatim quote).
- Missing times are stored and returned as `null`, never `0`/`now`.
- Idempotency: identical material → same `source_id`/`snapshot_id`,
  `deduped: true`, no new row. Different material → new `version`.
- URLs are registered only; nothing is fetched.

### GET /api/stories/:id

Public projection (no private fields, no author identity, no interview):

```jsonc
{ "story": {
  "source_id": "…", "title": "…", "source_type": "author_paste",
  "original_url": "…", "material_level": "exact_excerpt",
  "text": "当时我决定先完成这个项目。", "excerpt_location": "第 2 段",
  "published_at": "…", "upstream_updated_at": null, "acquired_at": "…",
  "provenance": "test_fixture",
  "published_followup": {
    "version_id": "…",
    "statements": [{ "id": "s1", "text": "…", "kind": "author_report" }],
    "confirmed_at": "…", "published_at": "…", "ai_assisted": true,
    "attribution": "author_reported"
  },
  "withdrawn": false
} }
```

Only `statements[].visibility === "public"` are projected. A story is returned
only when `sources.permission_status = 'public_approved'` **and** no
`demo_public_display` consent has been revoked.

### Consents

- Grant (`POST /api/sources/:id/consents`): **only the source author** (a
  self-imported `author_paste` creator or a verified author) may grant. A
  researcher or admin gets `403` — nobody signs on the author's behalf.
- Granting `demo_public_display` sets `permission_status = 'public_approved'`
  **only when the author is verified**. An unverified author's consent is
  recorded but the source stays `private_only`.
- Revoke (`DELETE /api/sources/:id/consents/:purpose`): author or admin.
  - `demo_public_display` → `permission_status = 'revoked'`; public reads fail
    immediately.
  - `external_model_processing` → cancels queued/running jobs whose payload has
    `source_id` equal to this source; a running job's `complete()` then returns
    false, so its result can never be committed.

### Author verification

```jsonc
{ "subject_user_id": "…", "method": "manual",
  "evidence_ref": "evidence://controlled/42", "scope": "this source only",
  "approve": true }
```

- Default `approve: false` → status `pending`.
- `approve: true` requires a controlled `evidence_ref` (422 otherwise).
- A `manual` record may only be approved by an `admin`; a researcher gets `403`.
- The acting user cannot verify themselves (`subject_user_id === auth.userId` →
  403). A login/session or invitation token is never evidence.
- Approving binds an open case's `author_user_id` to the verified subject.

## Errors used

`validation_error` (400), `forbidden` (403), `not_found` (404 — also used to
hide another user's private resource), `conflict` (409 — declined/re-invite,
state conflicts), `source_incomplete` (422), `consent_required` (422, reserved
for the publish path), `author_unverified` (422, reserved for the publish path).
