# ADR 0008: PII Logging Policy

**Status:** Accepted

## Context

Application, worker, provider, and exception telemetry can silently copy personal identifiers into broadly accessible, long-retained processors.

## Decision

Use deny-by-default structured telemetry schemas. Log opaque entity/run IDs and bounded event codes; never identifier values, query strings, response bodies, full URLs, secrets, tokens, or notification content. Audit records are separate.

## Alternatives Considered

Developer discretion; sink-only redaction; encrypted PII logs; full request/response debugging.

## Advantages

Smaller breach/processor/retention surface, predictable metrics, safer support.

## Disadvantages

Harder debugging and correlation; opaque IDs remain linkable personal data.

## Consequences

Central allowlisted logger, pre-export redaction, synthetic PII canaries, restricted access, short retention, and privacy-safe incident debugging are release gates.

## Revisit Conditions

Specific investigation data may be approved temporarily with purpose, field list, access, retention, encryption, and automatic expiry; the default does not change.
