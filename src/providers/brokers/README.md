# Broker providers

**Purpose:** help a user identify and remediate their own people-search/data-broker listing.  
**Inputs:** user-provided listing or narrowly authorized verified identifier; minimum data needed for an approved partner.  
**Expected outputs:** candidate listing, provider/external ID, evidence summary, presence confidence, reviewed removal instructions and last-reviewed date.  
**Potential providers:** broker/partner APIs, removal partners, search discovery, manual user verification.  
**Privacy concerns:** queries/removal forms may reveal more data to a broker; relatives/addresses may be swept in; aggregation increases harm.  
**ToS concerns:** scraping/captcha, authorized-agent rules, automation/representation, opt-out form use, retention and evidence.  
**Failure modes:** page/flow changes, ambiguous match, captcha/block, reappearance, broker says submitted but listing remains.  
**Future implementation notes:** assisted workflow first; no scraping or auto-submission; `SUBMITTED` never equals `SUCCESS`; provider removable through registry.
