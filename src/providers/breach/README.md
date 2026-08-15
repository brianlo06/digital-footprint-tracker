# Breach providers

**Purpose:** report legitimate breach-notification metadata for an exact verified identifier.  
**Inputs:** verified email reference and explicit consent; never a password, hash for password matching, credential, or token.  
**Expected outputs:** breach name/date/discovery date, affected data categories, provider ID, risk guidance and check time.  
**Conditional provider:** HIBP, selected for synthetic contract development only; written customer-facing commercial permission remains required before non-synthetic use.
**Privacy concerns:** exact email is disclosed to the service; the result is highly sensitive and must not enter outbound notification text.  
**ToS concerns:** authorization, acceptable use, attribution, rate tier, caching/display/notification requirements.  
**Failure modes:** 404 ambiguity, 429, stale/incomplete breach catalog, unverified breach metadata, provider access-model change.  
**Current implementation:** a zero-network synthetic adapter covers bounded success, empty, duplicate, malformed, hostile, schema-change, timeout, authentication, rate-limit, outage, and pagination behavior. It accepts only an opaque identifier UUID with the `VERIFIED_EMAIL_SELF` scope, costs zero units, and emits synthetic normalized candidates. A non-routed invocation service also requires exact ownership, active state, verification no more than 24 hours old, purpose-specific consent, and a successful fail-closed request/cost reservation. PostgreSQL authorization rows are share-locked through reservation, and failed fixture dispatches reconcile durably before their bounded error is rethrown.
**Future implementation notes:** metadata only, server-side secret, provider-defined provenance, user-triggered first, no breach dumps/pastes/stealer logs or exposed passwords.
