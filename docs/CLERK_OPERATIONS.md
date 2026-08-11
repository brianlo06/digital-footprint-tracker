# Clerk Authentication and Deletion Operations

**Status:** Phase 1 application boundary implemented; isolated hosted-tenant configuration and exercises remain required.

## Required configuration

Clerk mode requires all three values:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` as a non-secret Worker variable;
- `CLERK_SECRET_KEY` as a Worker secret; and
- `CLERK_WEBHOOK_SIGNING_SECRET` as a distinct Worker secret.

The root layout passes the publishable key to `ClerkProvider` at request time. This preserves the Cloudflare build rule that no project `.env` value may be embedded in the deployable OpenNext bundle. Never commit or place either secret in Wrangler `vars`.

Keep `AUTH_MODE=disabled` until the isolated Clerk tenant, restricted hosted database, Hyperdrive binding, encryption keys, and remaining gates in `PHASE_1_STATUS.md` are ready together. A partial enablement fails closed but is not a supported deployment.

## Deletion webhook

Create one Clerk webhook endpoint at:

```text
https://<preview-host>/api/webhooks/clerk
```

Subscribe it only to `user.deleted`, then copy that endpoint's signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`. The route is public so Clerk can deliver it, but it:

- returns 404 unless `AUTH_MODE=clerk`;
- rejects an oversized body before verification, with or without a declared length;
- verifies the Svix signature and timestamp through Clerk's server SDK before reading an event subject;
- accepts only a bounded Clerk user ID from `user.deleted`;
- returns 503 on transient local-processing failure so Clerk retries; and
- never logs the body, headers, subject, secret, or verification error.

The verified Clerk subject establishes the same transaction-local PostgreSQL RLS context as a signed-in user. The handler does not use an owner or maintenance connection. It marks the existing receipt `AUTH_REVOKED`, quarantines the user if needed, cascades local foundation data, anonymizes retained audit targets, and completes the pseudonymous receipt. The operation is idempotent when Clerk redelivers the event or it races the user-facing deletion action.

## Hosted acceptance exercise

Use synthetic identities in the isolated preview tenant and record evidence for:

1. password and passkey/MFA strict-reverification success;
2. challenge cancellation, stale session, recovery, and wrong-subject denial;
3. successful in-app deletion and receipt completion;
4. Clerk-dashboard deletion followed by local purge;
5. simulated provider failure followed by signed webhook recovery;
6. duplicate webhook delivery with no duplicate account or receipt;
7. invalid signature, malformed event, and unrelated event rejection/acknowledgement; and
8. Clerk delivery attempts, retry behavior, application error alerting, and a clean privacy-safe log review.

Afterward, confirm the synthetic user graph is absent, the single pseudonymous receipt is `COMPLETED`, no identifier plaintext entered logs or build artifacts, and the Worker has only the intended Clerk, key, and restricted Hyperdrive bindings.
