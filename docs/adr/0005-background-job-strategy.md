# ADR 0005: Background Job Strategy

**Status:** Proposed

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
