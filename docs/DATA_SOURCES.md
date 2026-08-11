# Future Data Sources

**Status:** Research only. No provider is integrated or called.  
**Research date:** 2026-08-11; availability, terms, prices, and limits must be rechecked before selection.

## Evaluation framework

Every candidate is scored on official/authorized access, purpose fit, query identifiers sent, coverage/freshness, false-positive behavior, provenance, rate and pagination limits, unit price/minimum commitment, cache/retention/display rights, privacy/DPA/security, jurisdictions, stability, exit path, and user-remediation value.

“Potential provider” means a category to investigate, not endorsement or availability.

## Search engines

| Approach                                             | Availability/cost/limits                                                                    | Quality/freshness                              | ToS/dependency                                                                                       | Privacy                                                          | Position                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Official full-web search API (e.g. Brave Search API) | metered tiers; hard result/pagination limits; current official API exists                   | independent index; coverage differs by market  | verify query/display/cache terms and price at adoption                                               | exact personal query is disclosed to provider                    | candidate behind adapter; not MVP default                    |
| Google-compatible/custom search API                  | Google Custom Search JSON API is closed to new customers; existing users transition by 2027 | strong but product scope may be domain-limited | extreme lifecycle risk; alternatives may not be full-web equivalents                                 | provider sees query/account                                      | do not select as new default                                 |
| Bing/search API                                      | legacy Bing Search APIs retired in 2025                                                     | historical option only                         | unavailable as a standalone dependency; AI-grounding replacement is a poor fit and adds LLM concerns | provider/AI pipeline exposure                                    | do not plan around it                                        |
| Third-party SERP API                                 | broad engines/features, often expensive and quota-tiered                                    | can approximate user-visible SERPs             | upstream scraping/authorization chain, result licensing, reliability, location variance              | adds another processor and may expose queries to several parties | require supply-chain/contract review; later fallback at most |
| User-submitted results/links                         | near-zero API cost; no automatic freshness                                                  | exact user context but incomplete/manual       | lowest provider dependency                                                                           | least new disclosure; uploaded content still sensitive           | recommended initial/manual path                              |

Controls: minimal query templates, verified identifiers, one provider per planned query, no automatic multi-provider fan-out, hard pages/results, permitted cache TTL, regional routing if required, cost reservation, and visible coverage limitation.

Primary status references: [Microsoft retirement notice](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement), [Google Custom Search status](https://developers.google.com/custom-search/v1/overview), and [Brave Search API documentation](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started).

## Social and profile discovery

| Approach                     | Benefit                                   | Limitation / risk                                                       | Recommendation                                        |
| ---------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| Official APIs/OAuth          | clear account evidence and structured IDs | limited discovery, changing scopes/review, provider learns relationship | best for verification/account-specific checks         |
| Search-engine discovery      | broad public coverage                     | inherited search false positives/cost/terms                             | later, verified signals and user confirmation         |
| Username existence checks    | simple per-site answer                    | often prohibited/brittle; easy mass enumeration; handle ≠ person        | provider-by-provider approval only, strict scope/rate |
| User-supplied known profile  | precise, private, low cost                | no discovery; malicious URL risk                                        | MVP/manual default                                    |
| Public profile index/partner | normalized data                           | aggregation may magnify surveillance/legal risk                         | avoid unless licensed, self-only, and high value      |

Automatic username enumeration produces false positives because handles are not unique across sites, are reused by unrelated people, can be transferred/recycled, transliterated, shared, impersonated, or generated. Absence can be ambiguous due to privacy/login/rate blocks.

### Explainable confidence

| User label     | Internal band            | Typical evidence                                                                        |
| -------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| Confirmed      | `VERIFIED`               | OAuth/in-profile challenge or explicit user confirmation                                |
| Highly Likely  | `HIGH`                   | unique handle plus verified linked site/reciprocal account or exact verified identifier |
| Possible Match | `MEDIUM`                 | handle plus two independent contextual signals                                          |
| Weak Match     | `LOW`/`VERY_LOW`         | handle or display-name similarity alone                                                 |
| Rejected       | finding `FALSE_POSITIVE` | explicit user rejection/suppression                                                     |

Evidence includes handle, display name, biography, broad location, linked website, employment overlap, and cross-links. Record positive, negative, missing signals and method version. No facial recognition or automatic photo matching.

## Data brokers and people-search sites

### Identification approaches

1. Search discovery through a licensed provider using verified identifiers.
2. Broker or removal-partner API with explicit self-service rights.
3. User-provided listing URL.
4. Manual user verification against a broker registry/instructions.
5. Assisted removal partner with documented authority and processor terms.

Automated scraping is fragile because pages, bot controls, captchas, geographic availability, and identifiers change. It may violate terms, collect third-party/relative data, expose verification data, and create misleading absence. The provider registry must let each broker adapter be disabled without changing core finding logic.

Broker adapter outputs only normalized `DATA_BROKER_PROFILE` candidates, evidence summary, provenance, confidence, last check, permitted remediation instructions, and explicit `presence=INDETERMINATE` when blocked. It never claims removal based on request submission. The MVP supports user-supplied links/instructions only.

## Breach monitoring

Use a legitimate notification API/service after exact-email verification. A `BreachProvider` should support authorized identifiers, return provider-defined breach metadata, normalize categories, disclose confidence/verification status, honor attribution/rate requirements, and never return/store passwords or credential artifacts.

Permitted metadata:

```text
breach_name, breach_date, discovery_date
affected_identifier_id (reference, not copied raw value)
data_categories, source_provider, provider_external_id
risk_level, remediation_status, last_checked
```

Never store leaked passwords, password hashes for matching, plaintext credentials, stolen tokens, breach payloads, stealer logs, or paste contents. A breach result indicates inclusion reported by a provider, not current password compromise. HIBP is one candidate whose official v3 API documents key requirements for email lookup, rate limiting, and acceptable use; it is not selected here: [HIBP API v3](https://haveibeenpwned.com/API/V3).

## Domain and infrastructure monitoring

Only verified `OwnedAsset` records may be actively checked.

| Source                   | Potential output                | Main considerations                                                                          |
| ------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------- |
| Authoritative/public DNS | A/AAAA/MX/NS/TXT/CAA and change | DNS data is public but scope, resolver privacy, cache, and amplification matter              |
| RDAP                     | registration/registrar/status   | redaction, jurisdiction, RDAP terms, personal contact minimization                           |
| Certificate Transparency | issued certificates/names       | logs can contain historical subdomains; do not broaden beyond verified suffix policy         |
| TLS handshake            | protocol/certificate metadata   | bounded connections to verified hosts only; avoid broad port scan                            |
| HTTP metadata            | status, canonical, headers      | SSRF/redirect/content risks; headers only initially, fixed ports and limits                  |
| SPF/DKIM/DMARC           | mail-auth posture               | DKIM selectors cannot be exhaustively guessed; accept user-provided selector or known config |
| Public services          | exposure                        | active port/service scanning creates substantial authorization and abuse risk                |

MVP recommendation: defer owned-asset scanning. First later slice should be DNS/TLS/mail configuration for a recently DNS-verified domain, user-triggered only. No subdomain enumeration, port scan, vulnerability exploit, or third-party asset inference.

## Provider lifecycle and health

Providers have `HEALTHY`, `DEGRADED`, `RATE_LIMITED`, `UNAVAILABLE`, `DISABLED`. Maintain terms-review and parser-version dates. Each run records coverage; failed adapters never silently fall back to a more invasive source. Removal is a registry/config action plus data-disposition plan.

## Mock provider design

Future `MockSearchProvider`, `MockBreachProvider`, and `MockBrokerProvider` implement the same contracts using checked-in synthetic fixtures. Fixtures include success, empty, duplicate, malformed, timeout, rate-limit, partial pagination, poisoned URL, and schema-change cases. They must never make network calls and are not implemented in the current Phase 1 foundation.
