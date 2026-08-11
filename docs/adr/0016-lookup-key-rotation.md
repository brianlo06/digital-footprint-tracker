# ADR 0016: Coordinated Lookup-Key Rotation

**Status:** Proposed — implementation and production use require explicit security/operations approval  
**Date:** 2026-08-11

## Context

The lookup key produces namespace-separated HMAC-SHA-256 tokens. These tokens prevent normalized identifiers, authentication subjects, and trusted network addresses from being stored in equality indexes or operational counters. Unlike rotating a key-encryption key, lookup-key rotation changes every deterministic value and sometimes requires the source plaintext.

The current key is used by three persistence boundaries:

| Store                  | Namespace(s)                                  | Recoverable source                                              | Rotation constraint                                                                 |
| ---------------------- | --------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Identifier equality    | `identifier:email:v1`                         | Authorized decryption of the normalized encrypted identifier    | Preserve per-identity/type uniqueness while old and new tokens coexist              |
| Deletion receipts      | `deleted-auth-subject:v1`                     | Active/pending user subject; none after completed user deletion | Completed receipts cannot and need not be re-keyed after their source is destroyed  |
| Action-rate-limit rows | `rate-limit-user:v1`, `rate-limit-network:v1` | Only the subject and trusted network value on a current request | Existing windows cannot be batch re-keyed; a naive cutover resets protective counts |

Changing a namespace or normalization algorithm is not a key rotation. Either change requires its own semantic data migration and must not be combined with this procedure.

## Decision

Adopt an additive, dual-key transition with an independently versioned lookup-key identifier. Do not replace `LOOKUP_KEY` in place and do not use the envelope `ENCRYPTION_KEY_ID` as the lookup-key version.

Implementation remains blocked until this ADR, the KMS design, retention implications, and controlled-plaintext authority are approved. When approved, use the following design.

### Key and runtime contract

- Introduce an opaque `LOOKUP_KEY_ID` plus current/previous lookup-key references supplied through the approved secret manager or KMS. Raw keys never enter source, Wrangler variables, command arguments, logs, or database rows.
- Permit at most two lookup keys in application memory during a transition: one write key and one previous read key. Reject duplicate IDs, equal key material, missing references, or more than two active keys.
- Bind every token to its existing namespace and unchanged normalization version. Persist the lookup-key ID beside every durable token.
- Keep lookup-key configuration separate from envelope keys so KEK rewrap and lookup rotation cannot be triggered accidentally by the same deployment.

### Identifier tokens

Introduce an `identifier_lookup_tokens` child table rather than adding successive one-off token columns. Each row contains `identifier_id`, `identity_id`, identifier type, namespace, normalization version, lookup-key ID, and token. Require:

- a unique parent tuple plus cascading composite foreign key on `(identifier_id, identity_id, identifier_type)` so duplicated ownership/type fields cannot diverge from the identifier;
- a primary key on `(identifier_id, lookup_key_id)`;
- a unique constraint on `(identity_id, identifier_type, lookup_key_id, token)`; and
- the same forced tenant RLS relationship as the parent identifier.

During the additive migration, copy each legacy token into this table with the legacy lookup-key ID without decrypting anything. Dual-key application versions query all configured key IDs and write a token row for each active key. Duplicate enrollment checks must evaluate both keys in one tenant-scoped transaction.

The existing `identifiers.lookup_token` column remains an old-key compatibility field only while older application versions can run. Before switching the write key, all deployed versions must use the child table, the old unique index must be replaced by the child-table constraints, and the legacy column must become nullable. Do not repurpose the legacy column for the new key: that would make mixed-version behavior ambiguous. Stop writing it after compatibility ends and drop it only in a later cleanup release.

A separate lookup-rotation worker may then process bounded batches. It receives only a function-scoped database credential, the approved envelope-key reference, and current/new lookup-key references. For each candidate it:

1. unwraps and decrypts the identifier under its authorized envelope context;
2. validates and reapplies the row's existing normalization version;
3. computes only the new namespaced token;
4. inserts it with compare-and-swap semantics tied to the unchanged encrypted envelope and normalization version; and
5. immediately releases plaintext references without logging, persistence, retries containing payloads, or telemetry attributes.

JavaScript strings cannot be reliably zeroized, so this worker must be isolated, short-lived, non-concurrent per record, free of heap snapshots/traces, and restarted after bounded batches. It must never return plaintext or tokens. A conflict is quarantined as an opaque identifier ID and reason code; it is never resolved by overwriting or deleting another identifier.

### Deletion receipts

Add `subject_token_key_id` and allow the tenant transaction context to carry current and previous derived subject tokens in two fixed, separately bounded settings during the transition. The compatibility policy may also accept the existing single setting until every old application version is retired. It must compare tokens directly rather than parse a client-controlled list; absence of every setting continues to fail closed.

For `REQUESTED`, `AUTH_REVOKED`, or `FAILED` receipts, the associated active/deletion-pending user subject is still available. Lock the user row, find a receipt using either token, and migrate the receipt token in place to the new key before creating anything. This preserves one receipt per active subject despite different HMAC outputs.

Do not decrypt, reconstruct, or extend retention for `COMPLETED` receipts whose user row is gone. Leave their legacy token and key ID until normal retention deletes them. After the old key is retired, a duplicate provider webhook may no longer resolve that receipt, but it still observes no user and returns idempotent success. The old key must not be retained solely to keep completed receipts linkable.

### Rate-limit continuity

Existing rate-limit rows have no recoverable subject or network source, so they cannot be batch migrated. Before changing the write key, deploy a bounded security-definer transition function that accepts old/new user tokens and old/new network tokens for the current request. It must:

- validate all four tokens and the fixed action;
- lock and evaluate both old and new windows atomically;
- seed a missing version from its existing counterpart and conservatively reconcile any divergence to the stricter count/block state;
- deny when either key's user or network policy denies;
- consume the logical attempt once and persist the same resulting window state under both key versions;
- return only the existing decision fields; and
- remain the only table authority granted to the runtime role.

Run dual consumption for at least the maximum possible limiter-row lifetime, not merely the nominal request window. Only then stop deriving old rate-limit tokens. Bounded retention removes the expired legacy rows. This prevents a rotation from silently resetting abuse counters.

### Migration and cutover sequence

1. Approve the new lookup key, KMS/IAM policy, dual-key duration, backup implications, operator identity, and emergency stop criteria.
2. Take and test a protected restore point whose access does not broaden application authority.
3. Apply additive schema, RLS, function, and key-ID changes while the old key remains the sole write key.
4. Run the database-boundary preflight and synthetic authorization suite before continuing.
5. Deploy dual-read/dual-write identifier and deletion-receipt behavior plus atomic dual rate-limit consumption.
6. Exercise synthetic create, duplicate detection, deletion, webhook redelivery, rate limiting, and account deletion before processing existing identifiers.
7. Run identifier batches with dry-run counts, bounded execution, interruption/resume, and opaque conflict reporting.
8. Reconcile: every live identifier has exactly one token for each active key; no duplicate logical identifiers appeared; incomplete receipts use the new key; deletion cascades left no token orphans; and new limiter rows are advancing.
9. Switch the write key to the new key while retaining previous-key reads and rate-limit consumption.
10. Hold through the approved rollback period, maximum limiter lifetime, backup/restore review, and completion or explicit reconciliation of every unfinished deletion receipt.
11. Disable previous-key reads, delete legacy identifier token rows in bounded maintenance batches, allow legacy completed receipts and limiter rows to expire, and repeat reconciliation.
12. Destroy or disable the old key only after an irreversible-cutover approval. Remove transition code and legacy schema in a later release, not in the key-destruction change.

### Rollback and failure handling

Before old-key destruction, rollback switches the write key back to the old key while retaining new token rows. Do not delete either token version during incident diagnosis. The dual rate-limit function remains active so rollback does not reset counters.

Every batch is restart-safe: existing `(identifier_id, lookup_key_id)` rows are successes, envelope/normalization changes are conflicts, and rows deleted concurrently are benign no-ops. A database or KMS failure rolls back the current record/batch and emits only aggregate counts plus allowlisted opaque error codes.

After the old key is destroyed, cryptographic rollback is impossible. Backup restoration that reintroduces old-token-only data is forbidden unless the old key is still available under the approved recovery policy. Restore/cutover compatibility is therefore an explicit destruction gate.

## Required acceptance evidence

Approval to implement is not approval to cut over. Production readiness requires synthetic evidence for:

- dual-key equality and concurrent duplicate enrollment;
- bounded plaintext migration, interruption/resume, and compare-and-swap conflict handling;
- deletion during migration with no orphan token rows;
- incomplete and completed deletion-receipt behavior across cutover;
- continuous user/network rate limiting through the full transition lifetime;
- old-key rollback before destruction and fail-closed startup for missing/mismatched key references;
- restricted worker/database/KMS authority and clean database-boundary attestation;
- backup restoration at each compatible schema/key stage; and
- log, trace, heap-dump, build-artifact, and error-payload canaries proving that plaintext, tokens, and key material did not escape.

## Consequences

Rotation becomes recoverable and does not reset rate limits or weaken identifier uniqueness. The cost is additive schema, dual-key application logic, a new narrowly authorized plaintext-processing worker, longer operational overlap, and an irreversible key-destruction gate.

Completed deletion receipts deliberately age out under their original token key. This preserves the original privacy property instead of retaining a powerful old key merely for operational lookup.

## Alternatives considered

Replace the key in place and accept broken lookups; decrypt and rewrite every token during downtime; retain the old key indefinitely; reset rate-limit counters; store reversible source values; combine normalization and key rotation; or reuse the KEK-rotation worker/credential. All either weaken security guarantees, make rollback unsafe, or broaden plaintext/key authority.

## Approval questions

The owner/security reviewer must approve the KMS/HSM, dual-key and rollback durations, completed-receipt behavior, maximum limiter lifetime, backup compatibility window, plaintext-worker operator and alerting, conflict disposition, and irreversible key-destruction authority before implementation starts.
