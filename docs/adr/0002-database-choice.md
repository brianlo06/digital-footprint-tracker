# ADR 0002: Database Choice

**Status:** Accepted

## Context

Identity ownership, verification, jobs, findings, observations, remediation, consent, and deletion require relationships, transactions, constraints, and temporal queries.

## Decision

Use PostgreSQL as the authoritative store and Drizzle for explicit TypeScript schema/query/migration tooling. Use JSON only for small, validated extension metadata and keep policy outside ORM models.

## Alternatives Considered

Document database; SQLite as production store; event store; multiple specialized stores; Prisma ORM.

## Advantages

Strong integrity/transactions, mature indexing and operations, relational deletion, adequate JSON, broad hosting portability.

## Disadvantages

Schema migrations and connection management; job polling adds load; encrypted fields limit database querying.

## Consequences

Use keyed lookup tokens for equality, not plaintext. Do not retain arbitrary provider responses in JSON tables. Local PostgreSQL is the fidelity target. Drizzle Kit remains development-only and its Studio/development server must never be network-exposed.

## Revisit Conditions

A proven isolated workload cannot meet requirements in PostgreSQL; convenience or hypothetical scale is insufficient.
