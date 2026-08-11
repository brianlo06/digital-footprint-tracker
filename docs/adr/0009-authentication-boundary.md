# ADR 0009: Authentication Boundary

**Status:** Accepted

## Context

An aggregated privacy profile makes account takeover unusually harmful. The application needs strong production authentication without making local development require a paid cloud service or coupling core data ownership to vendor SDK objects.

## Decision

Define an application `AuthGateway` that returns an opaque authenticated subject. Use Clerk as the initial managed-auth adapter and a deliberately limited local adapter for development. Reject local mode whenever `NODE_ENV=production`. Perform optimistic route filtering in Next.js Proxy where useful, but repeat authentication and ownership checks in Server Actions and data-access functions close to protected data.

Account creation is an explicit authenticated POST action. Page rendering is read-only and layouts are not treated as the sole authorization boundary.

## Alternatives Considered

Self-hosted password authentication; Auth.js; provider-specific identities throughout the schema; no local mode; Proxy-only checks.

## Advantages

Small credential-handling surface, vendor-independent internal subject mapping, vendor-free local development, and defense in depth consistent with the framework's data-security guidance.

## Disadvantages

Managed-provider metadata and lock-in remain; preview configuration and privacy/DPA review are required; the local adapter can be dangerous if exposed; Clerk lifecycle behavior needs integration tests.

## Consequences

Local mode must bind only to trusted development environments and use synthetic data. Production release requires an isolated Clerk review of passkeys/MFA, session/recovery, abuse controls, webhooks, deletion, export, subprocessor/privacy terms, and cost. Every mutation reauthenticates and scopes data by the mapped internal account.

## Revisit Conditions

Clerk fails the privacy/security/cost review, a mobile/public API client changes session needs, enterprise federation is required, or auth availability/portability becomes unacceptable.
