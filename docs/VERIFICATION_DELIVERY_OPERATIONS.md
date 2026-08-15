# Verification Delivery Operations

## Current boundary

No email is sent. `LocalFakeEmailVerificationGateway` remains the default gateway, works only with local authentication in the local environment, returns a fixture challenge, and refuses preview, production, or managed-auth operation. The public Cloudflare preview has no email provider, delivery Worker, delivery database binding, key reference, secret, queue, or schedule.

[ADR 0017](adr/0017-verification-delivery-outbox.md) is accepted for local implementation, not authorization to add a provider or deploy delivery. Its additive encrypted transactional outbox is built and locally verified:

- `verification_delivery_outbox` schema with forced RLS, an insert-only tenant policy, and a CHECK tying delivery state to payload presence;
- `claim_verification_deliveries`, `complete_verification_delivery`, and `report_verification_delivery_failure` SQL functions behind a dedicated, function-only `digital_footprint_delivery` login and its non-login `digital_footprint_delivery_owner`, provisioned locally and against a throwaway hosted-style database;
- transactional enqueue: `OutboxEmailVerificationGateway` pre-encrypts the delivery command before `addEmailIdentifier`'s transaction opens, so the outbox row commits or rolls back with the identifier, verification, consent, and audit rows in that same transaction — never independently;
- a pure core/service split (`delivery-outbox-core.ts`, `delivery-outbox-service.ts`) and a demonstration `workers/verification-delivery.ts` that claims, decrypts, and hands each delivery to a `DeliveryProvider` — today only `SyntheticNoopDeliveryProvider`, which always succeeds and sends nothing;
- a route-less dry-build template, `wrangler.verification-delivery.example.jsonc`, showing only a `DELIVERY_DATABASE` Hyperdrive binding, a `DELIVERY_ENCRYPTION_KEY` Secrets Store secret reference (never a plain `vars` entry), fixed non-secret limits, and no route or `assets` binding. `npm run cf:verification-delivery:build` dry-builds and inspects it in CI on every push, mirroring `cf:retention:build`.

What remains absent: a selected and approved provider, an attached Worker binding and Secrets Store secret (a dedicated preview Hyperdrive exists, while the committed template's `id`/`store_id` remain synthetic zeros), a hosted deployment or CI _deploy_ step (only a dry build runs in CI), and any quota/alerting operational tooling beyond the code-level `DELIVERY_KILL_SWITCH` flag, which is default-on (blocks claiming unless explicitly set to `"false"`) and is checked first.

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

## Activation Evidence (ADR 0017)

| #   | Item                                                                                                                                                            | State                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Owner approval of the ADR, delivery/body copy, expiry, maximum attempts, metadata retention, and jurisdiction                                                   | Blocked — pending owner approval                                                                                                                                           |
| 2   | Provider legal, DPA, subprocessor, residency, suppression, retention, breach, and account-security review                                                       | Blocked — no provider selected                                                                                                                                             |
| 3   | Documented idempotency, timeout, quota, sandbox, and deletion behavior from the chosen provider                                                                 | Blocked — no provider selected                                                                                                                                             |
| 4   | Migrations proving forced RLS, exact grants, non-login function owner, function-only delivery login, fixed `search_path`, and revoked `PUBLIC` execution        | **Done (local)** — verified locally and against a throwaway hosted-style database, including injected-violation detection                                                  |
| 5   | Concurrent integration tests for atomic enqueue, duplicate claims, lease expiry, retries, expiry/completion/revocation, deletion races, and payload destruction | **Done (local)** — see the verification-evidence bullets in `PHASE_1_STATUS.md`; provider-specific uncertain-response behavior is untested without a chosen provider       |
| 6   | Canaries proving no destination, code, content, ciphertext, provider credential, or response can reach telemetry                                                | Blocked — not yet exercised for this ADR                                                                                                                                   |
| 7   | A route-less Worker dry build showing only the delivery database binding, delivery-key/provider secret references, fixed non-secret limits, and no public route | **Done (local)** — `wrangler.verification-delivery.example.jsonc` dry-builds in CI; its Hyperdrive/Secrets Store IDs are synthetic placeholders, not provisioned resources |
| 8   | A synthetic hosted exercise with kill switch, quotas, alerts, provider-side idempotency evidence, and verified retention/deletion                               | Blocked — no hosted deployment                                                                                                                                             |

Items 4, 5, and 7 are satisfied only for their local/offline portion. Nothing above authorizes selecting a provider or deploying delivery.

## Required implementation order

1. ~~Accept or supersede ADR 0017 and record the approval table above.~~ ADR 0017 is accepted for local implementation; the approval table above is still unrecorded.
2. ~~Add the encrypted outbox schema, tenant insert policy, forced RLS, function-only delivery role, and read-only authorization preflight assertions.~~ Done — see `RLS_OPERATIONS.md`.
3. ~~Change challenge preparation so the verification and delivery command commit atomically; retain the local no-delivery path.~~ Done — `addEmailIdentifier` inserts the outbox row inside its existing transaction only when the gateway returns a `delivery` descriptor; `LocalFakeEmailVerificationGateway` never does.
4. ~~Implement bounded claim/complete/retry functions and prove lease, compare-and-swap, expiry, deletion, and payload-destruction behavior locally.~~ Done — see the Activation Evidence table above.
5. ~~Add a route-less Worker with default-on kill switch and no provider SDK until its dependency and egress behavior are reviewed.~~ Done — `workers/verification-delivery.ts` checks a default-on `DELIVERY_KILL_SWITCH` flag first (any value other than `"false"` blocks claiming) and uses only the synthetic no-op provider; it has no hosted deployment yet.
6. Add provider sandbox credentials only through purpose-scoped secret bindings; never put them in Wrangler `vars`, `.env` build input, GitHub output, source, or the web Worker. The template already declares `DELIVERY_ENCRYPTION_KEY` as a Secrets Store reference, not a `vars` entry; a real provider credential must follow the same pattern once one is selected.
7. ~~Dry-build and inspect exact bindings~~, then run only synthetic `.test` or provider-approved sandbox recipients. The dry build runs in CI on every push (`npm run cf:verification-delivery:build`); running against real recipients still requires a chosen provider and hosted deployment.
8. Exercise duplicate delivery, uncertain timeout, throttling, provider outage, account deletion, completed/revoked challenge, expired lease, dead-letter, recovery, and retention.
9. Review aggregate-only telemetry and provider-side records for prohibited content before approving a hosted personal-data path.

## Stop and rollback

The kill switch stops new claims; it does not erase queued data by itself. During an incident, disable claims, revoke the provider credential, cancel pending rows through the bounded maintenance path, destroy their encrypted payloads, and reconcile aggregate state. If delivery-key exposure is suspected, revoke the key reference and follow the incident plan; encrypted queued commands must be treated as compromised until proven otherwise.

Rollback to non-delivery by disabling claims and restoring the local/refusal gateway. Do not roll back database schema while pending or leased rows exist. Provider-accepted messages cannot be recalled, which is why the worker rechecks eligibility immediately before sending and keeps leases/batches small.

## Production gate

The gate is closed today. Do not replace `AUTH_MODE=disabled`, widen the Cloudflare boundary verifier, wire `OutboxEmailVerificationGateway` into `getEmailVerificationGateway()`, add an email binding, or deploy a delivery schedule until the provider/owner decisions and all Activation Evidence in ADR 0017 are complete.
