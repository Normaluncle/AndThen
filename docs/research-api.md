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

## Export observations and aggregates

`GET /api/research/export?source_id=<uuid>`

The PRD path `GET /api/admin/research-export` is also available with the same authorization and query contract. Both accept optional `from` and `to` ISO 8601 timestamps with timezone, plus an exact `cohort` label. The event window is half-open `[from,to)`; omitted `from` includes all earlier records and omitted `to` means export time. Invalid/reversed bounds are rejected. More than 10,000 matching events is rejected with a request to narrow the window/cohort; data is never silently truncated.

`events` contains only allowlisted event type, cohort, UTC calendar date, exclusion flag and allowlisted feedback value. It omits user/event IDs, arbitrary properties, notes and sub-day timestamps. These are deidentified engineering observations, not a guarantee of anonymity in a small cohort. Aggregate distinct counts are computed server-side before identities are removed.

`window` echoes the normalized bounds/cohort and states `follower_state: current_at_export`. Followers are current active records, not reconstructed historical state; changing the event window does not make that count historical. Invitation date filters use `sent_at`, and invitation cohort uses the currently bound author's cohort. Event-cohort and author-cohort denominators must not be pooled. Internal/test/unassigned author cohorts are excluded from eligible invitation denominators.

Only an administrator or the importing/assigned researcher may export the source. The response includes per-cohort unique source viewers, active natural followers, viewers matched to active followers, feedback observation counts, excluded event counts, and invitation observation-window counts. No raw user identifiers, credentials, source text, interview answers, or draft text are exported. Each export gets a fresh identifier and generation timestamp; no export file is retained by the server.

`exposure_to_active_interest_ratio` is distinct observed viewers who currently follow divided by distinct eligible source viewers. Missing denominators return `null`. This is a snapshot of current interest, not a causal or platform-wide conversion estimate. Feedback counts are observations, not unique respondents.

Invitation records with a future or absent observation deadline remain outside the completed-window denominator. Test sources have zero eligible invitation denominator and a null ratio. The legacy `invitation_observations.current_acceptance_ratio` still describes current accepted outcomes and must not be presented as a fixed-window rate.

`fixed_invitation_windows` groups completed records by current author cohort and exact window duration. Its `acceptance_ratio` counts acceptance at or before the deadline, divided by records with interpretable timing. `late_responses`, `no_response`, `declined_in_window` and `other_responses_in_window` remain separate. An answer at the deadline is inside; after it is late. Missing/invalid timing on a recorded response increments `unknown_response_time` and excludes that record from the denominator. Invalid/nonpositive windows are counted separately. Different cohorts/durations are not pooled into a single rate.

Migration `0004` adds nullable `invitations.responded_at`. Bound-author accept/decline decisions record server time when advancing pending/no-response/replied invitations to a final outcome. Existing rows keep null; historical times are never backfilled by guessing. A response to a previously marked no-response invitation is still recorded, allowing late acceptance to remain distinguishable. No external invitation or author response was generated to test this; all evidence uses isolated fixtures.

Evidence: `tests/business/research.test.ts` exercises duplicate concurrency, schema rejection, scope isolation, author/test/prompted exclusion, null denominators, exact date boundaries, cohort filtering and omission of injected private properties using synthetic data in isolated PostgreSQL databases. These are engineering tests, not a real participant trial.
