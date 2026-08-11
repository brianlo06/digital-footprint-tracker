# Threat Model

**Method:** STRIDE-informed misuse and privacy analysis  
**Status:** Proposed; update whenever data flow, provider, auth, or deployment changes.

## Trust boundaries

Browser ↔ application; application ↔ auth/verification processor; application/worker ↔ database/KMS; worker ↔ external provider; services ↔ telemetry; operator ↔ production. External content, URLs, provider responses, webhooks, users, and client state are untrusted.

Likelihood and residual risk are qualitative pre-implementation estimates.

| Threat                                        | Asset                           | Attack                                | Impact                             | Likelihood       | Mitigation                                                                                                   | Residual risk                              |
| --------------------------------------------- | ------------------------------- | ------------------------------------- | ---------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Database compromise (I/D)                     | identifiers, evidence           | stolen snapshot/SQL access            | doxxing, identity harm             | medium           | field envelope encryption, keyed tokens, least privilege, segmentation, audit, short retention               | high if app+KMS also compromised           |
| Malicious user / third-party monitoring (S/I) | another person’s footprint      | enters victim identifiers             | stalking/harassment                | high             | verification gates, self-only terms, capability matrix, velocity/entity limits, abuse review                 | names/public handles remain hard to prove  |
| Account takeover (S/E)                        | complete identity profile       | credential stuffing, recovery abuse   | consolidated sensitive disclosure  | high             | passkeys/MFA, managed auth, anomaly/rate controls, reauth, generic notices                                   | stolen active session/device               |
| Insider access (E/I/R)                        | plaintext identifiers           | support/admin misuse                  | covert surveillance                | medium           | no default plaintext UI, JIT dual-approved access, immutable audit, separation, alerts                       | privileged collusion/emergency access      |
| API key leakage (S/E/D)                       | provider accounts/budget        | repo/log/client exposure              | data access, cost, suspension      | medium           | secret manager, server-only keys, scanning, per-provider scope/quota, rotation                               | provider may lack granular scopes          |
| Dashboard scraping (I/D)                      | findings                        | XSS, stolen session, automated export | bulk disclosure                    | medium           | CSP, secure sessions, reauth/export limits, no share links, bot/rate signals                                 | malware/compromised browser                |
| Enumeration (I)                               | account/identifier existence    | response/timing differences           | confirms victims/users             | high             | uniform messages/timing, tokenized flows, layered rate limits                                                | distributed low-rate probing               |
| IDOR/BOLA (E/I)                               | tenant records                  | guess/change object IDs               | cross-user disclosure              | high             | server relationship authorization, opaque IDs, policy tests, DB constraints/RLS defense                      | authorization regression                   |
| SSRF (E/I)                                    | cloud metadata/internal network | malicious URL/redirect/DNS rebinding  | secret theft/pivot                 | high if fetching | fixed provider hosts, egress proxy, IP validation each hop, block private/link-local, no arbitrary fetch MVP | parser/provider redirect defects           |
| XSS (E/I)                                     | session/data                    | malicious snippet/URL/markdown        | session actions/exfiltration       | high             | never render provider HTML, encode/sanitize, CSP/Trusted Types, safe links                                   | framework/dependency bypass                |
| CSRF (T/E)                                    | settings/actions                | cross-origin state change             | scans, disclosure, deletion        | medium           | SameSite, anti-CSRF, origin checks, reauth                                                                   | browser quirks/misconfiguration            |
| SQL injection (T/I)                           | all database data               | unparameterized input                 | mass compromise                    | medium           | parameterized access, validation, least DB role, SAST/tests                                                  | raw query regression                       |
| Credential stuffing (S)                       | accounts                        | reused passwords                      | takeover                           | high             | managed auth, MFA/passkeys, breached-password checks, throttling                                             | targeted proxy attacks                     |
| Provider poisoning (T/R)                      | finding integrity               | crafted response/listing              | false accusation or malicious link | high             | schema limits, provenance, parser versions, cross-signal confidence, user confirmation, anomaly review       | legitimate provider contains bad data      |
| Forged finding (T/R)                          | trust/history                   | client submits source/confidence      | misleading advice                  | medium           | server-created findings only, signed audit lineage, provider-run linkage                                     | compromised provider/app                   |
| Malicious URL (I/E)                           | user/device                     | phishing/tracking/download in result  | compromise or privacy leak         | high             | display hostname, interstitial, rel isolation, block dangerous schemes, no previews                          | trusted site later changes                 |
| Webhook spoof/replay (S/T)                    | scan state                      | forged callback                       | false findings/status              | medium later     | signature+timestamp, raw-body verification, nonce/idempotency, allowlist                                     | provider signing compromise                |
| Session theft (S)                             | user account                    | XSS, malware, cookie theft            | full access                        | medium           | HttpOnly/Secure cookies, rotation, CSP, short sensitive session, revoke UI                                   | endpoint/device compromise                 |
| Verification bypass (S/E)                     | capability gate                 | brute force/replay, stale DNS         | unauthorized scan                  | high             | hashed expiring challenges, attempt limits, purpose binding, revalidation, audit                             | transferred domain/account                 |
| Cost exhaustion (D)                           | budget/availability             | scan spam/fan-out/retry storm         | bill/outage                        | high             | hard reservations/caps, per-user/global limits, circuit breaker, idempotency                                 | distributed accounts/provider billing lag  |
| Job duplication/replay (T/D)                  | observations/cost               | at-least-once duplicate               | duplicate charges/findings         | high             | unique idempotency keys, leases, usage ledger, upsert observation identity                                   | non-idempotent provider calls              |
| Deletion failure (I/R)                        | user data                       | orphaned objects/backups/processors   | retained data after promise        | medium           | deletion manifest, tombstones, processor propagation, automated reconciliation/tests                         | legal hold/backups within disclosed window |
| Logging/telemetry leak (I)                    | PII/secrets                     | body/URL/error serialization          | broad third-party leakage          | high             | schema allowlist, canary tests, short retention, sink controls                                               | novel exception paths                      |
| Supply-chain compromise (E)                   | build/runtime/secrets           | malicious dependency/action           | total compromise                   | medium           | minimal deps, lock/pin, provenance, review, SCA, isolated CI                                                 | trusted maintainer compromise              |
| Denial of service (D)                         | app/queue/providers             | large payloads, slow calls, job flood | unavailable/cost                   | high             | bounds/timeouts, quotas, backpressure, queue partitions, degraded mode                                       | upstream regional outage                   |
| Audit tampering/repudiation (R/T)             | accountability                  | delete/forge access events            | hidden abuse                       | medium           | append-only restricted sink, integrity chaining/managed retention, clocks                                    | privileged platform compromise             |
| Scraped-content prompt injection (E/T)        | future AI/action engine         | page tells model to expose/act        | data leak or false action          | high if LLM used | no LLM MVP; treat text as data, no tools, redact, output schema, human approval                              | model non-determinism                      |

## Abuse cases that cross threat categories

The most consequential failure is legitimate functionality used against another person. Authentication, encryption, and secure code do not solve this. Capability gating, verification, query-budget design, product copy, audit, anomaly detection, manual review, and refusal to support bulk export are required security controls.

## Incident priorities

1. Contain account/provider/key access and suspend affected scan capabilities.
2. Preserve privacy-safe audit evidence; do not expand PII exposure during triage.
3. Determine identifiers, fields, tenants, processors, and retention copies affected.
4. Rotate secrets/keys, invalidate sessions, block malicious jobs and URLs.
5. Meet contractual/legal notice requirements with counsel.
6. Delete unnecessary incident copies and document control changes.

## Revisit triggers

First real provider, scheduled scans, outbound notification, direct webpage retrieval, support console, new identity type, family/minors, broker automation, public API, native/extension client, AI processing, or new jurisdiction.
