# ADR 0003: Provider Adapter Pattern

**Status:** Proposed

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

## Revisit Conditions

Extend rather than bypass the pattern when multiple approved integrations prove a missing capability.
