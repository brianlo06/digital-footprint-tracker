# Privacy Architecture

**Status:** Proposed  
**Objective:** make compromise, misuse, and unnecessary collection materially less damaging.

This product handles identifiers that are both sensitive and highly guessable. Encryption does not make unsafe product scope acceptable; verification, minimization, purpose limits, retention, and deletion are equally important.

## Storage architecture options

| Dimension     | A. Server-side encrypted                                       | B. Client-side encrypted                                                           | C. Hybrid                                                                   | D. Ephemeral scanning                                                   |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Benefit       | simple server search/scheduling and recovery                   | server cannot normally read plaintext                                              | server can schedule only approved identifiers; strongest fields stay opaque | minimizes stored plaintext and breach inventory                         |
| Disadvantage  | app/key compromise exposes values                              | background jobs, dedupe, recovery, multi-device, support become difficult          | classification/key UX complexity and metadata still leaks                   | providers still receive queries; repeat scans cost more; little history |
| Complexity    | medium                                                         | very high                                                                          | high                                                                        | medium/high operationally                                               |
| Cost          | moderate KMS/decryption                                        | client crypto/recovery/support                                                     | both server and client key systems                                          | higher repeated provider calls; lower storage                           |
| Operations    | straightforward rotation/backups                               | lost keys can mean lost data                                                       | two incident/recovery paths                                                 | harder retries, audits, and scheduled work                              |
| Security      | strong if envelope keys and auth are sound                     | strong against DB/server storage theft, weak against malicious client delivery/XSS | limits blast radius by field                                                | low retention but in-memory/log/crash leakage remains                   |
| UX            | familiar                                                       | recovery friction and lost-device risk                                             | explain why features differ by storage class                                | users repeatedly provide values; no continuous monitoring               |
| Scale         | conventional                                                   | crypto/key sync bottlenecks                                                        | conventional with policy complexity                                         | provider cost and repeated normalization dominate                       |
| Scheduling    | supported                                                      | generally incompatible without accessible key                                      | supported only for server-readable verified identifiers                     | incompatible unless value is re-supplied or held temporarily            |
| Breach impact | ciphertext + metadata; app/KMS compromise severe               | metadata and ciphertext, unless delivery/key path compromised                      | server-readable subset exposed; opaque vault safer                          | history metadata exposed, fewer raw identifiers                         |
| Mitigations   | envelope encryption, key separation, least privilege, deletion | WebAuthn recovery, CSP, audited crypto, local export                               | explicit field matrix, policy-as-code, recovery design                      | memory hygiene, no logs, bounded queues, provider privacy review        |

## Recommendation

Use a pragmatic hybrid centered on server-side application encryption:

1. Verified identifiers needed for explicit user-triggered scans are envelope-encrypted server-side so authorized workers can use them. Scheduled scans remain out of MVP.
2. Use a keyed HMAC lookup token for equality/deduplication; never use an unsalted hash of emails or phone numbers because their space is guessable.
3. Do not persist normalized plaintext. Keep masked display values separately only if the masking cannot materially reveal the identifier.
4. Especially sensitive free-form notes, recovery material, images, government identifiers, precise addresses, and any credentials are not collected. If a future use case truly needs an opaque vault, introduce client-side encryption for that field class only.
5. Use ephemeral provider payload processing where possible; persist structured evidence summaries, not raw responses.

This preserves background-capable architecture without pretending end-to-end/client encryption can coexist transparently with server-side monitoring. The field classification and key strategy require security review before implementation.

## Data classification

| Class        | Examples                                                       | Default handling                                  |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------- |
| Restricted   | raw email/phone, address, birth data, provider query           | app encrypted; minimal access; never logs/metrics |
| Confidential | finding evidence, linked identity signals, remediation history | encrypted database/storage; tenant-scoped access  |
| Internal     | opaque IDs, provider health, cost ledger                       | normal access control; no public exposure         |
| Public       | product documentation, generic guidance                        | publishable after review                          |

Passwords, credential material, stolen tokens, breach dumps, government IDs, and facial embeddings are prohibited data.

## Encryption and key lifecycle

- TLS 1.2+ in transit, prefer current TLS 1.3; HSTS in production.
- Provider connections require certificate verification and fixed trusted endpoints.
- Managed storage encryption and encrypted backups are baseline, not substitutes for application encryption.
- Envelope-encrypt restricted fields with per-record or per-tenant data encryption keys wrapped by KMS-held key encryption keys.
- Bind ciphertext to tenant, record, field, and schema version using authenticated additional data.
- Separate application/database roles from KMS permission; workers decrypt only job-scoped identifiers.
- Store key IDs/versions with ciphertext, never keys. Rotation rewraps data keys first; re-encrypt content when algorithm/key compromise demands it.
- Quarterly access review and rehearsed rotation/deletion runbooks before production.

## Retention policy proposal

| Data                         |                                                       Default | Treatment and rationale                                                  |
| ---------------------------- | ------------------------------------------------------------: | ------------------------------------------------------------------------ |
| Provider raw response        |     0–24 hours; max 7 days only for approved parser debugging | encrypted quarantine, access logged, automatic purge; prefer no storage  |
| Provider query plaintext     |                                         request lifetime only | encrypted identifier is source; never logs/job payloads                  |
| Normalized finding           |          while account active, plus user-configurable history | core user value; encrypted sensitive fields                              |
| Observation                  | 24 months, then monthly aggregate unless user chooses shorter | supports trends/reappearance; retain evidence summary, not payload       |
| Evidence summary/provenance  |                                       life of finding/history | required explainability; redact and minimize                             |
| Completed scan/job detail    |                                                       90 days | retain summary longer; delete payload refs/errors earlier                |
| Notification                 |                             90 days after read; 12 months max | no copied sensitive content                                              |
| Consent/verification history |               account life + limited legal period if required | append-only proof; challenge secrets expire immediately                  |
| Security audit logs          |                                            12 months proposed | pseudonymous, tightly restricted; final period needs legal/threat review |
| Application logs             |                                                    14–30 days | sanitized and sampled; shorter for debug logs                            |
| Backups                      |                                      rolling 35 days proposed | encrypted; deleted data ages out; documented restore tombstones          |
| Usage/cost aggregates        |                                                     24 months | no raw identifier; aggregate where possible                              |

Provider agreements can require shorter or prohibit caching; adapter metadata must override defaults downward. Users should be offered shorter history, and retention must be enforceable by automated deletion with metrics and audits.

The Phase 1 foundation implements one bounded, unscheduled maintenance batch for expired pending verification secrets, expired completed deletion receipts, and aged orphan audit events. Failed or incomplete deletion receipts are excluded. Production periods and invocation remain approval gates; see `RETENTION_OPERATIONS.md`.

## Account deletion

1. Reauthenticate and explain immediate/queued effects.
2. Stop sessions, schedules, queued provider jobs, notifications, and provider processing.
3. Mark deletion request with an opaque tombstone to make retries idempotent.
4. Delete/revoke identifiers, findings, observations, evidence blobs, suppressions, remediation, notification content, credentials, and user configuration in dependency-safe batches.
5. Propagate deletion to processors/providers when contract and law require it.
6. Cryptographically erase tenant/data keys when supported.
7. Retain only narrowly necessary pseudonymous security/consent/legal records, separated and access-restricted, with documented basis and expiry.
8. Allow encrypted backups to age out within the disclosed window; restoration procedures reapply deletion tombstones before service.
9. Produce a completion receipt that does not enumerate sensitive content.

Deletion must be tested for partial failure, repeated invocation, backups, search indexes, caches, telemetry, object storage, auth provider, and outbound notification systems.

## Consent and purpose limitation

Consent is granular by identifier, capability, provider category, and continuous monitoring. It is versioned, revocable, and not bundled with unrelated analytics. Withdrawal prevents future scans immediately; deletion/retention follows the chosen policy. Public accessibility is not treated as consent to aggregate or republish.

## Privacy-safe analytics and support

Use first-party aggregate events, no session replay, no ad pixels, no raw route parameters containing finding IDs in third-party analytics, and minimum cohort thresholds. Support staff get time-bound, approved, audited access to redacted views; default tooling cannot reveal identifier plaintext. Production data never enters tickets or chat tools.

## Data protection impact assessment triggers

Complete a formal DPIA/legal review before continuous large-scale monitoring, processing minors/family identities, biometric/image matching, precise location/address workflows, breach/dark-web services, automated broker representation, public-record aggregation, or material profiling/scoring.

References: [European Commission GDPR principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en) and [California DOJ CCPA overview](https://oag.ca.gov/privacy/ccpa). This document is product design, not legal advice.
