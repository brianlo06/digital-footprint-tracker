# ADR 0001: System Architecture

**Status:** Accepted

## Context

The product starts small but eventually needs asynchronous provider calls. Its highest early costs are privacy/security and provider volatility, not throughput.

## Decision

Use a modular TypeScript monolith: Next.js web/server, PostgreSQL, and a separately runnable same-repository worker when scanning exists. Keep core policy independent of transports/providers.

## Alternatives Considered

Next.js plus dedicated API; event-driven serverless components; microservices; day-one monorepo.

## Advantages

One language, coherent local setup and telemetry, fewer credentials/deployments, low cost, clear extraction seams.

## Disadvantages

Shared release/dependency lifecycle; discipline is needed to preserve boundaries; persistent work may require a second deployment.

## Consequences

No cross-service auth or distributed transaction system initially. Provider and job interfaces must remain framework-neutral. `src/` modules precede `apps/packages` extraction.

## Revisit Conditions

Independent team/release/scaling/security boundaries, a second client/public API, or measured runtime incompatibility.
