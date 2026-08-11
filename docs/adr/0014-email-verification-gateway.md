# ADR 0014: Email Verification Gateway Boundary

**Status:** Accepted

## Context

The local fake verification fixture was embedded in identifier enrollment. Replacing it in place would couple core storage to a delivery vendor and make it easier to accidentally enable message sending without provider review.

## Decision

Depend on an `EmailVerificationGateway` returning method, purpose-bound challenge hash, and expiry. Keep the normalized destination scoped to the gateway call. Provide only a local, non-delivering implementation that refuses preview, production, or managed-auth operation.

A real gateway requires separate approval and an idempotent delivery/outbox design; this interface does not authorize network activity.

## Alternatives Considered

Keep local logic embedded; select an email SDK now; put delivery in the Server Action; store plaintext codes; wait until a provider is selected.

## Consequences

Core enrollment no longer knows the fixture code or delivery method. Gateway behavior is independently testable. The interface is intentionally narrow, but production delivery semantics, callbacks, retries, suppression, and provider retention remain unresolved gates.

## Revisit Conditions

Verification moves entirely to managed auth, links replace codes, multiple channels require a broader challenge protocol, or durable delivery jobs require an explicit command/outbox type.
