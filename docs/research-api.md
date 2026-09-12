# Research API

All routes use the standard `request_id/status/data` envelope and server-stored bearer sessions. This API records observations; it does not recruit participants or send invitations.

## Record observation

`POST /api/research/events`

```json
{"source_id":"<uuid>","event_type":"source_view","client_event_id":"<unique-per-user>","prompted":false}
```

Allowed types are `source_view`, `followup_view`, and `feedback`. A followup view requires `followup_version_id` identifying the currently published version on the same source. Feedback requires `feedback: useful | not_useful | uncertain`. Other properties, including client-provided identities, roles, cohorts and arbitrary event names, are rejected. The source must currently be publicly authorized.

Replay of an identical `client_event_id` returns the existing event; reuse with different data returns 409. Client event IDs are scoped per authenticated user. The persisted observation time is server time.

Response data: `event_id`, `deduped`, `excluded`. Exclusions include non-reader roles, authors, test/internal/unassigned cohorts, prompted events, and every source whose provenance is not `real_authorized`. Thus an external-cohort reader viewing a test fixture is still excluded.

## Export aggregates

`GET /api/research/export?source_id=<uuid>`

Only an administrator or the importing/assigned researcher may export the source. The response includes per-cohort unique source viewers, active natural followers, viewers matched to active followers, feedback observation counts, excluded event counts, and invitation observation-window counts. No raw user identifiers, credentials, source text, interview answers, or draft text are exported. Each export gets a fresh identifier and generation timestamp; no export file is retained by the server.

`exposure_to_active_interest_ratio` is distinct observed viewers who currently follow divided by distinct eligible source viewers. Missing denominators return `null`. This is a snapshot of current interest, not a causal or platform-wide conversion estimate. Feedback counts are observations, not unique respondents.

Invitation records with a future or absent observation deadline remain outside the completed-window denominator. Test sources have zero eligible invitation denominator and a null ratio. Acceptance uses the current recorded outcome among completed-window records: no response timestamp exists yet, so this does not establish whether acceptance occurred before the deadline. It must not be presented as a fixed-window response rate.

Evidence: `tests/business/research.test.ts` exercises duplicate concurrency, schema rejection, scope isolation, author/test/prompted exclusion, null denominators and content-free export using synthetic data in isolated PostgreSQL databases. These are engineering tests, not a real participant trial.
