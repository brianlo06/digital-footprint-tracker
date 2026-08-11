# Abuse Prevention

**Non-negotiable boundary:** the service monitors the authenticated user’s own verified identifiers and assets. It is not a search box for people.

## Misuse scenarios

| Scenario                            | Dangerous capability             | Architectural restriction                                                 |
| ----------------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| Stalker searches victim             | name/phone/email discovery       | verified identifiers only for sensitive scans; no arbitrary-person search |
| Employer investigates employee      | name + location aggregation      | no employment/background reports; no third-party identity creation        |
| Abusive partner monitors spouse     | known credentials/phone          | reauth, MFA, recovery alerts, session/device controls, generic notices    |
| Identity thief collects identifiers | finding aggregation/export       | no raw bulk export/share links; sensitive reveal controls; anomaly limits |
| Doxxer builds profile               | public-record/broker correlation | no address/relative search; manual confirmation; no relationship graph    |
| Mass OSINT collection               | API/bulk username enumeration    | no public scan API, strict per-identity budgets, entity/velocity limits   |

## Safeguard analysis

### Email ownership verification

**Approach:** short-lived, single-use code/link sent to the exact address.  
**Benefits:** strong control signal; gates exact-email breach/search capabilities.  
**Drawbacks:** mailbox compromise, delivery dependency, reveals service use to inbox operator.  
**Possible bypasses:** stolen session/mailbox, aliases controlled by attacker, forwarding.  
**Privacy implications:** processor receives address and service metadata.  
**Recommended mitigation:** minimize message, generic subject, token hash, expiry/attempt limits, reauth, audit, periodic revalidation.  
**Recommendation:** required for email-specific scanning.

### Domain / website verification

**Approach:** DNS TXT first; HTML meta/file as fallback.  
**Benefits:** strong operational control; safe boundary for asset checks.  
**Drawbacks:** DNS propagation and technical friction; control can later transfer.  
**Possible bypasses:** compromised DNS/web account, dangling subdomain, stale proof.  
**Privacy implications:** public challenge can reveal use if descriptive.  
**Recommended mitigation:** random non-descriptive token, exact registrable-domain scope, expiry/recheck, DNS rebinding/transfer handling.  
**Recommendation:** required for all active owned-asset scanning.

### Phone verification

**Approach:** OTP through a vetted provider.  
**Benefits:** confirms present access to number.  
**Drawbacks:** cost, SIM swap/recycling, delivery metadata, accessibility/international gaps.  
**Possible bypasses:** port-out fraud, shared/family numbers, virtual-number farms.  
**Privacy implications:** discloses phone to another processor and may create logs.  
**Recommended mitigation:** no phone searching in MVP; later combine recent OTP, risk signals, spend/velocity caps, and periodic expiry.  
**Recommendation:** defer until a legitimate use case/provider and privacy assessment exist.

### Social account verification

**Approach:** OAuth with minimum scope where available; otherwise temporary in-profile challenge.  
**Benefits:** stronger than handle equality and avoids password collection.  
**Drawbacks:** provider coverage/terms, token lifecycle, profile modification friction.  
**Possible bypasses:** compromised/socially transferred account, public challenge copied.  
**Privacy implications:** provider learns app connection; OAuth can expose excess profile data.  
**Recommended mitigation:** no broad tokens, minimal scopes, immediate token deletion when proof is complete, nonce-bound challenge and revalidation.  
**Recommendation:** use opportunistically; unverified handles receive discovery/review only, not sensitive correlation.

### Explicit consent and capability disclosure

**Approach:** versioned, purpose/provider-category consent before each new data use.  
**Benefits:** transparency, legal evidence, user control.  
**Drawbacks:** fatigue and superficial agreement.  
**Possible bypasses:** attacker controlling account consents for victim identifiers.  
**Privacy implications:** consent record itself is sensitive/useful audit data.  
**Recommended mitigation:** verification remains independent; concise just-in-time consent; withdrawal; no dark patterns.  
**Recommendation:** required but never treated as proof of ownership.

### Rate limits, budgets, and entity limits

**Approach:** per-account, per-identifier, per-provider, global, and device/network risk limits.  
**Benefits:** suppresses bulk use and cost abuse.  
**Drawbacks:** can impede shared networks and users needing remediation.  
**Possible bypasses:** account/device/IP farms and slow distributed queries.  
**Privacy implications:** abuse signals such as IP/device metadata require minimization/retention.  
**Recommended mitigation:** combine verified-entity caps with cost reservation and behavioral signals; appeal path; avoid invasive fingerprinting.  
**Recommendation:** mandatory defense in depth.

**Current foundation:** protected mutations now use database-atomic per-user and shared-network windows. Authentication subjects and network addresses are stored only as separate keyed tokens. Network identity comes from one synthetic local scope or an explicitly configured trusted-ingress header; arbitrary forwarding chains are rejected. These limits add friction but never establish malicious intent.

### Audit trails and abuse detection

**Approach:** append-only records for verification, scan scope, sensitive reveal/export, consent, operator access, and provider usage.  
**Benefits:** investigation, deterrence, deletion/accountability evidence.  
**Drawbacks:** sensitive metadata, operations burden, false alarms.  
**Possible bypasses:** low-and-slow activity, privileged tampering.  
**Privacy implications:** audit data can reveal monitoring habits.  
**Recommended mitigation:** opaque IDs, strict access/retention, tamper resistance, aggregate signals, human review for adverse action.  
**Recommendation:** required before real scanning.

### Terms, attestation, and manual review

**Approach:** clear self-only prohibition, user attestation, progressive restrictions, and review of anomalous behavior.  
**Benefits:** sets expectations and enables enforcement.  
**Drawbacks:** words alone do not stop abuse; review creates sensitive staff access.  
**Possible bypasses:** lying, multiple accounts.  
**Privacy implications:** moderation evidence must be minimized and access-controlled.  
**Recommended mitigation:** pair policy with technical gates; documented review rubric, least-data view, appeal, and deletion.  
**Recommendation:** required as one layer, never the primary control.

## Capability policy

- Unverified name/alias: local organizational label and user-supplied links only; no automated search.
- Unverified username: manual candidate entry and very limited public discovery only after provider review; never cross-person aggregation.
- Verified email: exact-identifier breach metadata and permitted discovery.
- Verified social account: account-specific checks within provider terms.
- Verified domain/site: bounded owned-asset security checks.
- Phone/address/relatives/public records: not supported in MVP.

## Product barriers

No browseable user directory, third-party identity creation, background-check/employment use, minors in MVP, people graph, bulk CSV of raw exposure, public reports, public API, arbitrary batch upload, facial recognition, reverse-image search, credential data, or stealth monitoring. Findings require user confirmation before strong attribution or sensitive remediation.

## Enforcement and appeal

Progressive response: throttle → require re-verification → suspend capability → human review → account suspension/deletion where justified. Preserve minimum evidence, notify without exposing investigative signals, and offer appeal. Do not automate accusations based solely on IP, geography, or one anomaly.
