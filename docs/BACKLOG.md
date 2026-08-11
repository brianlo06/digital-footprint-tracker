# Prioritized Backlog

This is planning inventory. Do not execute items until their phase is approved.

## P0 — Required before real personal data or providers

### P0-01 Approve architecture and product boundary

**Reason:** prevents accidental surveillance scope and overbuilding.  
**Dependencies:** Phase 0 documents and stakeholder review.  
**Acceptance criteria:** ADR dispositions recorded; self-only capability matrix and MVP exclusions approved; owner/jurisdiction assumptions named.  
**Risks:** unresolved commercial goals cause redesign.

### P0-02 Establish TypeScript application foundation

**Reason:** create one maintainable runtime and quality baseline.  
**Dependencies:** P0-01; ORM/host-neutral decisions.  
**Acceptance criteria:** local setup uses no paid service; strict TypeScript/lint/test/build run; accessible placeholder shell; no provider network code.  
**Risks:** framework/config churn.

### P0-03 Select and threat-review authentication

**Reason:** account takeover exposes an aggregated identity profile.  
**Dependencies:** launch jurisdiction, auth vendor comparison.  
**Acceptance criteria:** MFA/passkey, session/recovery, export/deletion, privacy/DPA, rate-limit and portability requirements documented/tested.  
**Risks:** vendor lock-in and metadata leakage.

### P0-04 Implement tenant authorization policy

**Reason:** IDOR/BOLA is a critical risk.  
**Dependencies:** auth subject mapping and conceptual model.  
**Acceptance criteria:** server ownership checks on every resource; negative cross-tenant matrix tests; opaque IDs; optional RLS decision documented.  
**Risks:** policy drift in new routes/jobs.

### P0-05 Implement identifier encryption and key lifecycle

**Reason:** database compromise must not reveal identifiers directly.  
**Dependencies:** KMS/local development design; field classification.  
**Acceptance criteria:** AEAD envelope format/version; keyed lookup tokens; rotation/deletion tests; no plaintext persistence/logging; least-decrypt access.  
**Risks:** key loss/misuse, normalization mismatch.

### P0-06 Build verification/consent policy interfaces

**Reason:** sensitive scans require proof and purpose.  
**Dependencies:** P0-03–05.  
**Acceptance criteria:** email fake flow; expiring/hashed challenges; versioned scoped consent; capability policy denial tests; no real messages sent.  
**Risks:** authentication confused with identifier ownership.

### P0-07 Complete deletion and retention engine

**Reason:** deletion is a core promise and legal/security control.  
**Dependencies:** all stores/processors enumerated.  
**Acceptance criteria:** idempotent manifest; queues/sessions/caches/objects covered; tombstone/retry/reconciliation; backup restoration procedure; completion receipt.  
**Risks:** orphaned data and over-retained audit records.

### P0-08 Enforce privacy-safe telemetry

**Reason:** logs are a common uncontrolled copy of PII.  
**Dependencies:** field/event allowlists.  
**Acceptance criteria:** centralized structured logger; synthetic PII canary across logs/traces/metrics; retention/access; no request bodies/full URLs.  
**Risks:** third-party SDK auto-capture.

### P0-09 Define provider contract and mock suite

**Reason:** prove replaceability before any provider.  
**Dependencies:** data model, job/error taxonomy.  
**Acceptance criteria:** typed capability/context/candidate/provenance/error/health contracts; mock success/outage/429/malformed/poison fixtures; zero network access.  
**Risks:** abstraction too generic or provider-specific.

### P0-10 Provider approval gate and first-provider decision

**Reason:** technical availability does not equal permitted/recommended use.  
**Dependencies:** legal/privacy/security review, value research, hard budget.  
**Acceptance criteria:** completed checklist, current terms/API evidence, DPA/security/cost/retention, kill switch, exit plan, explicit owner approval.  
**Risks:** provider lifecycle/pricing changes before launch.

## P1 — First evidence workflow

### P1-01 Durable scan/outbox and worker

**Reason:** network work cannot live in web requests.  
**Dependencies:** P0-09/10 and database foundation.  
**Acceptance criteria:** leases, idempotency, retry jitter, cancellation, quotas, cost reservation, crash recovery, sanitized errors.  
**Risks:** duplicate calls and DB contention.

### P1-02 Finding/Observation/Evidence persistence

**Reason:** temporal, explainable evidence is the core product.  
**Dependencies:** encryption, first adapter contract.  
**Acceptance criteria:** immutable observations; fingerprint version; presence/indeterminate rules; provenance; reappearance tests; no raw payload default.  
**Risks:** incorrect merges and false resolution.

### P1-03 Conservative identity review workflow

**Reason:** false positives are inevitable.  
**Dependencies:** evidence signals and UI shell.  
**Acceptance criteria:** explanation/counter-signals; confirm/reject; scoped reversible suppression; no auto-verified match without control proof.  
**Risks:** user confirmation bias.

### P1-04 Category dashboard and coverage

**Reason:** users need action, not result dumps.  
**Dependencies:** P1-02/03.  
**Acceptance criteria:** high-priority/recent/resolved/category sections; provider coverage and partial scan; accessible/mobile; no universal score.  
**Risks:** misleading counts across incomplete scans.

### P1-05 Remediation action tracking

**Reason:** findings need honest next steps.  
**Dependencies:** finding review.  
**Acceptance criteria:** versioned guidance; status lifecycle; submitted ≠ success; user claim vs external verification visible.  
**Risks:** stale or unsafe guidance.

### P1-06 Dashboard-only alerts

**Reason:** surface important change with minimal disclosure.  
**Dependencies:** observations and sessions.  
**Acceptance criteria:** new/reappeared/high-risk events; authenticated content; read/dismiss; retention.  
**Risks:** alert fatigue.

## P2 — Safety, operations, and selective breadth

### P2-01 Abuse detection and enforcement console

**Reason:** distributed low-rate misuse can bypass simple limits.  
**Dependencies:** privacy-safe audit and policy.  
**Acceptance criteria:** minimized signals, review rubric, JIT access, progressive controls, appeal, no automated accusations.  
**Risks:** moderator privacy and bias.

### P2-02 Provider health and operational runbooks

**Reason:** partial failures must be visible and recoverable.  
**Dependencies:** worker/provider runs.  
**Acceptance criteria:** five health states, dashboards/alerts, kill switch, degraded UI, incident/rollback drills.  
**Risks:** alert noise.

### P2-03 Verified-domain low-risk adapter

**Reason:** owned assets are valuable and controllable.  
**Dependencies:** DNS verification, SSRF/egress review, provider approval.  
**Acceptance criteria:** user-triggered DNS/TLS/mail metadata only; exact verified scope; bounds; no subdomain/port enumeration.  
**Risks:** stale ownership and SSRF.

### P2-04 User-supplied broker workflow

**Reason:** deliver remediation value without scraping.  
**Dependencies:** legal-reviewed instruction registry.  
**Acceptance criteria:** link validation, manual confirmation, reviewed instructions/version/date, submitted/waiting/rescan states.  
**Risks:** malicious links and changing forms.

### P2-05 Privacy export

**Reason:** transparency and portability.  
**Dependencies:** authorization, encryption, retention.  
**Acceptance criteria:** reauthentication, async bounded export, encrypted/expiring download, audit, excludes secrets/internal abuse signals as justified.  
**Risks:** export becomes high-value exfiltration artifact.

## P3 — Deferred experiments

### P3-01 Adaptive opt-in schedules

**Reason:** continuous monitoring is long-term value.  
**Dependencies:** proven accuracy/economics, DPIA/consent, revalidation.  
**Acceptance criteria:** explicit frequency, hard caps, withdrawal, stale-ownership stop, quiet hours, deletion cancellation.  
**Risks:** cost and surveillance perception.

### P3-02 Generic email notifications

**Reason:** bring users back for important change.  
**Dependencies:** provider selection/deliverability/privacy review.  
**Acceptance criteria:** generic subject/body, no sensitive data, secure deep link, preference/unsubscribe, bounce/deletion flow.  
**Risks:** inbox/processor disclosure.

### P3-03 Additional search/social adapter experiment

**Reason:** test incremental confirmed coverage.  
**Dependencies:** current API/terms approval and calibrated matching.  
**Acceptance criteria:** small opt-in cohort, one provider, budget, no username bulk enumeration, false-positive/confirmed-value threshold predeclared.  
**Risks:** scope creep, ToS, identity harm.

### P3-04 Experimental category trend/index research

**Reason:** summarize progress without deceptive precision.  
**Dependencies:** outcome data and user research.  
**Acceptance criteria:** versioned, explainable drivers, coverage-normalized, category-first, no fear copy or guarantees.  
**Risks:** gamification and misleading comparisons.

### P3-05 AI guidance research (not integration)

**Reason:** assess whether summaries add value over templates.  
**Dependencies:** privacy/processor/prompt-injection review.  
**Acceptance criteria:** synthetic/offline evaluation; no PII, tools, autonomous actions, or identity/severity decisions; measured benefit.  
**Risks:** hallucination, data transfer, prompt injection, cost.
