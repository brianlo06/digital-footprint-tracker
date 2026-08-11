# Social providers

**Purpose:** verify user-supplied accounts or propose public profile candidates where expressly permitted.  
**Inputs:** user-supplied handle/profile URL, minimum-scope OAuth or nonce challenge, optional non-sensitive context with consent.  
**Expected outputs:** profile candidate, stable external ID, public URL, redacted evidence signals, confidence and verification method.  
**Potential providers:** official platform APIs/OAuth, authorized search discovery, user-submitted profiles.  
**Privacy concerns:** account linking, cross-context profiling, provider disclosure, third-party biography/location data, false attribution.  
**ToS concerns:** automated discovery, caching, display, OAuth scopes/token retention, username existence checks.  
**Failure modes:** recycled/squatted/shared handle, private/deleted account, rate block, API scope loss, impersonation.  
**Future implementation notes:** no broad username enumeration, no facial recognition/image matching, prefer user confirmation, store positive/counter-signals and suppression rules.
