# ADR 0010: Destructive-Action Reauthentication

**Status:** Accepted

## Context

Account deletion destroys encrypted identifiers and related records and attempts to revoke the external identity. A stolen but otherwise valid session must not be enough to trigger it. The selected Clerk package exposes documented strict reverification and a client wrapper that retries the action only after the strongest available credential challenge succeeds.

## Decision

Require an explicit, recent reauthentication authorization at the deletion service boundary. Permit the local synthetic lifecycle to supply this only because local mode is forbidden in production and has no external credential. In Clerk mode, repeat subject continuity checks, require the strict reverification authorization, and invoke the action through Clerk's reverification wrapper. A signed, retryable `user.deleted` webhook resumes local purge if the identity is deleted outside the app or the request stops after provider revocation.

## Alternatives Considered

Session-only confirmation text; email confirmation link; support-operated deletion; omitting account deletion.

## Advantages

Fails closed against session theft, makes the destructive authorization visible in the service contract, and reconciles provider-initiated or interrupted deletion without granting the webhook a privileged database bypass.

## Disadvantages

Production launch still depends on exercising the flow with a real isolated Clerk tenant; local testing cannot fully reproduce provider reauthentication, passkeys, MFA, recovery, or delivery timing.

## Consequences

The UI treats challenge cancellation as a no-op. The action and service both enforce the boundary. Production-readiness tests must cover recent-auth expiry, MFA/passkey challenge, replay, CSRF, session revocation, provider deletion failure/retry, signed webhook delivery/redelivery, and complete data reconciliation.

## Revisit Conditions

Clerk changes or deprecates its reverification contract, another standards-based step-up method is approved, or the authentication provider changes.
