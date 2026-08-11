# ADR 0010: Destructive-Action Reauthentication

**Status:** Accepted

## Context

Account deletion destroys encrypted identifiers and related records and attempts to revoke the external identity. A stolen but otherwise valid session must not be enough to trigger it. The selected Clerk package exposes a reverification capability, but its installed public types label that capability beta and not recommended for production use.

## Decision

Require an explicit, recent reauthentication authorization at the deletion service boundary. Permit the local synthetic lifecycle to supply this only because local mode is forbidden in production and has no external credential. Keep managed-auth deletion disabled until a stable recent-login, passkey, or MFA challenge is selected and tested end to end.

## Alternatives Considered

Session-only confirmation text; adopting the beta reverification API immediately; email confirmation link; support-operated deletion; omitting account deletion.

## Advantages

Fails closed against session theft, makes the destructive authorization visible in the service contract, and avoids basing a privacy promise on a production-discouraged beta surface.

## Disadvantages

Managed-auth users cannot yet self-delete through the UI; production launch is blocked on this flow; local testing cannot fully reproduce provider reauthentication.

## Consequences

The UI explains that no data changes when the gate is unavailable. The action and service both enforce the boundary. Production-readiness tests must cover recent-auth expiry, MFA/passkey challenge, replay, CSRF, session revocation, provider deletion failure/retry, and complete data reconciliation.

## Revisit Conditions

Clerk provides a stable supported reverification surface, another standards-based step-up method is approved, or the authentication provider changes.
