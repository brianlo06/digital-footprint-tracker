# ADR 0006: Finding and Observation Model

**Status:** Accepted on 2026-08-29 with the owner's Phase 3 approval, for synthetic-only implementation. The generic `Finding`/`Observation` persistence, versioned fingerprints, and presence rules may be built against synthetic provider evidence; no live provider, real personal data, or hosted activation is authorized by this record.

## Context

Online exposure appears, disappears, and reappears. Overwriting a result loses remediation proof and makes provider outages look like removal.

## Decision

Represent a stable deduplicated `Finding` and append immutable `Observation` events with present/missing/indeterminate state, provider run, evidence, and time.

## Alternatives Considered

One mutable result row; full event sourcing; storing raw scan snapshots only.

## Advantages

Clear history, reappearance, trend comparison, provider provenance, and remediation verification without full event-sourcing complexity.

## Disadvantages

More rows/state rules; absence thresholds and comparable coverage need care.

## Consequences

Timeout/outage is indeterminate, never missing. Fingerprints are versioned. Cross-provider equivalence groups rather than blindly merges findings.

## Revisit Conditions

Observation volume requires partition/rollup, or validated domain rules require provider-specific presence policies.
