# Phase 2 Readiness and First-Provider Decision

**Status:** Internal preflight complete on 2026-08-15; ready for owner review. Phase 2 implementation and all non-synthetic provider use remain unauthorized.

**Review boundary:** Product, engineering, privacy, and security review only. This is not legal advice. Qualified counsel must review the contract and launch obligations before external users or non-synthetic personal data are introduced.

## Decision summary

| Decision                | Recorded position                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial persona         | One adult in the United States monitoring only their own recently verified email                                                                                    |
| Excluded users and uses | Minors, family/delegated accounts, employers, background checks, third-party lookup, public search, bulk input, and arbitrary email queries                         |
| First capability        | User-triggered exact-email breach metadata; no scheduling or fallback provider                                                                                      |
| Preferred provider      | Have I Been Pwned (HIBP), conditional on written confirmation that the contracted service permits this customer-facing self-monitoring use                          |
| Implementation mode     | Mock and HIBP-documented synthetic accounts only; real-provider feature flag and spend budget default to zero/off                                                   |
| Live-provider budget    | USD 0 until a compatible contract and quote receive separate owner approval                                                                                         |
| Adapter architecture    | ADR 0003 accepted; server-only, replaceable, capability-gated, and unable to write findings directly                                                                |
| Phase 2 start           | Requires the owner's explicit approval of this packet after the commercial-use question is resolved or explicitly deferred to a synthetic-only implementation slice |

The United States scope is an engineering evaluation boundary, not a conclusion that one nationwide legal analysis is sufficient. No external-user launch is authorized until applicable state privacy, breach-notification, consumer-protection, and business obligations are mapped by qualified counsel.

## Candidate comparison

### HIBP — preferred, conditional

HIBP is the closest match to the required data boundary:

- its documented breached-account endpoint can return only breach names, and `includeUnverified=false` can exclude unverified breaches;
- its Pro and High RPM tiers document a k-anonymity email-search option that avoids sending the full email address;
- it publishes current API documentation, terms, privacy information, a DPA, test addresses, rate-limit behavior, attribution requirements, and an Enterprise contact route; and
- it reports breach metadata rather than requiring this product to ingest breach dumps or credentials.

The contract fit is not yet approved. HIBP's API documentation invites attributed services built on the public API, while its March 2026 Terms restrict use for a third party unless the purchased service expressly permits it. Current plan text describes Core as own-domain use and Pro as customer-domain/MSP use, but does not clearly authorize a consumer application whose operator queries each end user's verified personal email. The public terms must not be interpreted optimistically. Obtain written confirmation or Enterprise terms before any non-synthetic query.

### SpyCloud — rejected for Phase 2

SpyCloud supports customer-facing API integrations and publishes a DPA, but its current product materials emphasize credential pairs, plaintext passwords, malware and phishing captures, session artifacts, and broad identity attributes. Even if a contract could limit fields, that default product and threat surface conflict with the Phase 2 prohibition on credential artifacts and unnecessary PII. Reconsider only if a future product exposes and contractually guarantees a metadata-only response with no credential, malware-log, session, or unrelated identity data.

### Mozilla Monitor — rejected as a provider dependency

Mozilla Monitor is a consumer service backed by HIBP, not a documented general provider API for this product. It validates the user value and privacy benefit of k-anonymity but does not remove the need for a direct provider contract.

## Official evidence reviewed

Reviewed on 2026-08-15:

- [HIBP API v3](https://haveibeenpwned.com/API/v3) — documented test key and accounts, direct and k-anonymity searches, response fields, status codes, rate limiting, acceptable use, and attribution;
- [HIBP Terms of Use](https://haveibeenpwned.com/TermsOfUse) — March 2026 permitted-purpose, third-party-benefit, confidentiality, termination, and paid-service terms;
- [HIBP subscription plans](https://haveibeenpwned.com/Subscription) — Core, Pro, High RPM capabilities and current published prices;
- [HIBP Privacy Policy](https://haveibeenpwned.com/Privacy) — search handling, breach-data limitations, data location, individual rights, and service disclosures;
- [HIBP DPA](https://haveibeenpwned.com/DPA) — processing roles, purpose limitation, security, subprocessors, transfers, assistance, and deletion/return provisions;
- [HIBP Enterprise/support request](https://support.haveibeenpwned.com/hc/en-au/requests/new) — route for bespoke commercial terms;
- [SpyCloud API](https://spycloud.com/products/spycloud-api/) and [SpyCloud DPA](https://spycloud.com/legal/dpa) — supported integration model and the substantially broader credential/identity dataset; and
- [Mozilla's k-anonymity design](https://blog.mozilla.org/security/2018/06/25/scanning-breached-accounts-k-anonymity/) — privacy rationale, not a current third-party API offer.

Provider terms, plans, APIs, and prices can change. Recheck at contract acceptance, adapter implementation, the approved live test, and launch; record a review date no more than 30 days old at each gate.

## Provider approval checklist

| Requirement              | Readiness result                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Official API route       | Pass for synthetic evaluation: documented v3 breached-account endpoint and integration-test domain                                          |
| Intended use             | Conditional: self-monitoring aligns with HIBP's purpose, but operator-funded third-party end-user use needs written confirmation            |
| Terms and licence        | Conditional: attribution is clear; commercial/customer-benefit permission is not                                                            |
| Privacy and DPA          | Available for review; contract acceptance and counsel review remain required before personal data                                           |
| Identifier and authority | Exact email only after recent product-controlled verification; never name, phone, username, arbitrary email, or domain enumeration          |
| Data minimization        | Breach metadata allowlist only; no passwords, password hashes, credentials, tokens, pastes, stealer logs, raw dumps, or unrelated PII       |
| Region and transfers     | HIBP states Western US Azure storage; confirm the contracted service, subprocessors, transfer terms, and change-notice process              |
| Security                 | Public architectural/security information exists; request incident-notice terms and any available assurance material during contract review |
| Rate and cost            | Fail closed at zero until contract approval; later limits cannot exceed the approved quote, provider RPM, or internal daily/monthly caps    |
| Evidence quality         | Provider-reported inclusion only; exclude unverified breaches and never claim current compromise or comprehensive coverage                  |
| Attribution              | Every HIBP-derived result and coverage view must visibly name and link to HIBP                                                              |
| Correction and dispute   | Product supports user rejection/suppression; explain HIBP opt-out/correction boundaries without claiming source-data correction             |
| Change monitoring        | Engineering owner checks official API/terms/pricing at least monthly while active and before every release affecting the adapter            |
| Exit plan                | Global kill switch, key revocation, registry removal, normalized-data disposition, user notice, and no fallback fan-out                     |

## Enforced provider data boundary

The Phase 2 adapter may call only the breached-account capability for one recently verified email, preferably through a contractually approved k-anonymity plan. It must request `includeUnverified=false` and the smallest documented response. It may normalize only:

```text
provider_id, provider_breach_id, breach_name
breach_date, provider_added_date, provider_modified_date
data_categories, is_verified, is_sensitive, is_retired
checked_at, parser_version, source_url
```

The adapter must validate an allowlisted schema, discard unmatched k-anonymity suffixes immediately, destroy raw responses after normalization, and reject extra sensitive fields rather than store them. Public breach descriptions are not stored as raw HTML. Pwned Passwords, paste, stealer-log, domain-search, domain-verification, subscription-management, MCP, and bulk endpoints are out of scope.

## Budget and quota decision

Before compatible terms are accepted:

- monetary limit: USD 0 daily and monthly;
- non-synthetic request limit: 0;
- permitted network use: HIBP's documented test key and `hibp-integration-tests.com` accounts only;
- retries: none outside deterministic synthetic tests; and
- feature flag and provider health: disabled.

The implementation must model daily and monthly monetary/usage reservations even while both limits are zero. A future quote requires a separate owner decision recording the subscription term, committed spend, unit/RPM allowance, alert thresholds, cancellation date, and accountable billing owner. No code or administrator override may interpret an absent limit as unlimited.

## Synthetic API evidence

On 2026-08-15 a read-only request used HIBP's documented all-zero test key, descriptive user agent, `account-exists@hibp-integration-tests.com`, `truncateResponse=true`, and `includeUnverified=false`. It returned HTTP 200 with one record whose only field was `Name`. No account, paid key, real identifier, or persistent project data was used.

This proves only that the documented synthetic contract was reachable. It is not commercial-use permission, a reliability test, or approval for personal data.

## Vendor inquiry ready to send

Send the following through HIBP's Enterprise support route before requesting a subscription or using a real email:

> Digital Footprint Tracker is a self-monitoring application for US adults. An authenticated user may query only their own email after our service has recently verified mailbox control. Our server would hold the provider credential; end users would not access HIBP directly. We want breach metadata only, preferably through the k-anonymity email endpoint, with visible HIBP attribution. We will not use passwords, pastes, stealer logs, breach payloads, bulk/domain enumeration, or unrelated identity data. Does HIBP expressly permit this operator-funded, customer-facing use, and if so under which public or Enterprise plan? Please confirm permitted display, normalization, cache/retention and deletion terms; required attribution; rate and price commitments; DPA/controller-processor roles; data locations and subprocessors; security-incident notice; test/sandbox rights; cancellation; and post-termination data disposition.

Do not shorten the use description in a way that hides the operator-funded third-party-benefit issue.

## Approved live-test design

The design is approved for later owner execution, but the test itself remains blocked until the contract, budget, personal-data activation gates, and a separate go/no-go are complete:

1. Use one adult owner's recently verified, explicitly consented email; never choose another person's address merely because it is known.
2. Prefer the k-anonymity endpoint. If the contract permits only direct search, record that the full email is disclosed to HIBP and obtain explicit test consent.
3. Make exactly one user-triggered request with no automatic retry, `includeUnverified=false`, a descriptive user agent, and the smallest response.
4. Reserve cost before dispatch and refuse the call if any user, provider, daily, monthly, consent, verification, health, or kill-switch gate fails.
5. Validate and normalize the allowlisted metadata, destroy the raw response, and verify telemetry contains no identifier, response, credential, or URL path.
6. Display provider attribution, source date, data categories, coverage limits, and the statement that a provider-reported breach is not proof of current account compromise.
7. Exercise the kill switch immediately afterward and demonstrate that a second request is denied without provider network activity.
8. Reconcile one reservation and one actual usage record, then delete the test account through the existing lifecycle and verify provider-derived data follows the approved disposition.

## Stop and rollback

Trigger rollback on contract ambiguity, unexpected fields, credential or paste data, attribution failure, verification bypass, cost-reservation failure, unexplained 401/403/429 behavior, schema drift, telemetry leakage, provider incident, or inability to honor deletion.

Rollback order:

1. Set the global provider kill switch to disabled and confirm the adapter makes zero network calls.
2. Revoke the provider key and remove its runtime binding.
3. Cancel queued work and reconcile reservations without retry or fallback.
4. Remove the adapter from the registry while preserving an opaque audit reason.
5. Delete or quarantine provider-derived data according to the approved contract and notify affected users if required.
6. Keep the provider disabled until a new dated approval packet and explicit owner authorization exist.

## Remaining owner/external commitments

Before unrestricted Phase 2 implementation begins, the owner must choose one of two bounded authorizations:

1. **Synthetic-only Phase 2:** implement contracts, fixtures, disabled HIBP adapter, zero budget, provenance UI, and rollback tests while the vendor inquiry is pending; or
2. **Contracted Phase 2:** first obtain written HIBP permission/terms and a quote, record counsel and owner approval, then implement against those exact constraints.

Neither choice authorizes a live personal-data call. That remains the separately approved exit test above.
