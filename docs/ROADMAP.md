# Phased Roadmap

No later phase begins without explicit owner approval. Security/privacy/legal gates are deliverables, not cleanup tasks.

## Phase 0 — Architecture and scaffold (complete)

**Objective:** define the evidence platform and safe boundaries before code.  
**Deliverables:** product/architecture/data model; provider contracts; privacy/security/threat/abuse/legal documents; diagrams; ADRs; risk/cost models; roadmap/backlog; placeholders.  
**Dependencies:** product prompt and current official-source research.  
**Risks:** false confidence from documentation; provider/legal assumptions age.  
**Exit Criteria:** Phase 0 definition of done is audited; no functional product exists; owner reviews proposed ADRs and open questions.

## Phase 1 — Application foundation (complete)

**Objective:** create a secure local-first shell without real scanning.  
**Deliverables:** Next.js/TypeScript setup; responsive accessible shell; local PostgreSQL; Drizzle migrations; managed-auth boundary; one-identity/encrypted-email lifecycle; envelope-encryption abstraction with local fake KMS; consent/audit/deletion skeleton; mocks only; lint/unit/integration/build baseline. See `PHASE_1_STATUS.md` for implemented scope and pre-production activation gates.
**Dependencies:** accept the foundation ADRs; choose auth/ORM; define a local key strategy. Provider, job, and finding ADRs remain proposed until their phases begin; jurisdiction and production key-custody approval remain activation gates because Phase 1 handles synthetic local data only.
**Risks:** auth lock-in, premature UI breadth, encryption/log leakage, deletion gaps.  
**Exit Criteria:** threat-reviewed auth/authorization; no real providers; synthetic E2E add/mask/delete flow; PII log canary and tenant-isolation tests pass. Met on 2026-08-15; see `PHASE_1_STATUS.md`. Hosted personal-data activation remains separately gated there.

## Phase 2 — First low-risk provider (synthetic scope complete)

**Objective:** prove one provider end-to-end without building a general scanner.  
**Deliverables:** provider selection memo and legal/ToS/security review; feature flag/kill switch; synthetic contract fixtures; server-only adapter; verified-email capability gate; hard quota/cost ledger; provenance display. HIBP is the conditional preferred breach-metadata provider; `PHASE_2_READINESS.md` blocks non-synthetic use pending compatible written terms.
**Dependencies:** Phase 1; provider contract, budget, DPA/terms, verification.  
**Risks:** query privacy, price/access change, rate limit, breach result misinterpretation.  
**Exit Criteria:** sandbox/synthetic tests first; explicitly approved production test; no prohibited credential data; rollback demonstrated; user sees source/limits/guidance. All ten recorded synthetic slices are complete as of 2026-08-27: synthetic tests, prohibited-data exclusion, the end-to-end kill-switch rollback drill, and coverage/source/limits display are met and evidenced in `PHASE_2_READINESS.md`. Only the explicitly approved production test remains, and it stays blocked on written HIBP permission, counsel review, a nonzero budget decision, and separate owner authorization.

## Phase 3 — Scan and temporal evidence engine (approved 2026-08-29, synthetic-only)

**Objective:** make provider work durable, idempotent, explainable, and historical.  
**Deliverables:** DB-backed queue/outbox, worker, scan/provider states, bounded retry/cancel, normalization, fingerprint versioning, findings/observations/evidence, provider health, partial coverage, usage reconciliation.  
**Dependencies:** Phase 2 contract and Phase 1 persistence/security.  
**Risks:** duplicate billing, false absence, stuck leases, poison payloads.  
**Exit Criteria:** mandatory job/dedupe/reappearance/outage/cost tests pass; no provider failure corrupts scan; operations runbooks exist.

The owner approved this phase on 2026-08-29 for synthetic-only implementation; ADR 0006 was accepted with it. The approval authorizes no live provider, real personal data, nonzero budget, or hosted activation.

Phase 2's queued scan workflow already delivered the durable queue/outbox, worker, scan/provider states, bounded retry/cancel, normalization, and usage reservations. Provider-health persistence and partial-coverage semantics landed on 2026-08-29.

### Slice 1 — generic finding and observation temporal core (complete 2026-08-29)

- migration `0023` adds tenant-owned `findings` and `observations` tables with forced RLS and the same single-join tenant policy as the other per-tenant tables;
- a finding is identified by a versioned SHA-256 fingerprint over finding type, provider scope, normalized host, the identifier's keyed HMAC lookup token, and the provider's stable external ID — never a raw identifier value, and never a mutable title or description; fields are length-prefixed so no value can imitate a different field split;
- `FINDING_FINGERPRINT_VERSION` is stored per row, so a future normalization change (a public-suffix registrable domain, for example) arrives as `v2` instead of silently re-identifying history;
- observations are append-only, one per provider run per finding, chained through `previous_observation_id`, and carry a content fingerprint so a change to the same finding's details is visible;
- ADR 0006's rules live in one pure module: only a fully completed scan can infer absence, a failed or partial scan yields `INDETERMINATE` and changes nothing, a finding resolves only after two consecutive confirmed absences, a later presence marks it `REAPPEARED`, and user-owned statuses are never overwritten by automatic rules; and
- the dashboard shows tracked findings with presence and status, deduplicated across checks.

Verification: the full migration chain applied to a clean PostgreSQL 17 database, hosted-style provisioning and `npm run db:verify:boundaries` passed with both new tables attested, all 70 restricted-role integration tests passed (4 new, covering deduplication across repeated scans, resolve-then-reappear, degraded-scan absence handling, and cross-tenant isolation), the service-independent suite passed with 275 tests (29 new), and `npm run check`/`npm run build` passed.

Remaining Phase 3 work: `Evidence` persistence, cross-provider equivalence groups, observation retention per `docs/PRIVACY.md`'s 24-month rule, and operations runbooks.

## Phase 4 — Review dashboard and remediation

**Objective:** turn evidence into safe user decisions.  
**Deliverables:** category dashboard, finding detail/provenance, history, confirm/reject, suppression, remediation actions, dashboard notifications, coverage messaging, account export/deletion completion.  
**Dependencies:** stable temporal model and accessibility design.  
**Risks:** fear-inducing presentation, false attribution, sensitive content leakage.  
**Exit Criteria:** user research validates comprehension; WCAG 2.2 AA review; no composite score; remediation status claims are accurate.

## Phase 5 — Carefully selected additional providers

**Objective:** expand value one capability at a time.  
**Deliverables:** separate approval/adapter/contract/kill switch for manual search discovery, social verification, broker-assisted workflow, or verified-domain DNS/TLS/mail checks.  
**Dependencies:** reliable core, unit economics, legal/safety review for each source.  
**Risks:** scope becomes surveillance; ToS churn; matching errors; escalating spend.  
**Exit Criteria:** each provider independently removable; incremental confirmed-value and false-positive metrics justify it; no broad enumeration/scraping.

## Phase 6 — Continuous monitoring and notifications

**Objective:** add explicit opt-in adaptive scheduled checks after manual scanning is trustworthy.  
**Deliverables:** schedule consent/frequency, ownership revalidation, quiet hours, dashboard/email notification policy, generic outbound content, budget forecast, provider outage handling.  
**Dependencies:** retention/DPIA review, reliable queue, cost model, deliverability choice.  
**Risks:** ongoing surveillance perception, stale ownership, notification leaks, runaway bill.  
**Exit Criteria:** opt-in/withdrawal tested; per-user/global caps; content privacy review; schedule/deletion reconciliation.

## Phase 7 — Assisted privacy automation

**Objective:** reduce remediation toil only through authorized, honest workflows.  
**Deliverables:** versioned broker instructions; partner/API evaluation; explicit authority; submission receipts; waiting/rescan/verified outcome; dispute/support paths.  
**Dependencies:** counsel, partner terms, provider registry, strong verification.  
**Risks:** impersonation, excess identity disclosure, captchas/terms, false removal claims.  
**Exit Criteria:** legal approval per workflow; minimum disclosure; no stealth automation; submitted and verified-removed remain distinct.

## First milestone after approval

Build only the foundation slice: toolchain, accessible shell, local PostgreSQL, auth selection/integration, one identity with encrypted email storage and verification interface backed by a local fake, consent/audit records, full account deletion workflow, and synthetic tests. No provider, scan engine, scheduling, or dashboard findings yet. This milestone validates the hardest trust boundary before external data enters the system.
