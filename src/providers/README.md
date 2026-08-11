# Provider architecture placeholder

No provider implementation, credentials, network call, crawler, parser, or mock exists in Phase 1. `provider.contracts.ts` remains a proposed interface only. Future adapters must pass verification, consent, jurisdiction, budget, health, retention, and feature-flag gates before invocation.

Adapters emit normalized candidates with provenance; they do not persist findings, notify users, or decide remediation success.
