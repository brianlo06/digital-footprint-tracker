# ADR 0013: Distributed Protected-Action Rate Limits

**Status:** Accepted

## Context

Per-record verification lockout does not limit repeated onboarding, identifier enrollment, deletion, or distributed attempts across records. In-memory counters diverge across instances and disappear on restart. Raw IP storage would create avoidable sensitive telemetry, while blindly trusting forwarding headers lets clients choose their own network scope.

## Decision

Consume fixed per-user and shared-network policies in one PostgreSQL security-definer function before form validation on every protected mutation. HMAC-tokenize the authentication subject and trusted ingress IP under separate namespaces before persistence. Give the web role function execution but no table access; own the function with a non-login, narrowly granted RLS-bypass role. Force RLS with no direct policy on limiter state and delete expired rows through bounded retention.

Local mode uses one synthetic network. Preview and production fail closed until a single-value client-IP header rewritten by trusted ingress is explicitly configured.

## Alternatives Considered

Per-instance memory; provider/edge-only limits; raw IP rows; `X-Forwarded-For` parsing; user-only throttling; Redis before a measured need.

## Consequences

Concurrent instances share atomic counters without another service. Raw scope values are absent from the database. Shared networks can create false positives, an uncoordinated lookup-key change resets pseudonymous scopes, and the database is now on the mutation hot path. Limits require hosted calibration and are progressive friction, never proof of abuse. Proposed [ADR 0016](0016-lookup-key-rotation.md) requires atomic old/new consumption across a coordinated rotation so counters do not reset.

## Revisit Conditions

Measured contention, a trusted edge limiter with equivalent global semantics, multi-region PostgreSQL latency, IPv6/network behavior causing material false positives, or provider-cost budgets requiring another store.
