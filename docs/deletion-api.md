# Data deletion APIs

All authenticated requests use `Authorization: Bearer <session_token>` and the standard response envelope. No endpoint sends external messages or removes material manually published on another platform.

## Reader activity

`POST /api/me/data-deletion` requires a reader session and this strict body:

```json
{
  "scope": "reader_activity",
  "confirms_deletion": true,
  "idempotency_key": "erase-my-activity-1"
}
```

The Demo executes this bounded activity cleanup in one database transaction and returns HTTP 200 with `deletion_id`, `status: "succeeded"` and `scope: "reader_activity"`. It removes the requesting reader's prior interests, notifications, research events, activity audit records and response caches. It removes the reader from prior frozen publication recipients, so an old outbox event cannot re-notify them even if they later follow again. Author sources, other readers' records, login identity and credentials remain available.

The cutoff is recorded in the receipt. Subsequent reader actions are new activity. Replaying the same idempotency key returns the original receipt and does not delete newer activity; a new deletion operation needs a new key. Concurrent identical requests share a single receipt. The key is hashed in storage and is scoped to the authenticated user. Unknown scopes, client-supplied identities and missing confirmation are rejected.

## Author source

`DELETE /api/sources/:id` requires the source author or an administrator. It immediately blocks public/private source access and new model processing, revokes the source permissions and cancels related queued/running jobs. HTTP 202 returns `deletion_id` while the worker removes snapshots, interviews, drafts, publications and related derived records. An unrelated author or reader cannot delete a source. This endpoint is distinct from the reader-activity operation.

## Receipts and current limits

`GET /api/deletions/:id` returns status, content-free cleanup steps and completion time to the requesting session owner only. It never returns erased content. The source receipt distinguishes active-store cleanup from independent model-provider retention and backup rotation.

Whole-account closure (including identity and login credentials) is not implemented by `reader_activity`; neither are standalone case/interview deletion scopes exposed through this endpoint. These must not be presented as supported client options. Source deletion covers the contained author material. Backup copies follow the managed rotation/operator policy in `docs/retention.md`; no remote model-provider deletion API is implemented.

Verification: `tests/business/reader-deletion.test.ts` exercises concurrent replay, ownership isolation, explicit confirmation, preservation of subsequent activity, continued source availability and old outbox replay after re-following. `tests/business/interviews.test.ts` exercises the source deletion chain and receipt.
