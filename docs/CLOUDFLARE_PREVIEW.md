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

After deployment, verify at minimum:

```bash
curl -I https://dft.jarvisworlds.com/
curl -I https://dft.jarvisworlds.com/preview
curl -I https://dft.jarvisworlds.com/dashboard
```

The public routes must return `200`; the protected route must redirect to `/preview`; all must use HTTPS and carry the production security headers. Complete a Chrome DevTools console, network, keyboard, mobile-overflow, and Lighthouse pass before widening scope.

## Rollback

List recent deployments, select the last known-good version, and record the reason:

```bash
npx wrangler deployments list --name digital-footprint-tracker-preview
npx wrangler rollback <version-id> --name digital-footprint-tracker-preview --message "rollback reason"
```

Rollback changes the Worker version, not this repository. Follow it with a Git revert or corrective commit so the tracked configuration matches the live deployment.

## Future hosted data work

The existing `postgres` client is suitable for the local foundation but must not be enabled as a process-global client in Workers. Before connecting hosted PostgreSQL, select a supported Cloudflare connection strategy such as Hyperdrive, construct request-safe clients, provision the same restricted roles and forced RLS, and repeat the complete synthetic integration and browser suites. Never attach an owner/migration database URL to the web Worker.
