# Identifier Key-Rewrap Operations

## Implemented local boundary

Phase 1 includes a bounded identifier-envelope rewrap service for rotating only the key-encryption key (KEK). It unwraps and rewraps each random data key in memory without decrypting the identifier value or changing its ciphertext, nonce, authentication tag, lookup token, or normalization metadata.

The service supports batches of 1–1,000 records and a dry-run mode. Candidates are selected by their current envelope key ID, and each write is an optimistic compare-and-swap against the complete expected envelope. A stopped run can therefore resume safely: already-rewrapped rows are no longer candidates, and a concurrent change is reported as a conflict instead of being overwritten.

Database authority is separated:

- `ROTATION_DATABASE_URL` uses the `digital_footprint_rotation` login, which has no direct table privileges.
- The login can execute only the bounded list and validated replace functions.
- Both functions are owned by the non-login `digital_footprint_rotation_owner`, whose RLS bypass and table grants are limited to identifier envelope selection and update.
- The replacement function rejects nulls, oversized batches, unchanged key IDs, malformed envelopes, and any attempted change to identifier ciphertext, nonce, or authentication tag.

The integration exercise verifies dry-run behavior, a one-record run followed by recovery, successful decryption under the replacement key, rollback while the original key remains available, denied direct table access, and denied execution by the web runtime role.

## Safe rotation sequence

This sequence is documentation, not an exposed production command:

1. Retain the current key and introduce a distinct replacement KEK through the approved KMS.
2. Confirm the lookup key is unchanged. Lookup-token rotation is a separate migration.
3. Run a dry batch against synthetic or preview data and inspect only aggregate counts and opaque failures.
4. Rewrap bounded batches until no candidates remain, retrying compare-and-swap conflicts after investigation.
5. Verify database key-ID counts and decrypt representative authorized fixtures under the replacement key.
6. Keep the old key available through the rollback window. Rollback runs the same service with source and target keyrings reversed.
7. Retire the old key only after reconciliation, backup/recovery review, and explicit approval.

Never log envelopes, key material, decrypted identifiers, or lookup tokens. Do not configure the rotation credential in the user-facing web runtime.

## Production gate

The local keyrings are not a production KMS integration, and no operational CLI, scheduler, or cloud IAM policy is included. Before production, select an approved KMS/HSM, replace raw environment key material with purpose-scoped key references, define dual-key availability and emergency rollback periods, add monitored invocation and reconciliation, exercise backup restoration, and review access logs.

Lookup-key rotation is a deliberately separate procedure with its own dedicated database role and worker, built and locally verified per [ADR 0016](adr/0016-lookup-key-rotation.md); see [LOOKUP_KEY_ROTATION_OPERATIONS.md](LOOKUP_KEY_ROTATION_OPERATIONS.md) for its implemented boundary. Production cutover remains blocked pending an approved KMS and the ADR's remaining approval questions.
