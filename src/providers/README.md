# Provider architecture

Phase 2 begins with a local-only synthetic breach provider. It implements the accepted `provider.contracts.ts` boundary using checked-in fictional fixtures and contains no network client, credential, or live-provider response. The environment accepts either a fully disabled provider configuration or an explicitly enabled local synthetic configuration; hosted synthetic execution and live API keys fail validation.

Adapters emit normalized candidates with provenance; they do not persist findings, notify users, or decide remediation success.
