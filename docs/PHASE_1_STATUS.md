# Phase 1 Foundation Status

**Status:** Complete as of 2026-08-15 — the secure local-first foundation and its no-data public preview meet the Phase 1 exit criteria. Personal-data features remain disabled and are not production-ready.

## Closure decision

Phase 1 is closed against the scope and exit criteria committed in `ROADMAP.md`: a local-first application foundation, no real scanning or providers, a synthetic add/mask/delete lifecycle, and verified logging and tenant-isolation boundaries. The production-oriented work previously listed as remaining Phase 1 work is retained below as pre-production activation gates.

This closure does **not** approve a vendor, legal retention period, production key custodian, hosted personal-data path, email delivery, scheduled maintenance, or provider integration. Those capabilities must remain disabled until their applicable activation gates are explicitly approved and exercised together.

## Implemented scope

| Capability                   | State                       | Boundary                                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application shell            | Implemented                 | Responsive, semantic, keyboard-checked foundation UI; no finding screens                                                                                                                                                                          |
| Authentication boundary      | Implemented, hosted off     | Preview mode fails closed; Clerk adapter exists; local mode rejects production                                                                                                                                                                    |
| Account onboarding           | Implemented                 | Explicit authenticated Server Action; GET/render paths are read-only                                                                                                                                                                              |
| Identifier model             | Implemented for email only  | Separate identity/identifier records; no scan capability                                                                                                                                                                                          |
| Identifier protection        | Implemented                 | Per-record AES-256-GCM envelope; keyed lookup token; tested key rewrap                                                                                                                                                                            |
| KEK rotation batches         | Local procedure verified    | Bounded dry-run/resume/rollback; production KMS and invocation not chosen                                                                                                                                                                         |
| Lookup-key rotation          | Local procedure verified    | Additive dual-key schema/app logic and bounded token-migration worker; production KMS and cutover not chosen                                                                                                                                      |
| Verification                 | Local fake only             | 15-minute, single-use challenge; atomic five-attempt lockout; no delivery                                                                                                                                                                         |
| Verification gateway         | Interface implemented       | Local non-delivery implementation only; no provider selected                                                                                                                                                                                      |
| Verification delivery outbox | Local procedure verified    | Additive encrypted transactional outbox, claim/complete/report-failure functions, function-only delivery role, demonstration Worker against a synthetic provider, and a route-less dry-build template; no provider selected, no hosted deployment |
| Mutation throttling          | Local baseline verified     | Atomic limits; Cloudflare trusted-IP header declared, hosted exercise pending                                                                                                                                                                     |
| Consent and audit            | Foundation implemented      | Scoped consent and allowlisted events; no provider consent yet                                                                                                                                                                                    |
| Application telemetry        | Canary boundary verified    | Field validators, redaction marker, sink-bypass scan; hosted traces remain off                                                                                                                                                                    |
| Account deletion             | Local lifecycle implemented | Cascades foundation data; pseudonymous receipt retained for one year                                                                                                                                                                              |
| Deletion failure             | Quarantined and retryable   | Pending accounts lose normal access; receipt identity is reused                                                                                                                                                                                   |
| Managed-auth deletion        | Implemented, preflight only | Development-tenant handshake/sign-in surface verified; strict reverification plus signed, retry-safe deletion recovery webhook remains unexercised with a tenant user                                                                             |
| Retention                    | Worker template implemented | Function-only daily Cron dry-builds and maintenance Hyperdrive provisioned; schedule/period approval remains                                                                                                                                      |
| Database isolation           | Hosted preview verified     | Neon forced policies, five restricted logins, five `NOBYPASSRLS` capability owners, read-only attestation, and 46-test hosted exercise passed                                                                                                     |
| Worker database clients      | Provisioned, not attached   | Five cache-disabled TLS Hyperdrives exist; live no-data Worker intentionally retains no database binding                                                                                                                                          |
| Browser security             | HTTPS preview verified      | Nonce CSP, HSTS, restrictive headers, and protected-route redirect checked                                                                                                                                                                        |
| Cloud deployment             | Public shell deployed       | `dft.jarvisworlds.com`; no auth, database, secrets, or personal-data paths                                                                                                                                                                        |
| Tests                        | Hosted CI verified          | Unit/build plus PostgreSQL authorization/lifecycle jobs on GitHub Actions                                                                                                                                                                         |
| Providers/scans/jobs         | Not implemented             | Contracts/readmes only; zero provider network activity                                                                                                                                                                                            |

## Verification evidence

- formatting, ESLint, strict TypeScript, unit tests, and production build;
- migration against isolated local PostgreSQL;
- concurrent account initialization converges on one account and identity;
- a synthetic email is normalized, encrypted, masked, verified, and deleted;
- database ciphertext does not contain the normalized synthetic email;
- cross-account list and verification attempts are denied;
- the real restricted runtime role is non-superuser and lacks `BYPASSRLS`;
- all ten protected tables have enabled and forced PostgreSQL RLS;
- a bounded read-only database preflight attests the complete standard-role, table-policy, privilege, capability-owner, `PUBLIC` execution, and fixed-`search_path` contract and runs in CI after provisioning;
- the same migrations, ten-role boundary, read-only attestation, and complete 46-test restricted-role suite pass against the isolated Neon preview database; five purpose-specific Cloudflare Hyperdrives require TLS, disable query caching, and cap origin connections at five;
- missing tenant context fails closed, transaction-local context does not leak through the pool, and direct cross-tenant reads/writes are denied;
- deletion receipts are isolated by a pseudonymous subject token after the user row is gone;
- the maintenance login has no tenant-table access, the web role cannot invoke retention, and the narrowly granted `NOBYPASSRLS` function owner cannot log in;
- direct Server Actions cannot bypass onboarding or mutate another account's verification/deletion state;
- ten concurrent incorrect guesses produce exactly five accepted attempts and a revoked challenge;
- ten concurrent same-user onboarding attempts allow exactly five, while twenty-one distinct users on one synthetic network allow exactly twenty;
- limiter rows contain only namespace-separated keyed tokens, the web role has function-only access, and expired state is retention-eligible;
- email enrollment depends on a delivery-neutral gateway whose only implementation refuses non-local operation and sends nothing;
- deletion without recent-reauthentication authorization leaves the account intact;
- auth-provider deletion failure quarantines the account and signed provider confirmation completes against the same receipt;
- signed Clerk `user.deleted` events resume local purge without calling the provider, duplicate delivery is idempotent, and invalid signatures/events fail before database access;
- the installed Clerk verifier accepts a correctly signed current synthetic deletion event and rejects both post-signature body tampering and a correctly signed stale timestamp;
- bounded retention consumes expired challenges, removes expired completed receipts/orphan audits, and preserves failed receipts;
- envelope key rewrap preserves ciphertext and decrypts only under the replacement key;
- bounded envelope batches support dry-run, interruption recovery, and rollback through a function-only rotation role without decrypting identifier plaintext;
- provider source contains no executable adapter or network client;
- public and protected development routes render without creating duplicate accounts;
- local Chrome flow covers onboarding, masked identifier verification, deletion denial/success, and post-deletion redirect;
- keyboard skip navigation moves focus to the main landmark, with no page-level overflow at 320 px and 412 px;
- Lighthouse reports 100 accessibility and best-practices scores on the protected privacy page;
- a throttled mobile development trace reports 46 ms TTFB, 682 ms LCP, and 0.00 CLS;
- all audited browser resources remained on localhost and the final console was clean;
- response scripts/styles carry a per-request CSP nonce and restrictive browser headers are present;
- Clerk's development-tenant browser handshake and sign-in surface load under the nonce CSP without a policy violation, and a signed-out protected route redirects without logging an authentication exception;
- the HTTPS Cloudflare preview serves its public pages, sends HSTS and the production nonce CSP, and redirects protected routes to `/preview`;
- the hosted preview Worker has only a static-assets binding and four non-secret configuration variables; authentication, database, provider, key, email, and scheduling bindings are absent;
- every web build/deploy and standalone dry-build fails unless the committed Wrangler configurations preserve the exact no-data web boundary and each route-less placeholder-only background boundary; verification delivery keeps its Secrets Store key out of plain `vars`, while delivery and breach-scan kill switches ship default-on and the breach synthetic flag ships default-off;
- Chrome DevTools verified the live semantic page structure, first-party application assets, protected-route boundary, and browser console after deployment;
- a follow-up live network audit detected and then eliminated Cloudflare Web Analytics injection through a private/no-store/`no-transform` response policy; the deployed cache-bypassing recheck contained no analytics script or RUM request;
- the centralized logger rejects synthetic email, token, cookie, URL, database, ciphertext, request-body, and log-injection canaries from known and unknown fields, including delivery-specific destination, code, content, provider-credential, and provider-response canaries;
- a source-boundary test prevents direct console/stdout/stderr logging and telemetry SDK imports across both application code and standalone Workers; every committed Worker configuration disables automatic invocation logs and application traces;
- production startup rejects local authentication;
- production dependency audit reports no known vulnerabilities.
- managed deletion requires subject continuity plus Clerk strict reverification before consuming the deletion rate limit or mutating data;
- the managed deletion UI retries the Server Action only after Clerk completes its strongest available credential challenge and treats cancellation as a no-op;
- hosted database helpers accept only request-context Hyperdrive bindings and close their Postgres.js clients after each operation;
- a route-less retention Cron Worker validates its scheduled time and bounded settings before database-client construction, reuses the retention core through a distinct generated maintenance binding, and dry-builds in CI; and
- the Cloudflare build fails if OpenNext embeds any `.env` project values, preventing local database URLs or key material from entering an uploaded bundle.
- GitHub Actions runs pinned quality/build actions and the complete synthetic PostgreSQL restricted-role integration suite; the first hosted run passed both jobs.
- dual-key identifier equality writes a token per active key in one tenant transaction, and duplicate enrollment under either key is denied;
- a previous-key deletion receipt is migrated to the current key in place inside the same transaction as its lock and upsert, exactly once, with no duplicate row;
- a completed receipt created under a previous key ages out untouched, and idempotent webhook replay against it stays read-only;
- the extended tenant-isolation policy still fails closed when both current and previous subject-token settings are absent;
- the bounded lookup-token rotation worker supports dry-run and restart-safe batching, reports a stale envelope, a removed identifier, and an undecryptable envelope as distinct opaque outcomes rather than aborting the batch, and its legacy-token backfill skips a parent removed by concurrent account deletion without widening the function owner's table privileges;
- its function-only role cannot read `identifiers` or `identifier_lookup_tokens` directly and can execute only its own three functions; and
- dual-key rate-limit consumption seeds a missing window from its counterpart and persists an identical resulting state under both keys, so a rotation never resets abuse counters;
- the verification delivery outbox row commits atomically with the identifier, verification, consent, and audit rows in the same tenant transaction, and a forced failure elsewhere in that transaction rolls the outbox row back too, not just independently;
- concurrent claim calls against a real multi-connection pool never double-claim a delivery, and their union covers every eligible row;
- a claimed delivery whose lease has expired can be reclaimed under a new lease token, and a stale lease token is rejected with the row left unchanged;
- an ineligible delivery (expired, revoked, locked, or already-verified challenge, or a `DELETION_PENDING` account) is cancelled and its encrypted payload destroyed without being returned;
- completion and dead-lettering both destroy the encrypted payload, and a transient failure reschedules with advancing backoff before automatically dead-lettering at `max_attempts`, while a permanent failure dead-letters immediately regardless of attempt count; and
- the delivery login has no direct table privileges and can execute only its own three functions, and every other purpose-specific login is denied execution of those same functions in both directions;
- verification-delivery commands reject non-normalized destinations, non-six-digit codes, extra fields, malformed authenticated plaintext, and value-bearing decode errors before a provider can receive them; poison commands dead-letter, key/decryption failures preserve ciphertext for recovery, and Worker-core tests keep the kill switch default-on while routing success, permanent rejection, throttling, transient outcomes, and thrown provider calls to their exact compare-and-swap operations; and
- Wrangler-generated binding types for all three standalone Workers are checked against their committed configurations, preventing code/config drift without attaching any hosted binding.

## Pre-production activation gates

These gates do not block the completed local foundation milestone. They block any hosted path that handles personal data and, where applicable, the later phase that depends on that path.

1. Configure and exercise Clerk in an isolated preview tenant with MFA/passkey, session, recovery, the implemented signed `user.deleted` endpoint, privacy/DPA, and deletion tests.
2. Exercise the implemented Clerk strict-reverification deletion flow with password, passkey/MFA, cancellation, stale session, recovery, provider deletion failure, and successful deletion in that tenant.
3. Attach the runtime Hyperdrive only together with approved Clerk and key bindings, exercise the declared Cloudflare trusted ingress IP source with that hosted data path, and calibrate the implemented distributed limits.
4. Select and approve a delivery provider for [ADR 0017](adr/0017-verification-delivery-outbox.md), whose additive encrypted transactional outbox and dedicated Hyperdrive are implemented and hosted-database verified. Provider selection, a hosted delivery Worker deployment, production activation, and the ADR's eight-item Activation Evidence exercise remain blocked before the local fake gateway can be replaced.
5. Reproduce the verified batch rewrap, rollback, and recovery procedure against an approved production KMS with monitored invocation. [ADR 0016](adr/0016-lookup-key-rotation.md)'s dual-key capability is implemented and hosted-database verified; production cutover still requires an approved KMS/HSM, dual-key/rollback duration approval, backup-compatibility review, and irreversible key-destruction authority per the ADR's approval questions.
6. Repeat the multi-user and managed-auth browser checks after Clerk and the data/key bindings are activated; the no-data HTTPS preview baseline is recorded in `BROWSER_VALIDATION.md`.
7. Approve legal retention periods, attach the provisioned maintenance Hyperdrive to the isolated retention Worker, deploy its daily Cron, and verify Cron Events/alerts and backup/tombstone behavior.

## Closure verification

The Phase 1 closure was revalidated on 2026-08-15 with:

- `npm run check` — formatting, lint, strict TypeScript, and 141 service-independent tests passed;
- the separately gated 46-test PostgreSQL suite remained represented by the recorded restricted-role local, CI, and Neon preview evidence above;
- `npm run build` — the Next.js production build passed;
- `npm run audit:production` — zero known production dependency vulnerabilities;
- `npm run cf:standalone:typecheck` and `npm run cf:verify:boundaries` — Worker bindings and deployment boundaries passed; and
- `npm run cf:retention:build`, `npm run cf:verification-delivery:build`, and `npm run cf:breach-scan:build` — all three route-less Worker templates dry-built with placeholder-only bindings.

## Dependency note

Production dependencies currently audit clean. Development-only `drizzle-kit` transitively includes an esbuild advisory associated with development servers. Do not expose Drizzle Studio or development tooling to a network; use the CLI locally, keep it out of production dependencies/images, and monitor upstream updates. Do not force an incompatible audit downgrade.

## Explicit non-goals

No search, breach, broker, social, domain, email, scheduling, notification, scoring, matching, finding, observation, or remediation functionality is part of this milestone. The deployed infrastructure serves only the no-data preview shell; no provider API is called.
