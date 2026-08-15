# ADR 0003: Provider Adapter Pattern

**Status:** Accepted on 2026-08-15 for the Phase 2 provider boundary. Provider selection and activation remain separate approvals recorded in `../PHASE_2_READINESS.md`.

## Context

Provider APIs, prices, schemas, terms, health, and existence change. Core evidence must remain useful after a provider disappears.

## Decision

All external sources implement capability-based adapter contracts and emit normalized candidates plus provenance. A registry gates adapters by verification, consent, jurisdiction, health, feature flag, and budget. Adapters cannot write findings directly.

## Alternatives Considered

Provider-specific logic in routes/jobs; a universal scraper; one permanent provider schema; integration microservices.

## Advantages

Replaceability, uniform security/cost/retention gates, contract testing, partial-failure handling, stable internal model.

## Disadvantages

Abstraction design effort and risk of hiding provider-specific semantics.

## Consequences

Stable provider IDs, parser versions, health states, error taxonomy, cost estimates, bounded responses, and kill switches are mandatory. Extension data stays owned by the adapter.

No accepted adapter architecture authorizes a provider call. A provider remains disabled until its dated contract, privacy, security, budget, test, and rollback evidence is approved. Unknown or absent budgets fail closed, and adapters reject response fields outside their capability-specific allowlist.

## Revisit Conditions

Extend rather than bypass the pattern when multiple approved integrations prove a missing capability.
