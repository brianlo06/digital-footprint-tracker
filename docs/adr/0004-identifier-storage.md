# ADR 0004: Identifier Storage

**Status:** Accepted

## Context

Server-authorized scans need identifier plaintext briefly, while database compromise would make plaintext storage dangerous. Fully client-side encryption conflicts with background work and recovery.

## Decision

Envelope-encrypt restricted identifier values at application level; store a versioned keyed HMAC lookup token; do not persist normalized plaintext. Prohibit credentials, government IDs, facial embeddings, and unnecessary sensitive fields. Use ephemeral payload processing.

## Alternatives Considered

Database encryption only; plaintext; fully client-side/zero-knowledge; entirely ephemeral identifiers.

## Advantages

Practical scanning with meaningful DB theft protection, rotation, deterministic equality, and field-level deletion.

## Disadvantages

Application plus KMS compromise can decrypt; key operations and migrations are complex; metadata remains.

## Consequences

Decrypt permissions are purpose/job scoped; ciphertext uses authenticated context and key version; logs/jobs reference IDs. Key-encryption-key rotation rewraps only the random data key without materializing identifier plaintext. Lookup-key rotation is a separate coordinated migration because it changes deterministic tokens. A future client-encrypted vault is separate.

## Revisit Conditions

Product promise changes to zero knowledge, scheduled/server processing is dropped, or key-threat analysis requires stronger compartmentalization.
