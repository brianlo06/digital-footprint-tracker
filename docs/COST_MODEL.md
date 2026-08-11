# Conceptual Cost Model

**Status:** Planning assumptions only; no exact price is asserted. Provider quotes and hosting prices are volatile.

## Assumption units

A “user” means one active identity. A scan may include one verified email and a few usernames. MVP scans are user-triggered; scheduled monitoring is excluded. Search-provider calls and broker/removal partners are expected to dominate variable cost, not page rendering.

| Category                | Driver                                           | Control                                                           |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| Hosting                 | requests, compute duration, worker uptime/egress | one app, bounded jobs, sleep/non-prod limits                      |
| PostgreSQL              | storage, connections, I/O, backups               | one database, pooling, observation rollup/retention               |
| Search APIs             | query/page/provider fan-out                      | hard budgets, one provider, caching if terms allow, result limits |
| Breach provider         | subscription/lookup tier                         | verified email only, manual scans, dedupe, plan cap               |
| Broker provider/partner | lookup/removal per user                          | assisted workflow first; feature flag and explicit pricing        |
| Auth                    | monthly active users, MFA/phone                  | email/passkey first; avoid SMS dependence                         |
| Email/SMS/push          | message count and deliverability tooling         | dashboard-only MVP, digest/generic content later                  |
| Queue                   | operations, Redis/managed minimum                | PostgreSQL-backed queue initially                                 |
| Monitoring              | event volume/retention/cardinality               | sampling, no PII/high-cardinality labels, short logs              |
| Object storage          | raw payload/evidence/egress                      | normalized findings, 0–24h quarantine, lifecycle deletion         |
| Encryption/KMS          | key/API operations                               | envelope keys and scoped batch decrypt                            |

## Scale bands

| Stage        | Workload assumption                                           | Likely shape                                                                  | Dominant risk                                          |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Prototype    | developer + synthetic fixtures, providers disabled            | local PostgreSQL and mocks; near-zero paid need                               | accidentally enabling real keys/providers              |
| 100 users    | tens of scans/day, one provider                               | small managed app/DB; modest variable API use                                 | poor query templates or retries                        |
| 1,000 users  | hundreds of scans/day, uneven bursts                          | worker/concurrency tuning, metering, larger DB history                        | search/breach subscription tiers and support           |
| 10,000 users | thousands of scans/day; schedules only if separately launched | dedicated worker/queue evaluation, negotiated providers, regional/privacy ops | provider/API costs, broker partners, monitoring volume |

This is not a forecast. Build a spreadsheet from selected provider units before integration: active users × scans/user/period × identifiers/scan × queries/identifier × pages/query × provider unit cost, plus failure/retry reserve.

## Budget model

```text
UserScanBudget: period, hard_limit_units, reserved_units, spent_units
ProviderCost: provider, capability, unit, unit_cost, currency, effective_at
PlanEstimate: provider runs, units, expected/min/max cost
UsageLedger: reservation, actual, reconciliation, provider_run_id
```

Controls: disabled-by-default real providers; explicit staging/production keys; daily and monthly provider hard caps; per-user scan cooldown; one-page default; reservation before dispatch; no unbounded pagination/fallback; retry budget; cache only if permitted; anomaly alert at 50/75/90%; kill at 100%; provider billing alerts; finance reconciliation; no unlimited admin bypass.

## Cost-related product decisions

Show scan frequency and coverage honestly. Prefer adaptive/user-triggered rescans rather than weekly everything. Recheck high-risk confirmed findings more often than rejected/stable low-risk ones. A partial scan must not automatically rerun every provider. Premium provider breadth should never weaken verification or privacy safeguards.
