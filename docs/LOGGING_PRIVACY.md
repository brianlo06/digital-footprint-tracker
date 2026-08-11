# Privacy-Safe Logging and Observability

**Rule:** telemetry describes system work using opaque references; it never records the personal data being processed.

## Never log

Raw or normalized email, phone, name, alias, username, address, domain when tied to a person, query strings, profile/broker URLs containing PII, provider response bodies/snippets, verification codes/tokens, cookies, authorization headers, secrets, ciphertext, decryption errors with values, notification content, or user-entered notes.

Bad: `Scanning john@example.com at people-site.example/result/john-smith`  
Good: `provider_run_id=pr_... identifier_id=id_... provider=brave capability=web_search outcome=rate_limited`

## Structured event fields

Allowlisted fields: timestamp, severity, event name/version, environment, service/version, request/correlation/trace ID, opaque tenant/user/identifier/finding/job/run ID, provider stable ID, capability, outcome/error class, attempt, latency bucket, response-size bucket, result count, parser version, cost units, and redaction status.

Opaque IDs are still personal data when linkable. Restrict access and do not expose them to unnecessary third-party processors.

## Implementation requirements

- central structured logger with deny-by-default schema, not arbitrary object serialization;
- sanitize at creation before transport; collector-side redaction is defense in depth;
- avoid logging request bodies, full URLs, headers, database parameters, and ORM objects;
- errors use stable codes and scrubbed stacks; production debug logging is time-bound and approved;
- maintain canary PII tests that fail if known synthetic identifiers reach log/trace/metric sinks;
- prevent sensitive route parameters and attributes from entering traces;
- role-restricted access, audited queries, short retention, export deletion policy;
- incident process for telemetry PII leakage, including sink deletion and credential rotation.

## Metrics

Proposed metrics: `provider_request_count`, `provider_error_rate`, `provider_latency`, `scan_duration`, `scan_completion_count`, `findings_created`, `findings_resolved`, `false_positive_rate`, `provider_cost_units`, `queue_depth`, `job_retry_count`, `deletion_lag`, and `provider_health`.

Labels may include environment, service version, provider ID, capability, outcome, error class, and bounded latency/cost tier. Never label by user, identifier, finding, URL, search term, IP, or unbounded error text. Product aggregates use minimum cohort sizes where re-identification is possible.

## Audit events versus logs

Audit events are purposeful security/business records: verification complete, consent change, sensitive reveal, export, deletion request, operator access, provider enable/disable. They are append-only/tamper-evident, pseudonymous, longer-lived, and explicitly retained. Debug/application logs are short-lived and cannot substitute for an audit trail.

## Operational dashboards and alerts

Alert on provider error/rate-limit changes, cost burn, queue lag, scan partial rate, auth/recovery anomalies, deletion lag, decrypt failures, and telemetry redaction failures. Alerts contain IDs and runbooks, not identifier values or findings.
