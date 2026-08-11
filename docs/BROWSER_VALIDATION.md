# Local Browser Validation

**Audit date:** 2026-08-11  
**Scope:** Phase 1 local foundation with synthetic data only  
**Tooling:** Chrome DevTools MCP and Lighthouse against the Next.js development server

## Results

- Direct access to a protected route redirected an uninitialized local principal to onboarding.
- Direct access to Privacy after account deletion also redirected to onboarding at the leaf page.
- Explicit onboarding created the private account foundation; a subsequent dashboard load succeeded.
- A synthetic `.invalid` email was encrypted, displayed only in masked form, and verified with the local-only fixture. No message or provider request was sent.
- An incorrect deletion confirmation was denied and announced through an assertive alert.
- Confirmed deletion removed the synthetic account data, displayed a pseudonymous receipt, and caused the next protected-route request to redirect to onboarding again.
- The first keyboard tab stop was the skip link; activating it moved focus to the `main` landmark.
- The 320 px and 412 px mobile viewports had no page-level horizontal overflow. The narrow navigation remains intentionally horizontally scrollable.
- Every observed resource request used `http://localhost:3000`; no external origin was contacted.
- The final public-page and mutation-error checks produced no console errors, warnings, or browser issues.
- After the RLS migration, the complete onboarding → encrypted synthetic email → local verification → deletion flow was repeated through `RUNTIME_DATABASE_URL` as the restricted role. It completed successfully, the server emitted no errors, and the preserved Chrome console remained clean.
- After distributed action throttling and the delivery-neutral verification gateway were added, the complete flow was repeated again. Onboarding, masked identifier display, local verification, and deletion all succeeded; the browser console, browser issue panel, and server log remained clean.

## Automated audit

The protected privacy page scored:

| Category         | Score |
| ---------------- | ----: |
| Accessibility    |   100 |
| Best practices   |   100 |
| Agentic browsing |   100 |
| SEO              |    60 |

The only failed Lighthouse audit was crawlability. This is intentional: the foundation sets `noindex, nofollow` and is not ready for public indexing.

## Performance baseline

The public page was traced at a 412 × 915 mobile viewport, Fast 4G network emulation, and 4× CPU slowdown:

| Metric | Observed value |
| ------ | -------------: |
| TTFB   |          46 ms |
| LCP    |         682 ms |
| CLS    |           0.00 |

The only quantified opportunity was the required global stylesheet, estimated at 121 ms of FCP/LCP savings if it were removed from the critical path. It is small, first-party, and required for the initial layout, so no change is recommended from this development trace. There was no field/CrUX data and no interaction sample from which to calculate INP.

## Browser security baseline

Responses now include a per-request nonce CSP with `strict-dynamic`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'none'`. Next.js framework scripts and styles receive the nonce. Development alone permits `unsafe-eval` for React debugging and an inline-style allowance required by the development font/runtime; production policy generation omits both allowances. The route announcer's style attribute has a narrowly scoped `style-src-attr` allowance.

Existing `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `X-Frame-Options` headers were also present. HSTS requires the future HTTPS preview/production environment and was not evaluated over localhost.

## Remaining limits

- This is a local lab result, not field performance or a production deployment audit.
- Local authentication is deliberately rejected under `NODE_ENV=production`, so a production-runtime browser audit depends on the isolated Clerk preview gate.
- Clerk session, MFA/passkey, recovery, webhook, and managed reauthentication behavior remain untested.
- Multi-user browser authorization tests still require a managed-auth preview or a dedicated browser test harness with isolated principals.
