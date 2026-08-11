# Major Tradeoffs

All decisions are proposed. “Workaround” means a bounded response to the downside, not permission to expand scope.

## Monolith vs microservices

**Decision:** service shape  
**Recommended Approach:** modular monolith, separately runnable worker later

**Pros:** one codebase/data model/deploy; low operational and security surface.  
**Cons:** modules can blur; worker and web share releases.  
**Risks:** accidental coupling and long tasks in request path.  
**Possible Improvements:** enforced module imports and domain contracts.  
**Workarounds:** worker process from same repository/database.  
**When we should reconsider:** independent scaling, security isolation, team ownership, or release cadence is measured.

## Next.js backend vs separate API

**Decision:** application boundary  
**Recommended Approach:** Next.js server endpoints/use cases initially

**Pros:** one language, auth/session model, deploy and local loop.  
**Cons:** runtime/hosting constraints for background work.  
**Risks:** framework code entering the core.  
**Possible Improvements:** transport-independent services/contracts.  
**Workarounds:** separate same-codebase worker; move API later.  
**When we should reconsider:** multiple clients/public API, independent backend scaling, or non-Node needs.

## Serverless vs persistent workers

**Decision:** asynchronous execution  
**Recommended Approach:** portable persistent worker when scans exist; serverless web is acceptable

**Pros:** clear deadlines, connection reuse, controlled concurrency.  
**Cons:** an always-on process costs/operates more at tiny scale.  
**Risks:** host complexity.  
**Possible Improvements:** autoscaling or scale-to-zero host.  
**Workarounds:** short jobs may run in supported functions behind same queue contract.  
**When we should reconsider:** workloads are short/bursty and managed orchestration proves simpler.

## SQL vs document database

**Decision:** system of record  
**Recommended Approach:** PostgreSQL

**Pros:** relational integrity, transactions, temporal queries, JSON for bounded provider metadata.  
**Cons:** schema evolution and connection management.  
**Risks:** dumping unbounded provider JSON into tables.  
**Possible Improvements:** normalized tables, retention partitions later.  
**Workarounds:** short-lived encrypted object quarantine for payloads.  
**When we should reconsider:** never for convenience alone; only a proven separate workload.

## Client vs server encryption

**Decision:** identifier confidentiality  
**Recommended Approach:** hybrid centered on server application-level envelope encryption

**Pros:** server-authorized scans remain possible; DB theft resistance; field policy flexibility.  
**Cons:** application/KMS compromise can decrypt server-readable values.  
**Risks:** metadata leakage and key misuse.  
**Possible Improvements:** opaque client vault for future fields that never need server processing.  
**Workarounds:** keyed lookup tokens, least decrypt privilege, no plaintext persistence/logging.  
**When we should reconsider:** scheduled scanning is removed or a zero-knowledge product becomes the core promise.

## Scheduled vs user-triggered scans

**Decision:** scan trigger  
**Recommended Approach:** user-triggered MVP

**Pros:** clear consent, lower cost/retention, easier abuse control.  
**Cons:** slower discovery of new exposure.  
**Risks:** users infer continuous protection.  
**Possible Improvements:** explicit last-checked/coverage UI, later opt-in adaptive schedules.  
**Workarounds:** reminders without sensitive content.  
**When we should reconsider:** core accuracy and abuse controls are proven and unit economics support monitoring.

## Provider APIs vs scraping

**Decision:** external access  
**Recommended Approach:** legitimate official/licensed APIs, user-submitted links, manual verification

**Pros:** contractual clarity, stability, structured provenance.  
**Cons:** gaps, price, quotas, provider dependence.  
**Risks:** API discontinuation and privacy transfer.  
**Possible Improvements:** replaceable adapters and more user-assisted flows.  
**Workarounds:** never bypass controls; disable unsupported source.  
**When we should reconsider:** a narrow scrape is counsel-approved, permitted, safety-reviewed, and uniquely valuable.

## Raw responses vs normalized findings

**Decision:** evidence retention  
**Recommended Approach:** normalized findings/evidence; raw payload ephemeral by default

**Pros:** minimizes breach, storage, licensing, malicious-content surface.  
**Cons:** parser debugging and later reprocessing are harder.  
**Risks:** over-minimization weakens explainability.  
**Possible Improvements:** redacted structured provenance and content fingerprints.  
**Workarounds:** approved encrypted quarantine up to 24 hours (exception max 7 days).  
**When we should reconsider:** provider contract and dispute needs require a specific evidence class.

## Central adapters vs custom integration logic

**Decision:** provider coupling  
**Recommended Approach:** central capability contracts with independent adapters

**Pros:** replaceability, consistent policy/provenance/testing/cost gates.  
**Cons:** common abstraction can hide provider uniqueness.  
**Risks:** leaky “lowest common denominator.”  
**Possible Improvements:** typed provider-specific request/options inside a stable envelope.  
**Workarounds:** capability metadata and extension fields with strict ownership.  
**When we should reconsider:** never bypass core policy; extend the contract for a proven cross-cutting need.

## Redis queue vs database-backed queue

**Decision:** MVP job transport  
**Recommended Approach:** PostgreSQL leases/outbox

**Pros:** one dependency, transactional enqueue, adequate low volume.  
**Cons:** polling/locking load and fewer queue features.  
**Risks:** database contention and homegrown semantics.  
**Possible Improvements:** use a proven library and observability.  
**Workarounds:** bounded polling, indexes, SKIP LOCKED/leases, archive completed jobs.  
**When we should reconsider:** measured latency/throughput/DB load or advanced routing/delay needs.

## Managed vs self-hosted auth

**Decision:** account security  
**Recommended Approach:** managed standards-based auth after privacy/portability review

**Pros:** hardened flows, MFA/passkeys, less credential code.  
**Cons:** processor, pricing, lock-in, deletion coordination.  
**Risks:** auth metadata privacy and service outage.  
**Possible Improvements:** isolate auth subject mapping and export/delete runbooks.  
**Workarounds:** short sessions, local authorization remains authoritative.  
**When we should reconsider:** scale economics, regional requirements, or provider controls fail review.

## Multi-provider vs single search

**Decision:** coverage breadth  
**Recommended Approach:** one approved search source at most in MVP; mocks first

**Pros:** predictable cost, simpler matching and coverage explanation.  
**Cons:** blind spots and provider bias/outage.  
**Risks:** provider becomes perceived truth.  
**Possible Improvements:** provider-neutral data model and manual links.  
**Workarounds:** show coverage and never claim comprehensiveness.  
**When we should reconsider:** false-negative value justifies measured incremental source cost/privacy.

## Universal score vs category risk

**Decision:** risk communication  
**Recommended Approach:** category-based risk and coverage; no composite MVP score

**Pros:** explainable, actionable, less fear and false precision.  
**Cons:** harder to summarize or track marketing-friendly progress.  
**Risks:** categories still imply judgment.  
**Possible Improvements:** show drivers, trends, model version, uncertainty.  
**Workarounds:** optional experimental exposure index later.  
**When we should reconsider:** validated user research and calibrated outcome data exist.

## Automatic vs user-confirmed matching

**Decision:** identity attribution  
**Recommended Approach:** system proposes; user confirms/rejects

**Pros:** safer, explainable, yields suppression feedback.  
**Cons:** review work and slower automation.  
**Risks:** confirmation bias and confusing evidence.  
**Possible Improvements:** concise signals/counter-signals and confidence labels.  
**Workarounds:** only exact verified control earns `VERIFIED`; no auto-adverse action.  
**When we should reconsider:** narrow signal combinations are empirically calibrated with very low harm.

## Automated vs assisted broker removal

**Decision:** remediation execution  
**Recommended Approach:** instructions and status tracking; user submits

**Pros:** honest authority, fewer ToS/captcha/identity risks.  
**Cons:** friction and lower completion.  
**Risks:** stale instructions and user over-disclosure.  
**Possible Improvements:** reviewed templates and minimal-data warnings.  
**Workarounds:** partner deep links; separate submitted from verified removed.  
**When we should reconsider:** authorized partner API or counsel-approved agency workflow with clear consent exists.

## Monorepo vs simple repository

**Decision:** repository layout  
**Recommended Approach:** simple modular `src/` repository

**Pros:** fewer tools/config layers and faster solo iteration.  
**Cons:** future extraction costs.  
**Risks:** imports become tangled.  
**Possible Improvements:** dependency rules and public module contracts.  
**Workarounds:** migrate to `apps/web`, `apps/worker`, and `packages/*` when real deploy boundaries appear.  
**When we should reconsider:** second independently deployed app/client or separate package releases.
