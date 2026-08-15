# Provider architecture

Phase 2 begins with a local-only synthetic breach provider. It implements the accepted `provider.contracts.ts` boundary using checked-in fictional fixtures and contains no network client, credential, or live-provider response. The environment accepts either a fully disabled provider configuration or an explicitly enabled local synthetic configuration; hosted synthetic execution and live API keys fail validation.

The invocation boundary separately evaluates tenant ownership, active state, recent verification, and purpose-specific consent. Its persistence-neutral usage-ledger contract reserves request and cost capacity before dispatch, while the current in-memory implementation defaults every limit to zero and is explicitly unsuitable for hosted or distributed execution. No route currently exposes this service.

Adapters emit normalized candidates with provenance; they do not persist findings, notify users, or decide remediation success.
