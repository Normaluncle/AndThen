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

## End-user account closure

`POST /api/me/account-deletion` accepts a reader or author session. The client must first generate and save a random UUID `receipt_id` and a cryptographically random `receipt_secret` (at least 32 characters; use 32 random bytes encoded as hex), then submit:

```json
{"receipt_id":"<saved-uuid>","receipt_secret":"<saved-random-secret>","confirms_account_and_content_deletion":true}
```

HTTP 200 means the database transaction erased identity/login credentials, reader activity, author-owned/imported sources and their derived content, and cancelled/scrubbed associated jobs. Other authors' independent sources remain available. Staff researcher/admin accounts are excluded from self-service closure because their assigned materials require a controlled handover.

The old session stops working. Query `GET /api/deletion-receipts/:id` with `Authorization: Bearer <receipt_secret>` to read only the content-free receipt, including after a lost completion response. This secret cannot log in or operate business APIs; only its hash is stored. Another user's session or wrong secret returns 404. Save the ID/secret before sending, since a successfully deleted account cannot authenticate a retry. An unknown receipt can mean the transaction has not committed yet; retry the receipt query before another destructive request.

For this local Demo, account cleanup takes brief exclusive business-table locks and commits atomically. It makes no model/network request inside those locks. Lock waits are bounded, deadlocks retried up to twice; a busy failure returns 503 and rolls back. This may briefly delay other writes and is not a large-scale deletion architecture. Authenticated interest/research writes recheck the account inside their transactions, preventing a pre-resolved but deleted user from reappearing in text-keyed activity tables. Database foreign keys protect other credential/content relationships.

## Receipts and current limits

`DELETE /api/interviews/:id` requires the verified interview owner and body `{"confirms_deletion_and_withdrawal":true}`. It completes in a source-locked transaction and returns HTTP 200 with a succeeded receipt. It removes the interview/messages, related model results/job caches and derived version content. Affected publications are withdrawn and their notifications/outbox entries removed. Version numbers/hashes remain content-free receipts. The source snapshot is retained; source deletion is a separate operation. Repeated deletion returns the same receipt. In-flight model output cannot recreate the removed interview. The explicit confirmation covers removal of published content derived from this interview.

`GET /api/deletions/:id` returns status, content-free cleanup steps and completion time to the requesting session owner only. It never returns erased content. The source receipt distinguishes active-store cleanup from independent model-provider retention and backup rotation.

`reader_activity` deliberately preserves credentials; whole-account closure uses its dedicated endpoint above. Standalone case deletion is not exposed; source deletion covers contained case material. Interview deletion uses its dedicated endpoint. Backup copies follow the managed rotation/operator policy in `docs/retention.md`; no remote model-provider deletion API is implemented.

Verification: `tests/business/reader-deletion.test.ts` exercises concurrent replay, ownership isolation, explicit confirmation, preservation of subsequent activity, continued source availability and old outbox replay after re-following. `tests/business/interviews.test.ts` exercises the source deletion chain and receipt.
