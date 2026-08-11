# ADR 0007: User Verification Model

**Status:** Accepted

## Context

The same discovery features that help users can enable stalking, employment screening, doxxing, and identity theft. App authentication does not prove control of a queried identifier.

## Decision

Grant scan capabilities based on identifier-specific, expiring verification: email link/code; DNS TXT or web challenge; OAuth/in-profile proof where available. Names are never exclusively verifiable. Consent is separate and versioned.

## Alternatives Considered

Terms-only self-attestation; payment/identity-document verification; unrestricted inputs; manual staff verification.

## Advantages

Strong technical barrier, explainable authority, supports least-capability access and audit.

## Disadvantages

Friction, accessibility/delivery cost, control can transfer, not all identifiers can be proven.

## Consequences

Unverified identifiers get limited/manual features. Challenges are non-descriptive, hashed, single-use, expiring, attempt-limited and periodically revalidated. The local foundation atomically revokes a challenge after five invalid attempts; production delivery also requires distributed abuse throttles. No document-ID collection.

## Revisit Conditions

Family/delegation/minor accounts, authorized-agent removal, or new provider scope requires a separate authority model.
