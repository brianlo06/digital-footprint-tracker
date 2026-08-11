# Tests

The active Phase 1 baseline uses only synthetic identifiers and local dependencies.

- `core/`: normalization and masking behavior.
- `security/`: encryption, key-rewrap policy, auth fail-closed behavior, field-level PII log canaries, centralized-sink enforcement, trusted network parsing, verification-gateway isolation, and the closed provider boundary.
- `privacy/`: bounded retention policy validation without database access.
- `integration/`: opt-in PostgreSQL account/identifier lifecycle, direct Server Action authorization, cross-account denial, verification lockout, concurrent user/network throttling, reauthentication gate, complete foundation deletion, bounded key-rewrap recovery/rollback, and database-enforced RLS isolation through restricted roles.
- `providers/` and `fixtures/`: placeholders for a separately approved later phase; no executable adapter or provider response exists.

`npm test` runs service-independent tests and skips PostgreSQL integration unless database URLs are explicitly supplied. `npm run test:integration` requires `TEST_DATABASE_URL` (owner/setup), `TEST_RUNTIME_DATABASE_URL` (restricted web role), `TEST_MAINTENANCE_DATABASE_URL` (function-only retention role), and `TEST_ROTATION_DATABASE_URL` (function-only key-rewrap role).
