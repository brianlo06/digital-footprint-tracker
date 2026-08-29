# ADR 0005: Background Job Strategy

**Status:** Accepted on 2026-08-29. The synthetic Phase 2 queued scan workflow exercises this decision: the `scan_jobs` table with expiring leases, transactional enqueue, at-least-once delivery with idempotent handlers, jittered bounded retry, pre-claim cancellation, dead-lettering, cost reservation, and separately persisted scan/provider-run state. Hosted deployment of the recovery Cron Worker remains blocked by the activation gates in `../BREACH_SCAN_WORKER_OPERATIONS.md`.

## Context

Provider calls are slow, rate-limited, failure-prone, billable, and unsuitable for request lifetimes. Initial volume is low.

## Decision

Use a PostgreSQL-backed outbox/job table with leases and a same-repository worker. Delivery is at least once; handlers are idempotent. Persist scan/provider state separately.

## Alternatives Considered

In-request calls; Redis/BullMQ; managed cloud queue/workflow; cron-only execution.

## Advantages

One dependency, transactional enqueue, easy local development, durable and inspectable state.

## Disadvantages

Polling/locking, limited advanced routing, risk of homegrown queue errors and DB contention.

## Consequences

Unique idempotency keys, lease expiry, jittered capped retry, `Retry-After`, cancellation, cost reservation, dead-letter/operator workflow, and queue metrics are required.

## Revisit Conditions

Measured database contention/queue lag, substantially higher throughput, or advanced routing/delay/isolation needs justify Redis or managed queue.
