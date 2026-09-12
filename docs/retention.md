# Consent expiry and maintenance

Public display grants made through the consent API now expire after 90 days by default. Optional `expires_at` may request a shorter deadline; later requested dates are capped at 90 days. Other purposes may also specify a future deadline. `expires_at` is returned in consent grants/lists/revocations.

Consent version is the replay key. Repeating an active version preserves its original grant/deadline and does not extend it. Changed deadlines, expired consent and revoked consent require a new version. Renewal retires the previous active version; a historical revoked version does not block a new explicit grant.

Public reads and listing check deadlines immediately. Legacy public consents with null expiry stop authorizing display 90 days after grant. The worker starts a `maintenance.consents` job and schedules another at the next ten-minute boundary. It updates expired consent status, withdraws notification metadata when public permission has ended, cancels expired model/private-purpose AI work, and switches active interviews to manual mode. All writes hold source locks and job fences; repeated sweeps cannot restore authorization.

Maintenance also closes running AI audit metadata whose job no longer has a valid running lease. It stores no late model output. A failed sweep uses the durable queue retry policy; restarting the worker seeds maintenance again. Public access expiry does not depend on a live maintenance worker.

Verified using isolated PostgreSQL tests in `tests/business/consent-expiry.test.ts`: default deadline, replay preservation, shorter period, immediate public denial, new-version renewal, legacy deadline handling, notification status, orphan audit cleanup, and next-job scheduling.

Still pending: 30-day private-content physical retention cleanup and 30-day backup rotation/restore validation. This maintenance job expires permissions; it does not yet prove all private content and backups are erased within their policy periods. Source deletion already has a separate explicit cleanup job. External model retention depends on the independently configured provider; no remote deletion API is implemented.
