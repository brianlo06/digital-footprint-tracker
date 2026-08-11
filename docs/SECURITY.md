# Security Requirements

**Status:** Active baseline. Phase 1 implements a limited subset (auth boundary, encrypted email identifiers, safe logging, consent/audit, local deletion lifecycle); all provider/scan controls and production-readiness gates remain requirements.

## Highest-risk assets

Raw identifiers, identity-to-finding relationships, session/authentication material, provider credentials, encryption keys, verification challenges, evidence, deletion state, and audit integrity. Aggregating otherwise public data creates a more sensitive asset than each source alone.

## Required controls before handling real data

### Identity, sessions, and authorization

- standards-based authentication with MFA/passkeys support and breached-password protections if passwords exist;
- secure, HttpOnly, SameSite cookies; short-lived sessions for sensitive actions; rotation on privilege change;
- server-side tenant authorization on every object by relationship, never client-provided user IDs;
- reauthentication for plaintext identifier reveal, exports, new verification, notification changes, and deletion;
- CSRF protection for state changes, strict CORS and origin validation;
- login, verification, recovery, scan, and export enumeration resistance with layered rate limits.

### Application and browser

- strict TypeScript and schema validation at every trust boundary;
- parameterized queries/ORM and least-privileged database roles;
- forced tenant RLS for web access and function-only security-definer capabilities for cross-tenant maintenance;
- output encoding and sanitization; no raw provider HTML;
- CSP with nonces/hashes, Trusted Types where feasible, HSTS, `frame-ancestors 'none'`, restrictive referrer and permissions policies;
- safe URL rendering and no server fetch from arbitrary user-provided URLs;
- dependency pinning, lockfile review, SCA, secret scanning, signed/provenanced builds when production starts.

### Providers and jobs

- server-only secrets through secret manager references, per-provider credentials and rotation;
- fixed provider endpoint allowlists, egress policy, time/payload/redirect bounds, SSRF controls;
- signed webhook verification with timestamp/replay defense before any webhook integration;
- adapter schema validation, parser versions, provenance, poisoning/anomaly detection;
- at-least-once idempotency, leases, bounded retry, cost budgets, kill switches;
- quarantine untrusted content and never execute scripts/macros or follow embedded instructions.

### Data and operations

- application-level encryption for restricted identifiers, KMS envelope encryption, authenticated context;
- encrypted database, objects, backups, and transport;
- production/preview separation, no production PII in lower environments;
- least privilege, just-in-time operator access, immutable/tamper-evident audit trail;
- sanitized logs/metrics/traces; incident response, tested restore and deletion runbooks;
- SAST, DAST, dependency review, authorization tests, provider contract tests, and annual penetration testing before material scale.

## Verification capability matrix

| Identifier      | Verification                                  | Allowed when verified                                         | Allowed when unverified                |
| --------------- | --------------------------------------------- | ------------------------------------------------------------- | -------------------------------------- |
| Email           | expiring code/link                            | breach metadata and exact-email discovery if provider permits | store pending; no sensitive scans      |
| Domain          | DNS TXT; later web meta/file                  | bounded DNS/TLS/HTTP/mail-security checks                     | setup guidance only                    |
| Website         | meta tag/file or domain proof                 | site-specific checks                                          | manual link inventory only             |
| Phone           | OTP only after cost/privacy review            | limited provider capability if lawful                         | no automated exposure search           |
| Social username | OAuth where available or in-profile challenge | account-specific checks                                       | manual candidate review; low frequency |
| Full name/alias | not exclusively verifiable                    | supporting signal when other proof exists                     | manual entry/search guidance only      |

Verification tokens are hashed, single use, purpose-bound, short-lived, attempt-limited, and never logged. Domain verification proves control at a time, not legal ownership forever; expire and recheck it.

## Security acceptance gates

No production PII until data-flow/threat review, field encryption tests, tenant authorization tests, deletion test, log redaction test, backup policy, incident plan, provider legal review, and abuse-control tests pass. No provider goes live without a kill switch, quota, timeout, parser contract fixture, and provenance display.

Use OWASP ASVS as a verification baseline and map requirements before Phase 1 production readiness: [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/).
