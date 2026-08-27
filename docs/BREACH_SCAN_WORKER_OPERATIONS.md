# Breach Scan Worker Operations

## Current boundary

`workers/breach-scan.ts` is a separately deployable recovery consumer for the synthetic `scan_jobs` state machine. It does not create recurring scans: users still initiate every scan from the authenticated dashboard. The Cron only resumes already-authorized, already-queued work whose `not_before` time is due or whose prior lease expired.

The committed `wrangler.breach-scan.example.jsonc` is deliberately inert:

- it has no route, assets, service, queue, storage, AI, or provider-secret binding;
- `SCAN_KILL_SWITCH` is `true`, and any value other than exact `false` blocks execution;
- `SCAN_SYNTHETIC_ENABLED` is `false`, and only exact `true` passes the independent provider gate;
- `SCAN_DATABASE` contains an all-zero Hyperdrive placeholder;
- the only provider bundled is the zero-network synthetic fixture adapter; and
- automatic invocation logs and traces are disabled. Application events pass through the repository's deny-by-default telemetry sanitizer.

This template is not deployed. Changing either gate or the placeholder causes the committed deployment-boundary verifier to fail by design.

## Processing model

Once per minute, an explicitly activated copy would:

1. validate the scheduled timestamp, batch limit, and lease duration before constructing a database client;
2. claim at most 10 due jobs through `claim_breach_scan_jobs`, using a single opaque lease token and `FOR UPDATE SKIP LOCKED` inside the function;
3. process each claim sequentially in its own transaction after setting only that job's `app.auth_subject` RLS context;
4. revalidate account state, identifier verification freshness, consent scope, idempotency, provider capability, and request/cost quotas;
5. persist completed findings, a bounded retry, or terminal dead-letter state; and
6. close the single Hyperdrive-backed Postgres.js client before the invocation ends.

A processor-level database or runtime failure is isolated to one job. The Worker logs only its opaque job ID and a fixed safe error code; the lease remains `CLAIMED` until expiry, after which a later invocation can recover it. A claim-level database failure rejects the invocation because no usable batch was returned.

## Local verification

The template can be verified without uploading or activating it:

```bash
npm run cf:standalone:typecheck
npm run cf:verify:boundaries
npm run cf:breach-scan:build
```

The last command is a Wrangler dry run. It bundles the Worker and reports the placeholder binding surface but does not deploy it.

Database integration coverage requires the owner and restricted runtime test URLs documented in the root README. It applies the full migration chain and proves due-batch claims plus isolated two-tenant processing against real PostgreSQL RLS.

## Activation remains blocked

Do not deploy an activated copy until the hosted runtime database, authentication, encryption-key, privacy, retention, backup, monitoring, and rollback gates are approved and exercised. Activation must also use an environment-owned Wrangler configuration with a reviewed runtime-role Hyperdrive ID; an owner or migration credential must never enter the Worker.

This Worker does not authorize a live provider. A real provider still requires compatible written terms, legal/ToS/privacy/security review, a credential binding, egress review, nonzero budget approval, adapter contract tests, sandbox evidence, and separate owner authorization.
