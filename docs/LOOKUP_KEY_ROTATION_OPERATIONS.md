# Lookup-Key Rotation Operations

## Implemented local boundary

Phase 1 includes an additive, dual-key capability for rotating the HMAC lookup key used to derive identifier equality tokens, deletion-receipt subject tokens, and rate-limit scope tokens. `LOOKUP_KEY_ID` versions the lookup key independently of the envelope `ENCRYPTION_KEY_ID`; an optional `PREVIOUS_LOOKUP_KEY_ID`/`PREVIOUS_LOOKUP_KEY` pair, when both are set, activates dual-key behavior across all three domains at once. With no previous key configured, every code path behaves exactly as before this ADR.

**Identifier tokens.** A new `identifier_lookup_tokens` child table carries one row per `(identifier, lookup key)` pair, under the same forced tenant RLS as `identifiers`. Adding an email identifier writes one row per active key in the same transaction as the parent insert; duplicate enrollment under either key aborts the whole transaction via the table's `(identity_id, identifier_type, lookup_key_id, token)` uniqueness. The legacy `identifiers.lookup_token` column remains an old-key compatibility field and is not touched by this work.

**Deletion receipts.** A nullable `subject_token_key_id` column and a second `app.subject_token_previous` transaction setting extend the tenant-isolation policy to accept either key's token. `deleteAccount` and `resumeAccountDeletionAfterAuthRevoked` lock the user row and migrate any previous-key receipt to the current key in place, inside the same transaction as the receipt upsert, before creating anything — so at most one receipt per subject exists across a rotation. Completed receipts are never touched; they age out under their original key through existing retention, and idempotent webhook replay against them stays read-only across both keys.

**Rate limits.** A new `consume_action_rate_limit_dual` function is deployed alongside the existing single-key function, not in place of it. It is used only when a previous key is configured: it locks both the old- and new-token windows, seeds a missing one from its counterpart, reconciles divergence to the stricter state, applies the same threshold logic once, and persists the identical resulting window under both keys — so a rotation never resets abuse counters.

**Rotation worker.** `migrateLookupTokenBatch` mirrors the envelope-rewrap worker's dry-run/bounded-batch/restart-safe pattern: it lists identifiers missing a token for a target key, decrypts each under one fixed envelope keyring, and inserts the new token through a compare-and-swap function tied to the identifier's envelope and normalization snapshot at listing time. A conflict is quarantined as an opaque identifier ID plus reason code (`ENVELOPE_CHANGED`, `NORMALIZATION_CHANGED`, `OWNERSHIP_CHANGED`, `TOKEN_COLLISION`, or `ENVELOPE_KEY_UNAVAILABLE` when a row is encrypted under a different envelope key than the one configured — expected when envelope-key and lookup-key rotations overlap) — never resolved by overwriting or deleting another identifier's row. A deleted identifier is reported separately and skipped. `backfillLegacyLookupTokens` performs the one-time, bounded, restart-safe copy of the legacy `lookup_token` column into the child table for the currently configured key.

Database authority is separated from envelope-key rewrap:

- `LOOKUP_ROTATION_DATABASE_URL` uses the `digital_footprint_lookup_rotation` login, which has no direct table privileges.
- The login can execute only the bounded list, compare-and-swap insert, and backfill functions.
- All three are owned by the non-login `digital_footprint_lookup_rotation_owner`, which holds read-only `SELECT` on `identifiers` (this worker never mutates the parent row) and `SELECT, INSERT` on `identifier_lookup_tokens` (rows are never updated or deleted).
- This role pair is dedicated and separate from `digital_footprint_rotation`/`_owner` (envelope rewrap), so a compromised or misused credential cannot trigger both kinds of rotation.

The integration exercise verifies: function-only role boundaries and denied direct table access; dry-run, bounded restart-safe batching, and dual-token verification; a stale envelope reported as a conflict and a concurrently deleted identifier reported as skipped, both via direct compare-and-swap calls; dual-key identifier equality and duplicate-enrollment denial; deletion-receipt migration-in-place and completed-receipt idempotent replay; and dual rate-limit consumption preserving counts across a simulated rotation.

## Safe rotation sequence

This sequence is documentation, not an exposed production command. Steps 1–8 are implemented and locally exercised; steps 9–12 (the actual key cutover) are **not implemented and remain production-only, blocked** pending the ADR's approval questions.

1. Approve the new lookup key, KMS/IAM policy, dual-key duration, backup implications, operator identity, and emergency stop criteria. **Blocked.**
2. Take and test a protected restore point. **Blocked.**
3. Apply the additive schema/RLS/function/key-ID changes while the old key remains the sole write key. **Implemented** (this is the current state).
4. Run the database-boundary preflight and synthetic authorization suite. **Implemented.**
5. Deploy dual-read/dual-write identifier and deletion-receipt behavior plus atomic dual rate-limit consumption. **Implemented**, active only when a previous key is configured.
6. Exercise synthetic create, duplicate detection, deletion, webhook redelivery, rate limiting, and account deletion. **Implemented** in the integration suite.
7. Run identifier batches with dry-run counts, bounded execution, interruption/resume, and opaque conflict reporting. **Implemented** (`migrateLookupTokenBatch`).
8. Reconcile: every live identifier has exactly one token per active key; no duplicate logical identifiers; incomplete receipts use the new key; no token orphans; limiter rows advancing. **Implemented** as integration assertions against synthetic data.
9. Switch the write key to the new key while retaining previous-key reads and rate-limit consumption. **Not implemented — production only, blocked.**
10. Hold through the approved rollback period, maximum limiter lifetime, backup/restore review, and completion of every unfinished deletion receipt. **Blocked.**
11. Disable previous-key reads, delete legacy identifier token rows in bounded maintenance batches, allow legacy completed receipts/limiter rows to expire, repeat reconciliation. **Blocked.**
12. Destroy or disable the old key only after an irreversible-cutover approval. **Blocked.**

Never log envelopes, key material, decrypted identifiers, tokens, or lookup keys. Do not configure the lookup-rotation credential in the user-facing web runtime.

### Known limitations of the current (at most two keys) design

- **Complete each rotation's reconciliation (step 8) before starting the next one.** The schema and application code only ever hold `current` plus one `previous` key. If an operator advances `LOOKUP_KEY_ID` a second time (key A → B → C) without first running `migrateLookupTokenBatch` to completion for the A → B transition, an identifier still carrying only its original A-keyed token has no row matching either B (previous) or C (current) once the second rotation lands — the `(identity_id, identifier_type, lookup_key_id, token)` uniqueness constraint can no longer catch a duplicate re-enrollment of that identifier, because a duplicate's B/C-keyed tokens will never collide with the orphaned A-keyed row. Never begin a second rotation while a prior one is still incomplete.
- **A conflict that reappears across repeated batches indicates a permanent issue, not a transient race.** `list_identifiers_missing_lookup_token` always returns the same still-missing rows in `id` order, so a genuinely permanent conflict (never expected in normal operation, since `identity_id`/`type`/`normalization_version` have no code path that mutates them after creation) sorts first in every subsequent batch and can starve batches sized near 1. `ENVELOPE_CHANGED` conflicts are expected to be transient and self-resolve on the next batch call once a concurrent envelope rewrap settles; if the same identifier ID appears in `conflicts` across several consecutive calls, stop the campaign and investigate that row directly rather than continuing to retry.

## Production gate

No KMS/HSM integration, operational CLI, scheduler, or cloud IAM policy is included. No hosted PostgreSQL database exists yet at all. Before any real second lookup key is introduced: select an approved KMS/HSM, replace raw environment key material with purpose-scoped key references, approve dual-key and rollback durations, define completed-receipt and backup-compatibility behavior, name the plaintext-worker operator and alerting, decide conflict disposition, and obtain irreversible key-destruction authority — the full list in [ADR 0016](adr/0016-lookup-key-rotation.md)'s approval questions.
