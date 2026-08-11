# ADR 0011: Retention Maintenance

**Status:** Accepted

## Context

Privacy retention promises are not credible if they exist only in policy text. The foundation already creates expiring verification challenges, pseudonymous deletion receipts, and orphaned audit events, but no job platform or production retention period has been approved.

## Decision

Implement retention as a bounded, idempotent application service over PostgreSQL. Expire and consume stale pending challenges, permanently delete only expired completed deletion receipts, and delete orphan audit events after a configurable minimum period. Keep unfinished deletion receipts. Do not schedule or expose the service until operational ownership, legal periods, locking, metrics, and alerting are approved.

## Alternatives Considered

Database TTL extension; unbounded cron SQL; deletion embedded in user requests; retain everything until account deletion; wait for the future job system.

## Advantages

Executable retention semantics, deterministic testing, bounded load, safe retries, provider-independent operation, and no premature scheduler dependency.

## Disadvantages

No data ages out automatically until an invocation mechanism exists; application code owns lifecycle SQL; a single transaction per category batch may eventually need coordination at scale.

## Consequences

The local implementation uses a login role with function-only execution and a non-login security-definer owner with narrow table grants. The function fixes its search path, validates its batch bound, fully qualifies database objects, and uses row locks with `SKIP LOCKED` for overlap control. Failed/requested/auth-revoked deletion receipts are never removed by generic retention.

Production readiness still requires reproducing and inspecting those roles in the hosted database, sanitized metrics, oldest-eligible-age alerts, backup behavior, legal review, deployment ownership, and a runbook.

## Revisit Conditions

Measured batch contention, a managed database lifecycle feature with equivalent predicates/auditability, materially different legal periods, multiple storage systems, or the Phase 3 durable job platform.
