# Digital Footprint Tracker

> **PHASE 1 FOUNDATION — DIGITAL-FOOTPRINT SCANNING IS NOT IMPLEMENTED**

Digital Footprint Tracker is a privacy-first evidence platform for individuals to understand their own public online presence: what is visible, where it came from, how confidently it relates to them, how sensitive it is, how it changes over time, and what they can safely do next.

Phase 0 architecture is complete. The current Phase 1 slice implements only the private application foundation: a responsive shell, an authentication boundary, an explicit account-onboarding action, envelope-encrypted email identifiers, local-only fake verification, consent/audit records, and deletion primitives. It does **not** scan, scrape, query providers, enumerate usernames, send email, schedule jobs, or deploy infrastructure.

## Safety boundary

This is a self-monitoring product, not people search. Authentication does not prove control of an identifier. Future sensitive capabilities remain gated by identifier ownership verification, purpose-specific consent, authorization, quotas, audit trails, and provider approval.

The long-lived model remains:

```text
Identity → Identifiers → Scans → Providers → Evidence
         → Findings → Observations → Risk → Remediation
```

Only `Identity → Identifiers` exists in executable form today.

## Current foundation

- Next.js 16 App Router, React, strict TypeScript, and a modular single-application repository.
- PostgreSQL with Drizzle schema and migration files.
- Forced PostgreSQL row-level security on every tenant table, using a restricted runtime role and transaction-local tenant context.
- Clerk adapter for future managed authentication plus a local-only development adapter that is rejected under `NODE_ENV=production`.
- Explicit POST onboarding; render-time reads never create accounts.
- Per-record AES-256-GCM envelope encryption and separate keyed lookup tokens for email identifiers.
- Bounded, restart-safe envelope key rewrap through a function-only database role; lookup-key rotation remains separate.
- Local fake verification that is hard-gated to `APP_ENV=local` and `AUTH_MODE=local`; it sends nothing.
- A delivery-independent email verification gateway; only the non-delivering local implementation exists.
- Database-atomic per-user and shared-network throttling for every protected mutation, storing only keyed scope tokens.
- Scoped consent, privacy-safe audit events, and a deletion receipt model.
- Retry-safe deletion quarantine and bounded, unscheduled retention maintenance through a function-only database role.
- Managed-auth deletion fails closed until stable recent-login/MFA reauthentication is configured.
- Deny-by-default structured logging and synthetic unit/integration coverage.
- GitHub Actions quality/build and restricted-role PostgreSQL integration jobs using synthetic data only.

## Local setup

Use a supported Node LTS release (`.nvmrc` selects Node 22), PostgreSQL, and no paid cloud service.

```bash
npm install
cp .env.example .env.local
openssl rand -base64 32
openssl rand -base64 32
```

Place the two generated values into `ENCRYPTION_KEY` and `LOOKUP_KEY`. Then start PostgreSQL either with the provided local Compose file or an existing local PostgreSQL service. `DATABASE_URL` is the owner/migration connection; `RUNTIME_DATABASE_URL` must use the restricted application role. Update both URLs if needed, then run migrations before granting the runtime role access:

```bash
npm run db:migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-runtime-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-rate-limit-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-maintenance-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-rotation-role.sql
npm run dev
```

The local verification fixture is `LOCAL_VERIFICATION_CODE` (default `000000`). Use synthetic addresses while evaluating the foundation. Local mode must never be exposed on a shared or production network.

## Validation

```bash
npm run check
npm run build
```

Database integration tests are opt-in so unit tests remain local-service independent:

```bash
TEST_DATABASE_URL=postgres://owner... \
TEST_RUNTIME_DATABASE_URL=postgres://digital_footprint_runtime... \
TEST_MAINTENANCE_DATABASE_URL=postgres://digital_footprint_maintenance... \
TEST_ROTATION_DATABASE_URL=postgres://digital_footprint_rotation... \
npm run test:integration
```

The pinned GitHub Actions workflow runs `npm run check`, the production build, migrations, local restricted-role provisioning, and all PostgreSQL integration tests on pushes to `main` and pull requests. CI uses only synthetic credentials and data.

## Documentation

- [Phase 1 implementation status](docs/PHASE_1_STATUS.md)
- [Local browser validation](docs/BROWSER_VALIDATION.md)
- [Route and Server Action authorization matrix](docs/AUTHORIZATION_MATRIX.md)
- [Product definition](docs/PRODUCT.md)
- [Architecture and diagrams](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Privacy model](docs/PRIVACY.md)
- [Retention operations](docs/RETENTION_OPERATIONS.md)
- [PostgreSQL RLS operations](docs/RLS_OPERATIONS.md)
- [Action rate limiting](docs/RATE_LIMITING.md)
- [Verification gateway](docs/VERIFICATION_GATEWAY.md)
- [Identifier key-rewrap operations](docs/KEY_ROTATION_OPERATIONS.md)
- [Security requirements](docs/SECURITY.md) and [threat model](docs/THREAT_MODEL.md)
- [Abuse prevention](docs/ABUSE_PREVENTION.md)
- [Legal/provider risks](docs/LEGAL_AND_PROVIDER_RISKS.md)
- [Tradeoffs](docs/TRADEOFFS.md), [risk register](docs/RISK_REGISTER.md), and [open questions](docs/OPEN_QUESTIONS.md)
- [Roadmap](docs/ROADMAP.md), [backlog](docs/BACKLOG.md), and [ADRs](docs/adr/README.md)

## Not implemented

No real provider adapter, scan engine, finding dashboard, scheduler, notification delivery, broker workflow, owned-domain check, search/social/breach call, cloud deployment, or production authentication configuration exists. Placeholder provider contracts and documentation do not perform network activity. Phase 2 must not begin without a separate provider approval, legal/ToS/privacy/security review, and explicit owner authorization.

This project is not legal advice. Never commit secrets or real personal data.
