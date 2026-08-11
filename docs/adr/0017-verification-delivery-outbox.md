# ADR 0017: Idempotent Verification Delivery Outbox

**Status:** Proposed

## Context

The accepted email-verification gateway isolates challenge creation from the core identifier service, but its only implementation deliberately sends nothing. A production delivery call cannot run before or inside the user transaction: a failed transaction could still send a valid code, while a successful transaction followed by a failed call could create an undeliverable challenge. Retrying an uncertain provider response can also send duplicates.

Verification delivery contains a normalized email address and a short-lived plaintext code. Both are restricted data. A durable queue must not turn them into logs, unencrypted database fields, long-lived history, or general worker-readable data.

## Decision

Use a purpose-specific PostgreSQL transactional outbox and a separately deployed, route-less delivery Worker. This decision refines the email portion of proposed ADR 0005; it does not accept the general provider-job system or select an email vendor.

### Transaction boundary

Challenge preparation returns two coupled values:

1. the purpose-bound challenge hash and expiry stored in `identifier_verifications`; and
2. an encrypted delivery command stored in `verification_delivery_outbox`.

The identifier, verification, consent, audit event, and outbox row commit in one tenant transaction. Any failure rolls all of them back. The existing local fake remains a no-delivery implementation and creates no outbox row. Production activation must change the gateway contract explicitly; it must not add an in-request provider call.

Each outbox row has a random immutable delivery ID used as the provider idempotency key. It references the verification and user with cascading deletion, names only an allowlisted channel/template/version, and stores the destination and code solely inside an authenticated envelope encrypted under a delivery-specific KEK. Associated data binds the ciphertext to the delivery ID, verification ID, channel, template, and envelope version. No plaintext destination, destination-derived token, code, rendered body, or provider request is stored.

### Database authority

The web runtime may insert an outbox row only through the current tenant transaction. It cannot select, update, lease, or decrypt outbox payloads. Tenant RLS requires the referenced verification to belong to the authenticated subject.

The delivery login has no direct table privileges and cannot access users, identifiers, consent, audit, deletion receipts, rate-limit state, or key-rotation functions. It can execute only narrowly owned `claim`, `complete`, and `retry/dead-letter` functions:

- `claim` uses `FOR UPDATE SKIP LOCKED`, a bounded batch, and an expiring random lease;
- a claim is eligible only while its verification is `PENDING`, unexpired, not attempt-locked, and still linked to an active account;
- an ineligible row is cancelled and its encrypted payload is destroyed without being returned;
- `complete` and `retry` use compare-and-swap on delivery ID plus lease token;
- no function accepts arbitrary SQL, user IDs, destinations, payloads, or table names.

The Worker receives only the encrypted command and minimal delivery metadata. It unwraps the command immediately before the allowlisted provider call, keeps plaintext in memory for that call, and discards it afterward. Database credentials cannot decrypt commands; delivery-key authority cannot browse the database.

### Delivery semantics

Delivery is at least once; exactly-once delivery is not claimed. The selected provider must accept a stable idempotency key for the same logical message. Every retry reuses the delivery ID, template version, destination, and code. If a provider cannot supply a documented idempotency guarantee, it requires a separate risk decision and duplicate-delivery UX test before activation.

The Worker has a global kill switch, one fixed HTTPS provider origin, certificate verification, a short timeout, a bounded response body, no redirects, and a bounded concurrency/batch size. It classifies only allowlisted outcomes:

- success completes the row and immediately destroys the encrypted payload;
- explicit permanent rejection dead-letters the row and destroys the payload;
- rate limiting honors a bounded `Retry-After`;
- transient/uncertain outcomes use capped exponential backoff with jitter and the same idempotency key;
- expiry, account deletion, challenge completion/revocation, lease exhaustion, or maximum attempts cancel delivery and destroy the payload.

Provider response bodies, email addresses, message bodies, codes, ciphertext, provider tokens, and headers never enter logs, traces, metrics, audit events, or operator tooling. Telemetry is limited to aggregate counts, queue age buckets, latency buckets, and allowlisted error codes. Provider message identifiers are not persisted unless a callback design proves they are necessary; if needed, store only a purpose-keyed token.

### Lifecycle and deletion

Account deletion cascades pending delivery rows before provider revocation completes. A claimed Worker must revalidate with the compare-and-swap completion path; a deleted or cancelled row is a benign no-op. There is an unavoidable short race once a provider has accepted a message, so the privacy notice and processor contract must cover in-flight transactional delivery.

Payloads are destroyed on success, permanent failure, cancellation, expiry, or dead-lettering. Metadata-only tombstones may be retained for a short, separately approved operational period and then removed by bounded retention. Backups containing encrypted payloads must expire within the approved backup window, and destroying the delivery KEK is the emergency cryptographic-erasure path.

### Activation evidence

Before the local fake can be replaced, require all of the following:

1. owner approval of this ADR, delivery/body copy, expiry, maximum attempts, metadata retention, and jurisdiction;
2. provider legal, DPA, subprocessor, residency, suppression, retention, breach, and account-security review;
3. documented idempotency, timeout, quota, sandbox, and deletion behavior from the chosen provider;
4. migrations proving forced RLS, exact grants, non-login function owner, function-only delivery login, fixed `search_path`, and revoked `PUBLIC` execution;
5. concurrent integration tests for atomic enqueue, duplicate claims, lease expiry, uncertain responses, retries, expiry, completion/revocation, deletion races, and payload destruction;
6. canaries proving no destination, code, content, ciphertext, provider credential, or response can reach telemetry;
7. a route-less Worker dry build showing only the delivery database binding, delivery-key/provider secret references, fixed non-secret limits, and no public route;
8. a synthetic hosted exercise with kill switch, quotas, alerts, provider-side idempotency evidence, and verified retention/deletion.

## Alternatives Considered

Send inside the Server Action; send after commit without an outbox; store plaintext jobs; use destination hashes for idempotency; depend only on provider retries; use Cloudflare Queues without a transactional database handoff; reuse the web runtime or retention credentials; move all verification into managed authentication.

## Consequences

The design closes the commit/send gap, keeps retries deterministic, and makes delivery independently revocable. It adds a sensitive encrypted queue, another purpose-specific key and Worker, lease/retry code, provider due diligence, and an at-least-once duplicate risk that must be tested and communicated. No delivery capability exists until this proposal and a provider are approved and implemented.

## Revisit Conditions

Managed authentication owns identifier verification end to end; a provider offers a trustworthy transactional handoff; measured queue latency or contention requires a managed queue plus a database relay; multiple notification channels require a broader command schema; or regulatory/provider requirements prohibit this payload lifecycle.
