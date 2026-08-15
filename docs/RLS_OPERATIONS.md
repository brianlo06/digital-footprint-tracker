# PostgreSQL Row-Level Security Operations

## Connection boundary

The foundation has six deliberately separate database connections:

- `DATABASE_URL` is the database-owner connection. It is limited to migrations and synthetic integration-test setup/inspection.
- `RUNTIME_DATABASE_URL` is the local user-facing application connection. Its role must be a non-owner, non-superuser role without `BYPASSRLS`, schema creation, or migration privileges. Hosted Workers accept only the `RUNTIME_DATABASE` Hyperdrive binding and create a request-scoped client from it.
- `MAINTENANCE_DATABASE_URL` is local-only. The isolated retention Worker uses a distinct `MAINTENANCE_DATABASE` Hyperdrive binding whose login role has no table privileges and may execute only the bounded retention function.
- `ROTATION_DATABASE_URL` is local-only. A hosted controlled rewrap invocation must use a distinct `ROTATION_DATABASE` Hyperdrive binding whose login role has no table privileges and may execute only bounded envelope list/replace functions.
- `LOOKUP_ROTATION_DATABASE_URL` is local-only and optional in the web runtime. A hosted controlled lookup-token rotation invocation must use a distinct `LOOKUP_ROTATION_DATABASE` Hyperdrive binding whose login role has no table privileges and may execute only the bounded lookup-token list/insert/backfill functions.
- `DELIVERY_DATABASE_URL` is local-only and optional in the web runtime. A hosted verification-delivery outbox invocation must use a distinct `DELIVERY_DATABASE` Hyperdrive binding whose login role has no table privileges and may execute only the bounded claim/complete/report-failure functions. A purpose-specific preview Hyperdrive is provisioned but is not attached to a Worker; see `VERIFICATION_DELIVERY_OPERATIONS.md`.

Tenant-facing services call `withTenantDatabase`, which opens a transaction and sets `app.auth_subject`, the pseudonymous `app.subject_token`, and (when a previous lookup key is configured) `app.subject_token_previous` with `set_config(..., true)`. The `true` flag makes every value transaction-local. Policies use `current_setting(..., true)` plus `nullif`; absent or cleared settings therefore reveal no rows and permit no writes.

Outside local development, database helpers do not cache clients in module scope and do not accept connection-string environment fallbacks. They resolve the required Hyperdrive binding from the current OpenNext request context, open at most five application connections, complete the operation, and close the client. Missing bindings fail closed.

Application ownership predicates remain mandatory. RLS is a second, independently tested boundary.

## Local provisioning

Apply migrations as the owner first, then provision table/type grants in that database:

```bash
DATABASE_URL=postgres://owner... npm run db:migrate
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-runtime-role.sql
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-rate-limit-role.sql
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-provider-usage-role.sql
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-maintenance-role.sql
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-rotation-role.sql
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-lookup-rotation-role.sql
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-delivery-role.sql
```

The scripts are idempotent and intentionally contain local-only passwords. Run all seven separately for the development and test databases. Never reuse those role passwords in a hosted environment.

For a dedicated hosted database, generate five distinct random passwords of at least 32 characters in a secret manager or ephemeral shell variables and run the password-free hosted provisioner after migrations:

```bash
DFT_RUNTIME_DB_PASSWORD='<generated>' \
DFT_MAINTENANCE_DB_PASSWORD='<generated>' \
DFT_ROTATION_DB_PASSWORD='<generated>' \
DFT_LOOKUP_ROTATION_DB_PASSWORD='<generated>' \
DFT_DELIVERY_DB_PASSWORD='<generated>' \
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/provision-hosted-database-roles.sql
```

The password values are read from the process environment inside `psql`; do not pass them through `-v`, paste them into SQL, or retain them in shell history. The script validates that they are present, distinct, and at least 32 characters, creates roles with safe managed-PostgreSQL defaults, fails closed if any existing role has unsafe flags, grants the dedicated owner only the membership needed for ownership transfers, clears direct privilege drift, restores exact grants, and transfers the fourteen capability functions to non-login owners in a transaction. Run it only as the dedicated database owner. Unset the five password variables immediately after creating the purpose-specific secret/Hyperdrive configurations.

After provisioning, run the read-only boundary attestation through the owner connection:

```bash
DATABASE_URL=postgres://owner... npm run db:verify:boundaries
```

The verifier sets statement/lock timeouts and a catalog-only `search_path`, opens a read-only transaction, and rolls it back after checking the complete standard-role contract. It fails closed on missing objects, role administration or membership, unexpected table/function authority, missing forced RLS/policies, unsafe capability-function ownership, `PUBLIC` execution, or an unfixed security-definer `search_path`. Its only successful output is a fixed confirmation string; it does not select tenant rows or reveal credentials.

The runtime role receives only `CONNECT`, schema/type `USAGE`, and `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on the eight user-graph tables (including `identifier_lookup_tokens`). It receives no `TRUNCATE`, schema mutation, role administration, database creation, ownership, superuser, or RLS-bypass capability. The ninth protected table, `rate_limit_windows`, has no runtime table grant or tenant policy; the runtime may call only its fixed-policy limiter functions. The tenth protected table, `verification_delivery_outbox`, has an insert-only RLS policy binding the inserted row's `verification_id`, `user_id`, and the tenant's `auth_subject` together in one predicate; the runtime's own grant on it is deliberately asymmetric to the eight user-graph tables — `INSERT` only, never `SELECT`, `UPDATE`, or `DELETE`. The eleventh protected table, `provider_usage_reservations`, also has no runtime table grant. Runtime code reaches it only through reserve/complete/release functions after `withTenantDatabase` establishes transaction-local identity.

Retention uses two additional roles. `digital_footprint_maintenance` can log in but has no direct table privileges and can execute only `run_retention_maintenance`. The security-definer function is owned by `digital_footprint_retention_owner`, which cannot log in or bypass RLS and receives fixed-role capability policies plus operations on only the four retention-relevant tables. The function fixes `search_path`, fully qualifies every object, validates nulls, batch size, future clock skew, and minimum audit retention in PostgreSQL, uses `SKIP LOCKED`, and is not executable by `PUBLIC` or the web runtime role.

All six security-definer owners remain `NOBYPASSRLS`. Each can see rows only through an exact `current_user = '<capability-owner>'` policy on the tables its functions require and on read-only dependencies referenced by those tables' tenant-policy joins. Table grants independently constrain the allowed commands. The login roles are not members of these owners and cannot `SET ROLE`; they can reach the capability only through the explicitly granted function.

Key rewrap follows the same split. `digital_footprint_rotation` can log in but has no direct identifier-table privileges and can execute only the bounded envelope list and compare-and-swap replacement functions. Their non-login owner has narrowly scoped `SELECT`/`UPDATE` access plus read-only access to the `identities`/`users` policy dependencies. PostgreSQL independently validates key IDs, limits, envelope shape, and preservation of ciphertext fields. See `KEY_ROTATION_OPERATIONS.md`.

Lookup-key rotation uses a dedicated pair kept separate from envelope rewrap. `digital_footprint_lookup_rotation` can log in but has no direct table privileges and can execute only the bounded list, compare-and-swap insert, and backfill functions. Their non-login owner has read-only `SELECT` on `identifiers`, `identities`, and `users`, and `SELECT, INSERT` on `identifier_lookup_tokens` — it never updates or deletes those tables. See `LOOKUP_KEY_ROTATION_OPERATIONS.md`.

The verification delivery outbox uses its own dedicated pair. `digital_footprint_delivery` can log in but has no direct table privileges and can execute only the bounded claim, complete, and report-failure functions. Their non-login owner has `SELECT, UPDATE` on `verification_delivery_outbox`, read-only `SELECT` on `identifier_verifications` and `users` for eligibility, and read-only `SELECT` on `identifiers`/`identities` so the verification tenant-policy join can be evaluated. The function code never queries the latter two tables. See `VERIFICATION_DELIVERY_OPERATIONS.md`.

Provider usage uses the existing runtime login plus `digital_footprint_provider_usage_owner`, a non-login role. Runtime has no direct ledger-table privilege and can execute only reserve, complete, and release. The owner has `SELECT, INSERT, UPDATE` on the ledger and read-only `SELECT` on `users` solely to validate the transaction-local tenant subject. Reservation functions use the PostgreSQL server clock, validate every zero-or-positive cap, acquire a provider-scoped transaction advisory lock, and compute user/provider daily and provider monthly request and cost totals across tenants without returning other tenants' rows. Authorization rows are share-locked through the synthetic reservation transaction; the wrapper catches a fixture dispatch error before transaction exit so its `FAILED` reservation commits, then rethrows the safe provider error. This wrapper must not be reused for live network I/O; a live adapter requires a short-transaction job state machine.

## Verification

Run integration tests with all purpose-specific roles:

```bash
TEST_DATABASE_URL=postgres://owner... \
TEST_RUNTIME_DATABASE_URL=postgres://restricted-runtime... \
TEST_MAINTENANCE_DATABASE_URL=postgres://function-only-maintenance... \
TEST_ROTATION_DATABASE_URL=postgres://function-only-rotation... \
TEST_LOOKUP_ROTATION_DATABASE_URL=postgres://function-only-lookup-rotation... \
TEST_DELIVERY_DATABASE_URL=postgres://function-only-delivery... \
npm run test:integration
```

The RLS suite verifies:

- the connection's actual role flags;
- enabled and forced RLS on every tenant table, including `identifier_lookup_tokens`;
- zero visibility and rejected inserts without tenant context;
- visibility of only the current user's graph;
- rejected or zero-row cross-tenant mutations, including on `identifier_lookup_tokens`;
- transaction-local context cleanup on a reused pooled connection;
- deletion-receipt isolation after account deletion;
- no maintenance-function execution from the web role;
- no direct table access from the maintenance login role;
- non-login, narrowly granted owners for security-definer functions;
- no direct limiter-table access from the web role;
- exact concurrent user/network limits through the function-only capability;
- no direct provider-ledger access from runtime, exact tenant authorization snapshots, atomic cross-tenant provider caps, zero-default denial, idempotent completion, and durable failed-dispatch reconciliation;
- denied direct identifier access from the rotation login and denied rotation-function execution from the web role;
- non-login ownership plus bounded, validated envelope replacement;
- dry-run, interrupted resume, ciphertext preservation, and rollback behavior;
- dual-key identifier equality writes and duplicate-enrollment denial across both keys in one transaction;
- deletion-receipt migration-in-place, completed-receipt idempotent replay, and fail-closed behavior with both subject-token settings absent;
- denied direct identifier/lookup-token access from the lookup-rotation login and denied lookup-rotation-function execution from the web role;
- the lookup-rotation worker's dry-run, restart-safe batching, and opaque stale-envelope/deleted-identifier reporting;
- dual rate-limit consumption seeding a missing window from its counterpart and preserving counts across a rotation;
- atomic outbox enqueue inside the identifier transaction, with a forced later failure rolling the outbox row back too;
- denied direct outbox/verification/user access from the delivery login and denied delivery-function execution from every other purpose-specific login, in both directions;
- concurrent claim calls under a real multi-connection pool never double-claiming a delivery, with their union covering every eligible row;
- lease-expiry reclaim under a new token, and CAS rejection of a stale lease token; and
- ineligible-row cancellation with payload destruction, and completion/dead-letter payload destruction with advancing transient-failure backoff.

## Hosted preview gate

Before any shared preview accepts personal data:

1. Provision distinct owner, runtime, and purpose-specific maintenance/rotation credentials plus non-login capability owners through the hosting platform rather than these local scripts.
2. Confirm every login and non-login capability role has `rolsuper = false` and `rolbypassrls = false`, and that no restricted role owns a protected table.
3. Run migrations with the owner credential and the complete integration suite with the hosted runtime credential.
4. Run `npm run db:verify:boundaries` with the hosted owner connection and retain its fixed success result with the deployment evidence.
5. Inspect all tenant tables for both `relrowsecurity = true` and `relforcerowsecurity = true`.
6. Keep owner, maintenance, rotation, lookup-rotation, and delivery credentials out of the web runtime and reproduce every function-only authority, including the non-login provider-usage owner.
7. Rotate both database credentials and repeat the verifier plus role/policy assertions before enabling traffic.
