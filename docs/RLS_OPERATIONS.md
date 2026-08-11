# PostgreSQL Row-Level Security Operations

## Connection boundary

The foundation has four deliberately separate database connections:

- `DATABASE_URL` is the database-owner connection. It is limited to migrations and synthetic integration-test setup/inspection.
- `RUNTIME_DATABASE_URL` is the local user-facing application connection. Its role must be a non-owner, non-superuser role without `BYPASSRLS`, schema creation, or migration privileges. Hosted Workers accept only the `RUNTIME_DATABASE` Hyperdrive binding and create a request-scoped client from it.
- `MAINTENANCE_DATABASE_URL` is local-only. The isolated retention Worker uses a distinct `MAINTENANCE_DATABASE` Hyperdrive binding whose login role has no table privileges and may execute only the bounded retention function.
- `ROTATION_DATABASE_URL` is local-only. A hosted controlled rewrap invocation must use a distinct `ROTATION_DATABASE` Hyperdrive binding whose login role has no table privileges and may execute only bounded envelope list/replace functions.

Tenant-facing services call `withTenantDatabase`, which opens a transaction and sets `app.auth_subject` plus the pseudonymous `app.subject_token` with `set_config(..., true)`. The `true` flag makes both values transaction-local. Policies use `current_setting(..., true)` plus `nullif`; absent or cleared settings therefore reveal no rows and permit no writes.

Outside local development, database helpers do not cache clients in module scope and do not accept connection-string environment fallbacks. They resolve the required Hyperdrive binding from the current OpenNext request context, open at most five application connections, complete the operation, and close the client. Missing bindings fail closed.

Application ownership predicates remain mandatory. RLS is a second, independently tested boundary.

## Local provisioning

Apply migrations as the owner first, then provision table/type grants in that database:

```bash
DATABASE_URL=postgres://owner... npm run db:migrate
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-runtime-role.sql
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-rate-limit-role.sql
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-maintenance-role.sql
psql postgres://owner... -v ON_ERROR_STOP=1 -f scripts/provision-local-rotation-role.sql
```

The scripts are idempotent and intentionally contain local-only passwords. Run all four separately for the development and test databases. Never reuse those role passwords in a hosted environment.

After provisioning, run the read-only boundary attestation through the owner connection:

```bash
DATABASE_URL=postgres://owner... npm run db:verify:boundaries
```

The verifier sets statement/lock timeouts and a catalog-only `search_path`, opens a read-only transaction, and rolls it back after checking the complete standard-role contract. It fails closed on missing objects, role administration or membership, unexpected table/function authority, missing forced RLS/policies, unsafe capability-function ownership, `PUBLIC` execution, or an unfixed security-definer `search_path`. Its only successful output is a fixed confirmation string; it does not select tenant rows or reveal credentials.

The runtime role receives only `CONNECT`, schema/type `USAGE`, and `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on the seven user-graph tables. It receives no `TRUNCATE`, schema mutation, role administration, database creation, ownership, superuser, or RLS-bypass capability. The eighth protected table, `rate_limit_windows`, has no runtime table grant or RLS policy; the runtime may call only its fixed-policy limiter function.

Retention uses two additional roles. `digital_footprint_maintenance` can log in but has no direct table privileges and can execute only `run_retention_maintenance`. The security-definer function is owned by `digital_footprint_retention_owner`, which cannot log in and receives RLS bypass plus operations on only the four retention-relevant tables. The function fixes `search_path`, fully qualifies every object, validates nulls, batch size, future clock skew, and minimum audit retention in PostgreSQL, uses `SKIP LOCKED`, and is not executable by `PUBLIC` or the web runtime role.

Key rewrap follows the same split. `digital_footprint_rotation` can log in but has no direct identifier-table privileges and can execute only the bounded envelope list and compare-and-swap replacement functions. Their non-login owner has narrowly scoped `SELECT`/`UPDATE` access. PostgreSQL independently validates key IDs, limits, envelope shape, and preservation of ciphertext fields. See `KEY_ROTATION_OPERATIONS.md`.

## Verification

Run integration tests with all purpose-specific roles:

```bash
TEST_DATABASE_URL=postgres://owner... \
TEST_RUNTIME_DATABASE_URL=postgres://restricted-runtime... \
TEST_MAINTENANCE_DATABASE_URL=postgres://function-only-maintenance... \
TEST_ROTATION_DATABASE_URL=postgres://function-only-rotation... \
npm run test:integration
```

The RLS suite verifies:

- the connection's actual role flags;
- enabled and forced RLS on every tenant table;
- zero visibility and rejected inserts without tenant context;
- visibility of only the current user's graph;
- rejected or zero-row cross-tenant mutations;
- transaction-local context cleanup on a reused pooled connection;
- deletion-receipt isolation after account deletion;
- no maintenance-function execution from the web role;
- no direct table access from the maintenance login role;
- non-login, narrowly granted owners for security-definer functions;
- no direct limiter-table access from the web role;
- exact concurrent user/network limits through the function-only capability;
- denied direct identifier access from the rotation login and denied rotation-function execution from the web role;
- non-login ownership plus bounded, validated envelope replacement; and
- dry-run, interrupted resume, ciphertext preservation, and rollback behavior.

## Hosted preview gate

Before any shared preview accepts personal data:

1. Provision distinct owner, runtime, and purpose-specific maintenance/rotation credentials plus non-login capability owners through the hosting platform rather than these local scripts.
2. Confirm the runtime role is not the table owner and has `rolsuper = false` and `rolbypassrls = false`.
3. Run migrations with the owner credential and the complete integration suite with the hosted runtime credential.
4. Run `npm run db:verify:boundaries` with the hosted owner connection and retain its fixed success result with the deployment evidence.
5. Inspect all tenant tables for both `relrowsecurity = true` and `relforcerowsecurity = true`.
6. Keep owner, maintenance, and rotation credentials out of the web runtime and reproduce both function-only authorities.
7. Rotate both database credentials and repeat the verifier plus role/policy assertions before enabling traffic.
