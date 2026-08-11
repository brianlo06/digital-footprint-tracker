# Architecture Decision Records

The owner authorized the Phase 1 foundation after Phase 0 review. Decisions now exercised by that foundation are **Accepted**; provider, temporal evidence, and job decisions remain **Proposed** until their phases begin. Supersede accepted records rather than silently rewriting their intent.

| ADR                                                 | Status   | Decision                                                 |
| --------------------------------------------------- | -------- | -------------------------------------------------------- |
| [0001](0001-system-architecture.md)                 | Accepted | modular monolith and worker-ready boundary               |
| [0002](0002-database-choice.md)                     | Accepted | PostgreSQL and Drizzle                                   |
| [0003](0003-provider-adapter-pattern.md)            | Proposed | provider anti-corruption layer                           |
| [0004](0004-identifier-storage.md)                  | Accepted | hybrid, application-encrypted identifier storage         |
| [0005](0005-background-job-strategy.md)             | Proposed | database-backed durable jobs first                       |
| [0006](0006-finding-observation-model.md)           | Proposed | stable findings plus immutable observations              |
| [0007](0007-user-verification-model.md)             | Accepted | verification-gated capability policy                     |
| [0008](0008-pii-logging-policy.md)                  | Accepted | deny-by-default PII telemetry policy                     |
| [0009](0009-authentication-boundary.md)             | Accepted | managed auth adapter plus local-only development mode    |
| [0010](0010-destructive-action-reauthentication.md) | Accepted | fail-closed reauthentication gate for account deletion   |
| [0011](0011-retention-maintenance.md)               | Accepted | bounded, idempotent retention batches without scheduling |
| [0012](0012-postgresql-row-level-security.md)       | Accepted | application checks plus RLS before shared preview        |
| [0013](0013-distributed-action-rate-limits.md)      | Accepted | database-atomic user and network mutation limits         |
| [0014](0014-email-verification-gateway.md)          | Accepted | delivery-independent verification challenge boundary     |
| [0015](0015-bounded-identifier-key-rewrap.md)       | Accepted | bounded, restart-safe identifier KEK rewrap              |
| [0016](0016-lookup-key-rotation.md)                 | Proposed | coordinated multi-domain lookup-key rotation             |
| [0017](0017-verification-delivery-outbox.md)        | Proposed | encrypted idempotent verification delivery outbox        |
