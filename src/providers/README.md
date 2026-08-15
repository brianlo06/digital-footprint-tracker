# Provider architecture

Phase 2 begins with a local-only synthetic breach provider. It implements the accepted `provider.contracts.ts` boundary using checked-in fictional fixtures and contains no network client, credential, or live-provider response. The environment accepts either a fully disabled provider configuration or an explicitly enabled local synthetic configuration; hosted synthetic execution and live API keys fail validation.

The invocation boundary separately evaluates tenant ownership, active state, recent verification, and purpose-specific consent. Its persistence-neutral usage-ledger contract reserves request and cost capacity before dispatch. The in-memory implementation remains local-only; the PostgreSQL implementation uses a non-login capability owner and atomic security-definer functions for cross-tenant provider caps without exposing ledger rows to the runtime role. Every omitted limit defaults to zero. No route currently exposes this service.

Adapters emit normalized candidates with provenance; they do not persist findings, notify users, or decide remediation success.
