# Cloudflare Preview Operations

## Deployed boundary

The public preview is deployed at `https://dft.jarvisworlds.com` as the Worker `digital-footprint-tracker-preview`.

This deployment is intentionally incapable of handling personal data:

- `AUTH_MODE=disabled` and every protected layout redirects to `/preview`;
- direct protected mutations still require a principal and therefore fail closed;
- there is no database, Clerk, encryption-key, email, scanning-provider, queue, cron, KV, D1, R2, or Durable Object binding;
- only static assets and the non-secret preview configuration in `wrangler.jsonc` are available to the Worker;
- `noindex, nofollow` remains active.

Do not change `AUTH_MODE` until the hosted Clerk, reauthentication, database isolation, trusted ingress, encryption-key, retention, and browser gates in `PHASE_1_STATUS.md` are complete.

## Platform configuration

`wrangler.jsonc` declares the custom domain, current compatibility date, `nodejs_compat`, static-assets binding, and privacy-conscious observability. Invocation logs and traces are disabled because automatic request logging can capture full URLs and query strings. Application logging remains deny-by-default.

Every nonce-bearing application response uses `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate, no-transform`. Besides preventing shared storage of personalized responses, `no-transform` prevents Cloudflare Web Analytics or another edge transformation from injecting browser-side scripts outside the reviewed CSP/telemetry boundary. Static immutable assets retain their separate long-lived cache policy. The live browser network must be rechecked after any cache, analytics, or zone-rule change.

The custom domain is managed by Cloudflare. Wrangler creates the DNS record and certificate association when the Worker trigger is deployed.

Next.js 16's `proxy.ts` convention is Node-only, while the current OpenNext adapter requires Edge middleware. The repository therefore retains `src/middleware.ts` as a documented compatibility bridge. Remove it only after an adapter release supports the Node proxy bundle and the production CSP/authentication behavior has been revalidated.

## Validate and deploy

Use Node 22 and an authenticated Wrangler session:

```bash
npm ci
npm run check
npm run audit:production
npm run cf:build
npm run cf:typecheck
npx wrangler deploy --dry-run
npm run deploy
```

The deploy script sets OpenNext's recursion guard before invoking Wrangler directly. This avoids Wrangler delegating back into OpenNext while still deploying the adapter-generated `.open-next/worker.js` and assets.

`npm run cf:build` temporarily moves the ignored `.env.local` out of the project while Next/OpenNext compiles, restores it on exit, and then requires every generated OpenNext environment manifest to be empty. Runtime configuration must come from Cloudflare variables, secrets, and bindings. This prevents local database URLs, fixture keys, and provider settings from being copied into an uploaded Worker version.

Before that build starts, `npm run cf:verify:boundaries` parses both committed Wrangler files as comment-free JSONC with only standard trailing commas tolerated. It requires the web preview to remain `AUTH_MODE=disabled`, permits only its four reviewed public variables and static-assets binding, rejects data/storage/queue/AI/service bindings and secret-like variables, and keeps invocation logs/traces off. It separately requires the retention example to remain route-less with only its all-zero maintenance Hyperdrive placeholder, fixed Cron, and bounded variables. The retention dry-build runs the same verifier. Enabling hosted data therefore requires an explicit review and replacement of this no-data guard; changing Wrangler configuration alone fails CI and deployment.

After deployment, verify at minimum:

```bash
curl -I https://dft.jarvisworlds.com/
curl -I https://dft.jarvisworlds.com/preview
curl -I https://dft.jarvisworlds.com/dashboard
```

The public routes must return `200`; the protected route must redirect to `/preview`; all must use HTTPS and carry the production security headers, including `no-transform`. Complete a Chrome DevTools console/network pass and confirm that no analytics beacon or `/cdn-cgi/rum` request appears, then complete keyboard, mobile-overflow, and Lighthouse checks before widening scope.

## Rollback

List recent deployments, select the last known-good version, and record the reason:

```bash
npx wrangler deployments list --name digital-footprint-tracker-preview
npx wrangler rollback <version-id> --name digital-footprint-tracker-preview --message "rollback reason"
```

Rollback changes the Worker version, not this repository. Follow it with a Git revert or corrective commit so the tracked configuration matches the live deployment.

## Future hosted data work

The application database boundary is prepared for Hyperdrive but the public preview has no database binding. Outside local development it accepts only request-context bindings named `RUNTIME_DATABASE`, `MAINTENANCE_DATABASE`, and `ROTATION_DATABASE`; it creates and closes clients per operation rather than caching them at module scope. Before attaching a runtime binding, provision the same restricted roles and forced RLS, run migrations with an owner credential that never enters a Worker, and repeat the complete synthetic integration and browser suites.
