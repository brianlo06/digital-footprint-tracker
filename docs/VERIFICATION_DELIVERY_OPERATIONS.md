# Verification Delivery Operations

## Current boundary

No email is sent. `LocalFakeEmailVerificationGateway` works only with local authentication in the local environment, returns a fixture challenge, and refuses preview, production, or managed-auth operation. The public Cloudflare preview has no email provider, delivery Worker, delivery database binding, key reference, secret, queue, or schedule.

[ADR 0017](adr/0017-verification-delivery-outbox.md) is a proposed production design, not authorization to add a provider or deploy delivery. It requires a transactional encrypted outbox so identifier enrollment and message eligibility cannot diverge.

## Approval record

Record these decisions before implementation:

| Decision             | Required evidence                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Provider and region  | Current contract, DPA/subprocessors, residency and account-security controls                    |
| Sender/domain        | SPF, DKIM, DMARC, return-path, abuse contacts, and isolated preview identity                    |
| Idempotency          | Provider documentation and a sandbox retry of one stable delivery ID                            |
| Message              | Approved fixed template with no sensitive product findings or user-controlled content           |
| Expiry/retries       | Challenge lifetime, maximum attempts, timeout, backoff, and bounded `Retry-After`               |
| Retention            | Immediate payload destruction rules, metadata period, provider suppression/log periods, backups |
| Jurisdiction/consent | Legal basis, notice, geography, age/accessibility requirements                                  |
| Owners               | Security, privacy/legal, delivery operations, incident response, and final activation approver  |

## Required implementation order

1. Accept or supersede ADR 0017 and record the approval table above.
2. Add the encrypted outbox schema, tenant insert policy, forced RLS, function-only delivery role, and read-only authorization preflight assertions.
3. Change challenge preparation so the verification and delivery command commit atomically; retain the local no-delivery path.
4. Implement bounded claim/complete/retry functions and prove lease, compare-and-swap, expiry, deletion, and payload-destruction behavior locally.
5. Add a route-less Worker with default-on kill switch and no provider SDK until its dependency and egress behavior are reviewed.
6. Add provider sandbox credentials only through purpose-scoped secret bindings; never put them in Wrangler `vars`, `.env` build input, GitHub output, source, or the web Worker.
7. Dry-build and inspect exact bindings, then run only synthetic `.test` or provider-approved sandbox recipients.
8. Exercise duplicate delivery, uncertain timeout, throttling, provider outage, account deletion, completed/revoked challenge, expired lease, dead-letter, recovery, and retention.
9. Review aggregate-only telemetry and provider-side records for prohibited content before approving a hosted personal-data path.

## Stop and rollback

The kill switch stops new claims; it does not erase queued data by itself. During an incident, disable claims, revoke the provider credential, cancel pending rows through the bounded maintenance path, destroy their encrypted payloads, and reconcile aggregate state. If delivery-key exposure is suspected, revoke the key reference and follow the incident plan; encrypted queued commands must be treated as compromised until proven otherwise.

Rollback to non-delivery by disabling claims and restoring the local/refusal gateway. Do not roll back database schema while pending or leased rows exist. Provider-accepted messages cannot be recalled, which is why the worker rechecks eligibility immediately before sending and keeps leases/batches small.

## Production gate

The gate is closed today. Do not replace `AUTH_MODE=disabled`, widen the Cloudflare boundary verifier, add an email binding, or deploy a delivery schedule until the provider/owner decisions and all acceptance evidence in ADR 0017 are complete.
