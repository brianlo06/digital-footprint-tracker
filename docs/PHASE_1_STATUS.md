# Phase 1 Foundation Status

**Status:** In progress — the first local foundation milestone is implemented and verified; it is not production-ready.

## Implemented scope

| Capability              | State                       | Boundary                                                                   |
| ----------------------- | --------------------------- | -------------------------------------------------------------------------- |
| Application shell       | Implemented                 | Responsive, semantic, keyboard-checked foundation UI; no finding screens   |
| Authentication boundary | Implemented                 | Clerk adapter plus local-only adapter; local mode rejects production       |
| Account onboarding      | Implemented                 | Explicit authenticated Server Action; GET/render paths are read-only       |
| Identifier model        | Implemented for email only  | Separate identity/identifier records; no scan capability                   |
| Identifier protection   | Implemented                 | Per-record AES-256-GCM envelope; keyed lookup token; tested key rewrap     |
| KEK rotation batches    | Local procedure verified    | Bounded dry-run/resume/rollback; production KMS and invocation not chosen  |
| Verification            | Local fake only             | 15-minute, single-use challenge; atomic five-attempt lockout; no delivery  |
| Verification gateway    | Interface implemented       | Local non-delivery implementation only; no provider selected               |
| Mutation throttling     | Local baseline verified     | Atomic user/network limits; hosted trusted-IP source not configured        |
| Consent and audit       | Foundation implemented      | Scoped consent and allowlisted events; no provider consent yet             |
| Account deletion        | Local lifecycle implemented | Cascades foundation data; pseudonymous receipt retained for one year       |
| Deletion failure        | Quarantined and retryable   | Pending accounts lose normal access; receipt identity is reused            |
| Managed-auth deletion   | Fail-closed                 | Requires a stable recent-login/MFA flow before enablement                  |
| Retention               | Bounded service implemented | Function-only role; no scheduler; purges only eligible metadata            |
| Database isolation      | Local RLS baseline verified | Forced policies plus restricted runtime role; hosted roles not provisioned |
| Browser security        | Local baseline implemented  | Nonce CSP and restrictive headers; HTTPS/HSTS awaits preview               |
| Tests                   | Hardened baseline           | Unit plus opt-in PostgreSQL authorization/lifecycle integration tests      |
| Providers/scans/jobs    | Not implemented             | Contracts/readmes only; zero provider network activity                     |

## Verified locally

- formatting, ESLint, strict TypeScript, unit tests, and production build;
- migration against isolated local PostgreSQL;
- concurrent account initialization converges on one account and identity;
- a synthetic email is normalized, encrypted, masked, verified, and deleted;
- database ciphertext does not contain the normalized synthetic email;
- cross-account list and verification attempts are denied;
- the real restricted runtime role is non-superuser and lacks `BYPASSRLS`;
- all eight protected tables have enabled and forced PostgreSQL RLS;
- missing tenant context fails closed, transaction-local context does not leak through the pool, and direct cross-tenant reads/writes are denied;
- deletion receipts are isolated by a pseudonymous subject token after the user row is gone;
- the maintenance login has no tenant-table access, the web role cannot invoke retention, and the narrowly granted RLS-bypass function owner cannot log in;
- direct Server Actions cannot bypass onboarding or mutate another account's verification/deletion state;
- ten concurrent incorrect guesses produce exactly five accepted attempts and a revoked challenge;
- ten concurrent same-user onboarding attempts allow exactly five, while twenty-one distinct users on one synthetic network allow exactly twenty;
- limiter rows contain only namespace-separated keyed tokens, the web role has function-only access, and expired state is retention-eligible;
- email enrollment depends on a delivery-neutral gateway whose only implementation refuses non-local operation and sends nothing;
- deletion without recent-reauthentication authorization leaves the account intact;
- auth-provider deletion failure quarantines the account and a retry completes against the same receipt;
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
- production startup rejects local authentication;
- production dependency audit reports no known vulnerabilities.

## Remaining Phase 1 gates

1. Configure and exercise Clerk in an isolated preview tenant with MFA/passkey, session, recovery, webhook, privacy/DPA, and deletion tests.
2. Select a stable reauthentication mechanism for destructive account deletion; keep the action disabled for Clerk until then.
3. Reproduce and inspect the verified local RLS, runtime-role, and function-only retention boundaries in the hosted preview before it handles multi-user personal data.
4. Configure and verify the trusted ingress IP source in hosted preview, calibrate the implemented distributed limits, and approve an idempotent delivery provider/outbox before replacing the local fake gateway.
5. Reproduce the verified batch rewrap, rollback, and recovery procedure against an approved production KMS with monitored invocation; separately design and approve lookup-token rotation because it requires controlled plaintext access and coordinated cutover.
6. Add hosted CI and repeat browser accessibility/security checks in an HTTPS production preview after repository hosting is selected; the local Chrome audit is recorded in `BROWSER_VALIDATION.md`.
7. Approve legal retention periods and add a least-privileged, monitored invocation mechanism for the bounded retention service; no scheduler exists today.

## Dependency note

Production dependencies currently audit clean. Development-only `drizzle-kit` transitively includes an esbuild advisory associated with development servers. Do not expose Drizzle Studio or development tooling to a network; use the CLI locally, keep it out of production dependencies/images, and monitor upstream updates. Do not force an incompatible audit downgrade.

## Explicit non-goals

No search, breach, broker, social, domain, email, scheduling, notification, scoring, matching, finding, observation, or remediation functionality is part of this milestone. No external API was called and no infrastructure was deployed.
