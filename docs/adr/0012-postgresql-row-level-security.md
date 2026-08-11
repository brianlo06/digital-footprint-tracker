# ADR 0012: PostgreSQL Row-Level Security

**Status:** Accepted

## Context

Application ownership checks are the primary authorization boundary, but a missed predicate could expose a highly sensitive cross-tenant identity graph. PostgreSQL RLS can reduce that blast radius only when the runtime role, connection-pool context, background maintenance, migrations, and tests are designed together. Superusers, table owners, and roles with `BYPASSRLS` can bypass ordinary policies, while leaked session context on a pooled connection can misattribute access.

The local foundation now routes user-facing operations through a restricted runtime connection and a tenant-scoped transaction. Migrations and synthetic test inspection retain the owner connection. Bounded retention uses a separate function-only login backed by a non-login, narrowly granted security-definer owner.

## Decision

Keep explicit application/DAL ownership checks as the primary control and require PostgreSQL RLS as defense in depth before any shared multi-user preview handles personal data.

RLS implementation must arrive as one reviewed slice with:

- a non-owner runtime role without `BYPASSRLS` or schema-mutation privileges;
- `FORCE ROW LEVEL SECURITY` where appropriate;
- a verified auth subject installed with transaction-local context, never a persistent pooled-session setting;
- policies that derive `User → Identity → Identifier/Verification/Consent/Audit` ownership through database relationships;
- separate least-privileged deletion and retention capabilities rather than a general bypass role;
- connection-pool reset and missing-context fail-closed tests;
- owner, cross-tenant, deleted, deletion-pending, maintenance, and migration tests executed as the real runtime roles.

Do not remove application predicates after RLS is enabled. The two layers must fail independently.

## Alternatives Considered

Application checks only; RLS immediately under the owner development role; one broad maintenance bypass role; separate database/schema per tenant.

## Advantages

Defense in depth against omitted application predicates; database-enforced tenant boundaries; policy behavior can be tested independently from pages and actions; future worker capabilities can receive narrower database authority.

## Disadvantages

Every tenant query must carry safe transaction context; pooled-connection mistakes can become authorization bugs; migrations and maintenance are more complex; policy joins can affect query planning; local tests need multiple roles and cannot rely on a database owner connection.

## Consequences

The local implementation provisions a non-superuser, non-owner, `NOBYPASSRLS` runtime role; forces RLS on all seven user-graph tables plus the global rate-limit table; installs auth subject and deletion-receipt token with transaction-local `set_config`; and runs database-boundary integration tests through that role. The limiter table has no tenant policy or direct runtime grant and is reachable only through a fixed-policy function. `DATABASE_URL` remains privileged and is not available to tenant-facing services; `RUNTIME_DATABASE_URL` is mandatory and must differ outside local development.

The shared preview remains blocked until equivalent runtime and maintenance role grants and secrets are provisioned and inspected in the hosted database. Future operational jobs receive narrow roles or security-definer functions with fixed inputs, minimized grants, audit events, and dedicated tests.

## Revisit Conditions

The product becomes permanently single-user and single-instance; tenancy moves to isolated databases; the hosting provider cannot support required roles/settings safely; or measured policy costs require a different isolation architecture.
