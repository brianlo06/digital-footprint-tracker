# Scan and Evidence Operations

**Status:** Runbook for the synthetic-only scan pipeline. Nothing here is deployed; every hosted activation remains gated by the approvals in `PHASE_2_READINESS.md` and `BREACH_SCAN_WORKER_OPERATIONS.md`.

This is the Phase 3 operations runbook. It covers what the scan pipeline does, what each state means, how to read a stuck or failing scan, and what an operator may and may not conclude from the data.

## Pipeline at a glance

```text
Server Action → scans(QUEUED) + scan_jobs(PENDING)   [one transaction]
              → post-response dispatch, or Cron recovery
              → claim lease → scan_jobs(CLAIMED), scans(RUNNING)
              → authorize → reserve usage → provider call
              → provider_runs + breach_findings + findings/observations
              → scans(COMPLETED | PARTIAL | FAILED), scan_jobs(COMPLETED | PENDING retry | DEAD_LETTERED)
```

Every step runs inside the tenant's row-level security context. A provider is only ever reached after account, identity, identifier, verification-freshness, consent, quota, and kill-switch checks all pass.

## State reference

### `scans.state`

| State       | Meaning                                                                | Operator action                                          |
| ----------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `QUEUED`    | Enqueued; no provider work has started                                 | none; the user may still cancel                          |
| `RUNNING`   | A job holds a lease and may have dispatched                            | none; wait for the lease to complete or expire           |
| `COMPLETED` | Provider answered and reported `HEALTHY`                               | none                                                     |
| `PARTIAL`   | Provider answered but reported degraded health; coverage is incomplete | investigate provider health before trusting completeness |
| `FAILED`    | Terminal failure; a safe code is recorded on the provider run          | read the safe code below                                 |
| `CANCELLED` | User cancelled before the job was claimed                              | none                                                     |

### `scan_jobs.state`

| State           | Meaning                                            | Recovery                                                    |
| --------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `PENDING`       | Due at `not_before`; retries land back here        | the next dispatch or Cron invocation claims it              |
| `CLAIMED`       | Leased until `lease_expires_at`                    | on lease expiry a later invocation reclaims it              |
| `COMPLETED`     | Terminal success                                   | none                                                        |
| `DEAD_LETTERED` | Attempts exhausted or a non-retryable safe failure | inspect `last_error_safe_code`; the user may run a new scan |
| `CANCELLED`     | Cancelled before claim                             | none                                                        |

Only `PENDING` work can be cancelled. Once a job is claimed the product never tells a user their scan was stopped, because the provider call may already have gone out.

## Reading a failure

Failures are recorded as fixed safe codes. They never contain an identifier, a provider payload, a URL path, or a raw error.

| Safe code                       | Cause                                                           | Operator action                                                         |
| ------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `PROVIDER_DISABLED`             | Kill switch on, flag off, or provider removed from the registry | expected during rollback; confirm it was intentional                    |
| `VERIFICATION_STALE`            | Identifier was not verified within 24 hours of the scan clock   | user re-verifies; never widen the window to make a scan pass            |
| `CONSENT_*`                     | Consent missing, withdrawn, or the wrong purpose/scope          | user re-grants on the privacy page; never synthesize consent            |
| `USER_DAILY_REQUEST_LIMIT`      | Per-user quota exhausted                                        | wait for the next day; do not raise a user's cap to clear one complaint |
| `PROVIDER_*_LIMIT`              | Global provider quota exhausted (cross-tenant by design)        | check for runaway usage before considering a budget change              |
| `PROVIDER_TIMEOUT`              | Retryable provider timeout                                      | none; bounded retry handles it                                          |
| `PROVIDER_RATE_LIMITED`         | Retryable provider rate limit                                   | none; retry backs off                                                   |
| `PROVIDER_AUTHORIZATION_DENIED` | Credential or permission problem                                | treat as an incident: stop, do not retry, follow rollback               |
| `SCAN_JOB_LEASE_EXHAUSTED`      | Lease expired with attempts exhausted                           | investigate why the processor kept dying mid-lease                      |
| `PROVIDER_SCAN_FAILED`          | Unclassified failure reduced to a safe code                     | correlate by opaque job ID in Worker logs                               |

## Stuck-work triage

1. **A scan sits in `RUNNING`.** Check its job's `lease_expires_at`. Before expiry this is normal. After expiry, the next dispatch or Cron invocation reclaims it; if nothing reclaims it, the recovery Worker is not running (expected today — it is not deployed).
2. **Jobs accumulate in `PENDING` with a future `not_before`.** That is retry backoff, not a stall.
3. **A user cannot start a scan.** In order, check: a verified email exists, breach consent is granted for the exact policy version, no `QUEUED`/`RUNNING` scan already exists for the capability, the environment gates are open, and the quotas are not exhausted. The UI reports each of these as a distinct message.
4. **Every scan fails immediately with `PROVIDER_DISABLED`.** One of the three independent gates is closed. This is the intended resting state outside local development.

Never resolve a stuck scan by editing rows directly. Cancel or let the lease expire; the state machine is the only supported writer.

## Temporal evidence

Findings are stable and deduplicated by a versioned fingerprint; observations are append-only and record what each provider run saw.

- **A finding never disappears because a scan failed.** Absence is only interpreted when a scan completes against a healthy provider. A failed or partial scan records `INDETERMINATE`, which changes nothing.
- **Resolution requires repeated evidence.** A finding is marked `RESOLVED` only after two consecutive confirmed absences.
- **Reappearance is preserved, not overwritten.** A later presence marks the finding `REAPPEARED` and keeps its full observation history.
- **User decisions win.** Automatic rules never overwrite a status the user set.

When investigating a disputed finding, read its observation chain rather than its current state alone: the chain shows every check, including the ones that proved nothing.

## Retention interaction

Observation history ages out at 24 months, but each finding always keeps its most recent observation, so no finding is ever left with no evidence explaining its state. Terminal scan-job detail ages out at 90 days while the scan/provider-run summary is retained. Findings are never deleted by retention — only by account deletion. See `RETENTION_OPERATIONS.md`.

## What an operator must not conclude

- A finding is **not** proof that an account is currently compromised.
- No finding is **not** proof of absence; it means nothing was observed through the enabled provider at that time.
- A `COMPLETED` scan is **not** proof of comprehensive coverage. Coverage is bounded by the single enabled provider and its own catalog.
- Provider-reported metadata is **not** correctable by this product. Users can reject a finding here; the provider's source data is the provider's to fix.

## Rollback

The provider kill switch, credential revocation, queued-work cancellation, registry removal, and data disposition are covered by the recorded rollback order in `PHASE_2_READINESS.md`, which is exercised end to end by `tests/integration/breach-scan-rollback.test.ts`.
