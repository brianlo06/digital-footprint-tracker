# Portfolio stabilization evidence

This pass is limited to the existing local synthetic workflow. No provider, migration, production deployment, or new roadmap milestone was added. Provider defaults and privacy/security enforcement remain unchanged.

## PostgreSQL failure diagnosis

The latest recorded [CI run 33240234623](https://github.com/brianlo06/digital-footprint-tracker/actions/runs/33240234623) failed in `finding-temporal-model.test.ts`: observation retention returned zero deletions where the test expected at least two.

Two integration suites invoke a database-wide retention sweep concurrently against the same database. After one suite ages its fixtures, the other can consume those rows before the first checks its own deletion count. A controlled interleaving (a second maintenance call between aging and the asserted call) reproduced the exact zero-deletions failure locally. The unmodified suite also exposed four stale-verification failures because scan clocks were fixed to August 2026 while identifier verification used current time.

Changes:

- Both retention suites hold a shared PostgreSQL advisory lock across fixture setup, maintenance, assertions, and cleanup. This is test isolation only; production retention still uses its existing bounded `SKIP LOCKED` implementation.
- Temporal scans use ordered clocks relative to verification, preserving the real authorization gate.
- The temporal suite explicitly requires and assigns `TEST_MAINTENANCE_DATABASE_URL`.
- Retention fixtures remain ordered when aged; the assertion checks the exact newest observation ID and an idempotent second sweep.
- The degraded-absence test now uses the same provider scope and an empty unhealthy result, asserting an `INDETERMINATE` observation. Previously it used a different scope and did not assert the claimed absence behavior.

## Verification

Local validation on 2026-10-12 used a disposable PostgreSQL 17 instance, synthetic credentials/identifiers, the full migration chain, and the same hosted-style restricted-role provisioning path as CI. No existing database was used.

- Migrations and database authorization boundary verification passed.
- All 71 integration tests passed three consecutive runs with file parallelism retained, then passed again after cleanup refinements.
- `npm run check` passed: formatting, ESLint, TypeScript, and 296 service-independent tests. Its 71 database tests were skipped by design and verified separately above.

- `npm run build` passed. It still reports the pre-existing Next.js middleware-to-proxy deprecation; migration was outside this pass.
- `npm run db:check` and `npm run cf:verify:boundaries` passed. Cloudflare packaging/worker dry-runs and dependency audit were not rerun; no deployment was attempted.

## Browser walkthrough

Chrome against a loopback-only Next.js development server and the disposable database:

- Created a fresh local account, added `demo@example.test`, verified with the fixture code, and granted separate breach-metadata consent using the actual forms.
- Submitted a scan, observed the queued state, and refreshed to see a completed Synthetic Commerce result and provenance.
- Submitted a second scan and refreshed: two completed history entries, one tracked finding, unchanged first-seen timestamp and advanced last-seen/check timestamps. A full-page refresh retained the results.
- Withdrew consent through Privacy and returned to Overview: the scan control was absent while the two history entries remained visible.
- Restarted with provider defaults disabled: the source count was zero, the run control was absent, and configuration guidance was visible.
- Inspected the narrow layout at an actual 500 CSS-pixel viewport: no horizontal overflow; labels, history, and controls remained readable. This is not a comprehensive mobile/accessibility audit.
- No browser console errors/warnings were reported in the inspected navigation history. The refreshed dashboard loaded no cross-origin resources. Server-side no-network provider behavior is also covered by the existing provider boundary tests; browser resource inspection alone cannot prove it.

## Remaining limits

This does not establish a green remote CI run; changes have not been pushed. It is not a production, legal, provider-terms, penetration, or full accessibility audit. Hosted activation, live data/providers, paid calls, and worker deployment remain blocked. General Evidence persistence, equivalence groups, review/remediation controls, export, notifications, complete history browsing, and identifier re-verification UI remain unfinished.
