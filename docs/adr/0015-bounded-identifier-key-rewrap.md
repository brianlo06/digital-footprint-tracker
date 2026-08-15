# ADR 0015: Bounded Identifier Key Rewrap

**Status:** Accepted  
**Date:** 2026-08-11

## Context

The single-envelope cryptographic primitive can rotate a key-encryption key without materializing identifier plaintext, but production operations also need bounded execution, restart safety, rollback, and database authority narrower than the owner or web role.

## Decision

Add a batch service that selects envelopes by source key ID and rewraps no more than 1,000 per call. Persist replacements through a database compare-and-swap function that validates the envelope format and requires ciphertext, value nonce, and authentication tag to remain unchanged.

Use a function-only login for operational access. Its security-definer functions are owned by a narrowly granted non-login `NOBYPASSRLS` role named by an exact fixed-role capability policy. Keep dry-run non-mutating, make interruption recovery implicit through source-key selection, and use the same mechanism in reverse for rollback while the prior key remains available.

Reject any replacement keyring whose lookup key differs. Deterministic lookup-token rotation remains a separate approval and migration because it requires controlled access to normalized plaintext and coordinated uniqueness/cutover behavior.

## Consequences

Local integration tests can exercise batch rewrap, resume, and rollback without granting direct table access or decrypting identifier values in the rotation service. Operators must retain both KEKs during the migration and rollback window. A production KMS, cloud IAM, monitored invocation, reconciliation, and lookup-token rotation procedure remain release gates.
