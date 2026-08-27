# Retention Maintenance

**Status:** Phase 1 bounded service, local least-privileged database capability, and isolated Cloudflare Cron Worker are implemented; hosted deployment awaits a hosted database and owner-approved retention periods.

## Purpose

`runRetentionMaintenance` calls one bounded PostgreSQL security-definer function that reduces retained privacy/security metadata in a single transaction. `workers/retention.ts` invokes the same core operation from a separate Worker, never from the web Worker.

The maintenance login role cannot access protected tables directly. It can execute only the retention function. That function is owned by a non-login role with narrowly granted operations on verification, deletion-receipt, audit, and rate-limit tables. The web runtime role cannot execute it.

## Eligible records

| Record                          | Eligibility                                                                          | Action                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pending identifier verification | `expires_at <= now`                                                                  | mark `EXPIRED` and replace the challenge hash with `consumed`                                                                                                          |
| Deletion receipt                | `COMPLETED` and `expires_at <= now`                                                  | delete permanently                                                                                                                                                     |
| Orphan audit event              | `user_id IS NULL` and older than the configured retention period                     | delete permanently                                                                                                                                                     |
| Rate-limit window               | Internal `expires_at <= now`                                                         | delete permanently; no raw subject or IP exists                                                                                                                        |
| Terminal scan job               | `COMPLETED`/`DEAD_LETTERED`/`CANCELLED` and older than the scan-job retention period | delete permanently; opaque payload references, lease history, and safe error codes age out while the scan/provider-run/finding summary is retained on its own schedule |

Failed, requested, or auth-revoked deletion receipts are deliberately retained because they may represent unfinished deletion work. Active-user audit events are not touched. Verification history remains until account deletion, but the challenge secret is destroyed at expiry. Pending and claimed scan jobs are never touched: only terminal job detail ages out, matching the completed scan/job row of the privacy retention table, and the user-visible scan history summary is unaffected.

## Bounds and concurrency

- One call processes 1–1,000 records per category, including expired limiter windows; the default is 100.
- A transaction prevents partial changes within a batch.
- State predicates make overlapping calls idempotent: only still-pending challenges are expired, and already-deleted rows cannot be returned twice.
- Candidate rows are locked with `FOR UPDATE SKIP LOCKED`, so overlapping invocations avoid waiting on the same batch.
- PostgreSQL rejects null/unbounded batches, clocks more than five minutes in the future, and orphan-audit or scan-job cutoffs newer than the one-day minimum.
- The supplied clock makes retention tests deterministic.
- The function returns counts only; no identifier values or subject tokens are emitted.

## Failure semantics

A database failure rolls back the batch and should be retried later with bounded backoff. No record is interpreted as deleted unless its database delete returns successfully. Operations must alert on repeated failures and growing eligible-record age, not on PII-bearing labels.

## Cloudflare invocation boundary

`wrangler.retention.example.jsonc` is a deployment template for a daily 04:00 UTC Cron Trigger. Before deployment, copy it to an environment-owned configuration and replace the all-zero Hyperdrive placeholder with a configuration whose origin credential is the function-only maintenance login.

- The Worker has no route and returns 404 if fetched directly.
- It creates one short-lived Postgres.js client per invocation and always closes it.
- Scheduled time, batch size, and orphan-audit period are parsed and bounded before a database client is constructed, then bounded again in the maintenance core and PostgreSQL; unsafe integers and date-range overflow fail with stable codes.
- Its Hyperdrive binding is distinct from the web runtime binding; no owner or runtime credential is available.
- It emits no application log. Cloudflare Cron Events and aggregate Worker analytics provide invocation success/failure without request bodies, identifiers, or database results.
- `npm run cf:retention:build` dry-builds the Worker in CI without provisioning or invoking a database.

## Production gate

Before deploying the schedule, reproduce and inspect the function-only roles in the hosted database; approve legal retention values, backup/tombstone behavior, alert thresholds, and deployment ownership. Keep the maintenance Hyperdrive binding out of the web Worker. The current proposed defaults are 15 minutes for pending challenge secrets, 365 days for completed pseudonymous receipts and orphan audit events, and 90 days for terminal scan-job detail; these are engineering defaults, not legal approval.
