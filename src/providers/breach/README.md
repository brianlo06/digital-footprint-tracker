# Breach providers

**Purpose:** report legitimate breach-notification metadata for an exact verified identifier.  
**Inputs:** verified email reference and explicit consent; never a password, hash for password matching, credential, or token.  
**Expected outputs:** breach name/date/discovery date, affected data categories, provider ID, risk guidance and check time.  
**Potential providers:** legitimate notification APIs such as HIBP or commercial equivalents, selected only after current terms/cost/security review.  
**Privacy concerns:** exact email is disclosed to the service; the result is highly sensitive and must not enter outbound notification text.  
**ToS concerns:** authorization, acceptable use, attribution, rate tier, caching/display/notification requirements.  
**Failure modes:** 404 ambiguity, 429, stale/incomplete breach catalog, unverified breach metadata, provider access-model change.  
**Future implementation notes:** metadata only, server-side secret, provider-defined provenance, user-triggered first, no breach dumps/pastes/stealer logs or exposed passwords.
