# Tests

The active Phase 1 baseline uses only synthetic identifiers and local dependencies.

- `core/`: normalization and masking behavior.
- `security/`: encryption, key-rewrap policy, auth fail-closed behavior, field-level PII log canaries, centralized-sink enforcement across the application and standalone Workers, trusted network parsing, verification-gateway isolation, strict delivery-command decoding, delivery Worker outcome routing, and the closed provider boundary.
- `privacy/`: bounded retention policy and Cron Worker setting validation without database access.
- `integration/`: opt-in PostgreSQL account/identifier lifecycle, idempotent breach-consent grant/withdrawal, direct Server Action authorization, cross-account denial, verification lockout, concurrent user/network throttling, durable provider-usage reservations, reauthentication gate, complete foundation deletion, bounded key-rewrap recovery/rollback, and database-enforced RLS isolation through restricted roles.
- `providers/`: synthetic-only provider contracts, fictional response fixtures, authorization policy, and zero-network invocation behavior. No live provider adapter or credential exists.

`npm test` runs service-independent tests and skips PostgreSQL integration unless database URLs are explicitly supplied. `npm run test:integration` requires `TEST_DATABASE_URL` (owner/setup), `TEST_RUNTIME_DATABASE_URL` (restricted web role), `TEST_MAINTENANCE_DATABASE_URL` (function-only retention role), `TEST_ROTATION_DATABASE_URL` (function-only key-rewrap role), `TEST_LOOKUP_ROTATION_DATABASE_URL` (function-only lookup-rotation role), and `TEST_DELIVERY_DATABASE_URL` (function-only verification-delivery role).
