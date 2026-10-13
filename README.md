# Digital Footprint Tracker

> **LOCAL SYNTHETIC DEMO — NO LIVE PROVIDER OR PERSONAL-DATA SCAN**

Digital Footprint Tracker is a privacy-first evidence platform for individuals to understand their own public online presence: what is visible, where it came from, how confidently it relates to them, how sensitive it is, how it changes over time, and what they can safely do next.

The implemented local demo connects encrypted email identifiers, local fixture verification, explicit consent, a durable PostgreSQL scan queue, fictional breach metadata, deduplicated findings, and recent scan history. It demonstrates authorization, tenant isolation, background processing, and temporal evidence without contacting a provider. Built with Next.js, React, TypeScript, PostgreSQL, and Drizzle.

**Start here:** follow [Local setup](#local-setup), then the [five-minute demo](#five-minute-synthetic-demo). The [public preview](https://dft.jarvisworlds.com) is a no-data boundary page, **not the working scan demo**. Hosted authentication and personal-data features remain disabled. This stabilization pass does not activate a new roadmap phase.

| Available locally                                                                                                                                                                                                        | Incomplete / deferred                                                                                              | Intentionally restricted                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Identifier encryption and fixture verification; purpose-specific consent; queued synthetic scans; retries/cancellation; provenance; findings and observations; full history; finding detail and review; account deletion | General Evidence store, cross-provider equivalence, suppression rules, remediation tracking, export, notifications | Real personal data, live providers, scraping/enumeration, paid calls, hosted data activation |

## Safety boundary

This is a self-monitoring product, not people search. Authentication does not prove control of an identifier. Future sensitive capabilities remain gated by identifier ownership verification, purpose-specific consent, authorization, quotas, audit trails, and provider approval.

The long-lived model remains:

```text
Identity → Identifiers → Scans → Providers → Evidence
         → Findings → Observations → Risk → Remediation
```

The local synthetic path reaches findings and append-only observations. A general Evidence store, risk scoring, and remediation remain future work.

## Current foundation

- Next.js 16 App Router, React, strict TypeScript, and a modular single-application repository.
- PostgreSQL with Drizzle schema and migration files.
- Forced PostgreSQL row-level security on every tenant table, using a restricted runtime role and transaction-local tenant context.
- Clerk adapter for future managed authentication plus a local-only development adapter that is rejected under `NODE_ENV=production`.
- Explicit POST onboarding; render-time reads never create accounts.
- Per-record AES-256-GCM envelope encryption and separate keyed lookup tokens for email identifiers.
- Bounded, restart-safe envelope key rewrap through a function-only database role; lookup-key rotation uses its own separate function-only role and bounded worker (dual-key identifier/deletion-receipt/rate-limit capability, locally verified; production key introduction remains blocked).
- Local fake verification that is hard-gated to `APP_ENV=local` and `AUTH_MODE=local`; it sends nothing.
- A delivery-independent email verification gateway; only the non-delivering local implementation exists.
- Database-atomic per-user and shared-network throttling for every protected mutation, storing only keyed scope tokens.
- A versioned, purpose-specific breach-consent grant/withdrawal flow with privacy-safe audit events, plus the deletion receipt model.
- A PostgreSQL-backed synthetic scan job state machine with opaque UUID payloads, one active scan per capability, expiring claims, bounded retry backoff, pre-claim cancellation, post-response dispatch, and a separately deployable recovery Cron Worker template; the full kill-switch rollback order is exercised end to end by an integration drill.
- Tenant-isolated scan/provider-run/finding history that displays normalized synthetic provenance without retaining raw provider payloads, plus user-visible coverage guidance stating the enabled source, attribution, last completed check, and fixed non-comprehensiveness limits.
- Retry-safe deletion quarantine and bounded retention maintenance through a function-only database role, plus a separately deployable daily Cron Worker template; terminal scan-job detail ages out on a bounded 90-day default while scan history summaries are retained.
- Managed-auth deletion uses Clerk strict reverification and retries only after the strongest available recent credential challenge succeeds; a signed `user.deleted` webhook safely finishes interrupted or provider-initiated deletion.
- Deny-by-default structured logging and synthetic unit/integration coverage.
- GitHub Actions quality/build and restricted-role PostgreSQL integration jobs using synthetic data only.
- Request-scoped Cloudflare Hyperdrive support for restricted runtime, maintenance, and rotation roles; five preview configurations are provisioned, while the public no-data Worker deliberately has none of those bindings attached yet.
- Cloudflare Worker preview with authentication disabled, protected routes redirected to a public boundary page, no database or secrets, and no provider activity.
- Cloudflare builds temporarily isolate local environment files and fail if OpenNext embeds any project environment values in the deployable bundle.
- Dynamic responses are private/no-store and `no-transform`; the deployed browser audit confirms Cloudflare does not inject a Web Analytics script or RUM request.

## Local setup

Use a supported Node LTS release (`.nvmrc` selects Node 22), PostgreSQL, and no paid cloud service.

```bash
npm install
cp .env.example .env.local
openssl rand -base64 32
openssl rand -base64 32
```

Place the two generated values into `ENCRYPTION_KEY` and `LOOKUP_KEY`. Also set `LOOKUP_KEY_ID` to any short opaque string (e.g. `local-lookup-v1`) — it versions the lookup key independently of `ENCRYPTION_KEY_ID` and is not generated key material. Then start PostgreSQL either with the provided local Compose file or an existing local PostgreSQL service. `DATABASE_URL` is the owner/migration connection; `RUNTIME_DATABASE_URL` must use the restricted application role. Update both URLs if needed, then run migrations before granting the runtime role access:

Next.js reads `.env.local`, but the migration CLI and shell commands need exported variables:

```bash
set -a
. ./.env.local
set +a
docker compose up -d --wait
npm run db:migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-runtime-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-rate-limit-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-provider-usage-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-maintenance-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-rotation-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-lookup-rotation-role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-local-delivery-role.sql
npm run dev -- --hostname 127.0.0.1
```

The local verification fixture is `LOCAL_VERIFICATION_CODE` (default `000000`). Use fictional `.test` addresses only while evaluating the demo. Local mode must never be exposed on a shared or production network.

## Five-minute synthetic demo

After setup, change only these three provider settings in `.env.local` (and in your shell if already exported), then restart the development server:

```dotenv
BREACH_PROVIDER=synthetic
FEATURE_BREACH_SCAN=true
BREACH_PROVIDER_KILL_SWITCH=false
```

Keep every other provider disabled, API keys empty, and scheduled scans/email notifications off. The synthetic adapter has no network client; these flags do not enable a live integration. Defaults in `.env.example` remain off.

1. Open `http://127.0.0.1:3000` and choose **Start local demo → Create private foundation**.
2. Follow **Add and verify demo@example.test**. Accept storage consent, add the address, and enter `000000` (or your `LOCAL_VERIFICATION_CODE`). No email is sent.
3. Follow the next-step link to **Privacy**, accept the separate breach-metadata permission, then return to **Overview**.
4. Choose **Run synthetic breach check**, then **Refresh scan status**. The existing post-response dispatcher processes the durable job. Expect a completed scan with **Synthetic Commerce**, fictional provenance, and one tracked finding marked **present / new**.
5. Run a second check and refresh. Expect two recent scans but still one tracked finding. Reload the page: the results persist in PostgreSQL.
6. Optionally withdraw permission in Privacy: the run control becomes unavailable. Account deletion removes the demo account and its linked scans/findings; a limited pseudonymous deletion receipt remains.

The overview shows five recent scans and up to ten tracked findings; the **History** page pages through every stored scan and tracked finding, twenty at a time. Open a tracked finding to see its check history and to mark it reviewed, yours, not yours, or ignored; each of those can be undone. Verification must be recent (within 24 hours); when it ages out, or a code expires or locks, use **Verify again** / **Get a new code** on the Identifiers page. For a fresh walkthrough, delete the synthetic account and start again. If a job remains queued, check the dev-server log and [scan runbook](docs/SCAN_OPERATIONS.md); the recovery Cron Worker is not deployed or scheduled by this demo. Do not repeatedly submit scans to recover stuck work.

See [stabilization verification](docs/STABILIZATION.md) for the actual test and browser evidence, including limitations.

## Validation

```bash
npm run check
npm run build
npm run cf:build
npm run cf:retention:build
npm run cf:breach-scan:build
```

Database integration tests are opt-in so unit tests remain local-service independent:

```bash
TEST_DATABASE_URL=postgres://owner... \
TEST_RUNTIME_DATABASE_URL=postgres://digital_footprint_runtime... \
TEST_MAINTENANCE_DATABASE_URL=postgres://digital_footprint_maintenance... \
TEST_ROTATION_DATABASE_URL=postgres://digital_footprint_rotation... \
TEST_LOOKUP_ROTATION_DATABASE_URL=postgres://digital_footprint_lookup_rotation... \
TEST_DELIVERY_DATABASE_URL=postgres://digital_footprint_delivery... \
npm run test:integration
```

The pinned GitHub Actions workflow runs `npm run check`, the production build, migrations, hosted-path role provisioning, and all PostgreSQL integration tests on pushes to `main` and pull requests. CI uses only synthetic credentials and data.

## Documentation

- [Phase 1 implementation status](docs/PHASE_1_STATUS.md)
- [Clerk authentication and deletion operations](docs/CLERK_OPERATIONS.md)
- [Cloudflare preview operations](docs/CLOUDFLARE_PREVIEW.md)
- [Breach scan Worker operations](docs/BREACH_SCAN_WORKER_OPERATIONS.md)
- [Scan and evidence operations](docs/SCAN_OPERATIONS.md)
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
- [Lookup-key rotation operations](docs/LOOKUP_KEY_ROTATION_OPERATIONS.md)
- [Security requirements](docs/SECURITY.md) and [threat model](docs/THREAT_MODEL.md)
- [Abuse prevention](docs/ABUSE_PREVENTION.md)
- [Legal/provider risks](docs/LEGAL_AND_PROVIDER_RISKS.md)
- [Tradeoffs](docs/TRADEOFFS.md), [risk register](docs/RISK_REGISTER.md), and [open questions](docs/OPEN_QUESTIONS.md)
- [Roadmap](docs/ROADMAP.md), [backlog](docs/BACKLOG.md), and [ADRs](docs/adr/README.md)

## Not implemented

No live provider adapter, real breach lookup, broker workflow, owned-domain check, search/social call, hosted personal-data store, or production authentication configuration exists. The current scan dispatcher includes a local post-response accelerator and a route-less recovery Cron Worker template over the same durable PostgreSQL lease; the template ships with its kill switch on, its synthetic feature flag off, and an all-zero Hyperdrive placeholder, and it is not deployed. The retention and verification-delivery Worker sources are likewise route-less operational templates and are not deployed. The approved synthetic adapter contains no network client and cannot accept a live credential. Contracted or live-provider work must not begin without compatible written terms, legal/ToS/privacy/security review, a nonzero budget decision, and separate owner authorization.

This project is not legal advice. Never commit secrets or real personal data.
