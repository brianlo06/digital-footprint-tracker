# Retention Maintenance

**Status:** Phase 1 bounded service and local least-privileged database capability implemented; no scheduler, CLI, deployment, or production invocation exists.

## Purpose

`runRetentionMaintenance` calls one bounded PostgreSQL security-definer function that reduces retained privacy/security metadata in a single transaction. It exists now so retention semantics and database authority are executable and testable before an operations platform is chosen.

The maintenance login role cannot access protected tables directly. It can execute only the retention function. That function is owned by a non-login role with narrowly granted operations on verification, deletion-receipt, audit, and rate-limit tables. The web runtime role cannot execute it.

## Eligible records

| Record                          | Eligibility                                                      | Action                                                        |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Pending identifier verification | `expires_at <= now`                                              | mark `EXPIRED` and replace the challenge hash with `consumed` |
| Deletion receipt                | `COMPLETED` and `expires_at <= now`                              | delete permanently                                            |
| Orphan audit event              | `user_id IS NULL` and older than the configured retention period | delete permanently                                            |
| Rate-limit window               | Internal `expires_at <= now`                                     | delete permanently; no raw subject or IP exists               |

Failed, requested, or auth-revoked deletion receipts are deliberately retained because they may represent unfinished deletion work. Active-user audit events are not touched. Verification history remains until account deletion, but the challenge secret is destroyed at expiry.

## Bounds and concurrency

- One call processes 1–1,000 records per category, including expired limiter windows; the default is 100.
- A transaction prevents partial changes within a batch.
- State predicates make overlapping calls idempotent: only still-pending challenges are expired, and already-deleted rows cannot be returned twice.
- Candidate rows are locked with `FOR UPDATE SKIP LOCKED`, so overlapping invocations avoid waiting on the same batch.
- PostgreSQL rejects null/unbounded batches, clocks more than five minutes in the future, and orphan-audit cutoffs newer than the one-day minimum.
- The supplied clock makes retention tests deterministic.
- The function returns counts only; no identifier values or subject tokens are emitted.

## Failure semantics

A database failure rolls back the batch and should be retried later with bounded backoff. No record is interpreted as deleted unless its database delete returns successfully. Operations must alert on repeated failures and growing eligible-record age, not on PII-bearing labels.

## Production gate

Before scheduling this service, reproduce and inspect the local function-only roles in the hosted database; select an invocation mechanism, metrics, alert thresholds, runbook, legal retention values, backup/tombstone behavior, and deployment ownership. Keep `MAINTENANCE_DATABASE_URL` out of the web runtime. Scheduling it is a separate Phase 1 production-readiness decision and must not be coupled to provider jobs.
