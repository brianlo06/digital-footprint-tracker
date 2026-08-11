# Risk Register

Likelihood/impact are current qualitative estimates: Low, Medium, High, Critical impact.

| Risk                                | Likelihood    | Impact   | Detection                              | Mitigation                                                 | Fallback                                                   |
| ----------------------------------- | ------------- | -------- | -------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| API provider shuts down             | high          | high     | lifecycle/health review                | adapter boundary, no provider IDs in core identity         | disable source, preserve findings/provenance, manual input |
| Provider raises price               | high          | high     | unit-cost ledger/billing alerts        | hard budget, one provider, cache/adaptive scan             | reduce frequency/coverage or switch adapter                |
| Provider blocks searches            | high          | high     | 403/429/coverage metrics               | intended-use contract, rate control, identifiable client   | mark unavailable; no evasive scraping                      |
| Inaccurate identity matching        | high          | critical | confirm/reject and calibration metrics | explainable signals, conservative bands, user confirmation | lower confidence/disable auto-discovery                    |
| False-positive exposure harms user  | high          | high     | support/rejection spikes               | no auto-adverse action, counter-signals, suppression       | retract finding, notify, parser/model rollback             |
| User privacy breach                 | medium        | critical | anomaly/audit/DLP/canaries             | minimize, field encrypt, least privilege, retention        | suspend processing, incident/notice, rotate/delete         |
| Scraper maintenance burden          | high          | high     | parser failures/page diffs             | no scraping MVP; API/manual default                        | disable provider                                           |
| Regulatory issue                    | medium        | critical | counsel/DPIA/change monitoring         | jurisdiction gates, minimization, rights/deletion          | geoblock/disable/delete affected processing                |
| API quota exhaustion                | high          | high     | budget and 429 alerts                  | reservation, caps, pagination/retry limits                 | partial scan and cooldown                                  |
| Unexpected cloud cost               | medium        | high     | cost anomaly/daily cap                 | small architecture, environment caps, kill switches        | shut providers/workers, dashboard-only mode                |
| Account takeover                    | high          | critical | auth/session anomalies                 | managed auth, MFA/passkeys, reauth, rate limits            | revoke sessions, lock account, recovery review             |
| User abuse/surveillance             | high          | critical | entity/velocity/audit review           | verification gates, no people search/bulk API/export       | suspend capability/account, appeal                         |
| Broker page structure changes       | high          | medium   | contract fixtures/presence errors      | adapter/parser version, manual workflow                    | mark indeterminate, disable adapter                        |
| Search terms change                 | high          | high     | scheduled ToS review                   | contract inventory and provider kill switch                | stop queries; manual user-submitted results                |
| Breach provider changes access      | medium        | high     | provider notice/auth errors            | adapter, metadata-only core, verified inputs               | disable breach monitoring; guidance only                   |
| Provider poisoning                  | medium        | high     | anomaly/rejection/URL signals          | schema bounds, provenance, user confirmation               | quarantine/disable parser/provider                         |
| Deletion leaves orphan data         | medium        | critical | deletion reconciliation/canary         | manifest, idempotent workflow, tombstones, backup plan     | manual purge and incident assessment                       |
| Logs leak PII                       | medium        | critical | synthetic canary/sink scan             | allowlisted logger, no bodies/URLs, short retention        | purge sink, rotate affected secrets, incident review       |
| Database queue contention           | low initially | medium   | locks/latency/queue depth              | indexes, leases, bounded polling/retention                 | move jobs to managed queue/Redis                           |
| Managed auth lock-in/outage         | medium        | high     | auth availability/cost metrics         | standards, isolated subject mapping, export plan           | migration/recovery mode                                    |
| Verification bypass/stale ownership | medium        | critical | suspicious use/revalidation failures   | expiry, reauth, scoped challenges, periodic proof          | revoke identifier and dependent schedules                  |
| Remediation claim is misleading     | medium        | high     | discrepancy/support reports            | state model separates submitted/success/verified           | correct status/copy and rescan                             |
| Third-party processor breach        | medium        | critical | vendor notices/assurance review        | minimize transfers, DPA, encryption, vendor access         | terminate vendor, rotate/delete/notify                     |
| Low adoption due to setup friction  | high          | high     | funnel/user research                   | narrow guided setup, clear value, manual path              | reduce MVP inputs/provider scope                           |

Review monthly during implementation and at every provider, jurisdiction, or data-class change. Each active risk needs an owner before production.
