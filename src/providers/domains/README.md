# Domain providers

**Purpose:** assess bounded public metadata and hygiene for user-controlled domains/websites, separate from Personal Footprint.  
**Inputs:** recently verified owned asset and explicit capability scope.  
**Expected outputs:** DNS/RDAP/CT/TLS/HTTP-header/SPF/DKIM/DMARC observations with provenance, not vulnerability exploitation.  
**Potential providers:** standards-based DNS/RDAP/CT and bounded direct metadata checks; commercial enrichment only after review.  
**Privacy concerns:** lookups reveal monitored assets to resolvers/providers; historical CT/RDAP can expose names; results can aid attackers if leaked.  
**ToS concerns:** RDAP/CT/resolver acceptable use, automated query limits, registry rules, scanning authorization.  
**Failure modes:** stale ownership, DNS propagation, wildcard records, CT delay, redirects/SSRF, DKIM selector ambiguity, transient TLS failure.  
**Future implementation notes:** DNS TXT verification; exact scope; expiry/revalidation; no subdomain enumeration, port scan, exploit, or third-party asset inference.
