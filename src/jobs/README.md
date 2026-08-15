# Job system boundary

The repository has two executable, separately deployable background tasks: the bounded retention Worker and the purpose-specific verification-delivery Worker. The delivery Worker uses an encrypted PostgreSQL outbox, ships behind a default-on kill switch, and still has only a synthetic no-op provider; its committed configuration is a route-less dry-build template with placeholder bindings, not a hosted deployment.

[ADR 0017](../../docs/adr/0017-verification-delivery-outbox.md) is accepted for local implementation and defines the delivery outbox's leases, retries, cancellation, least-privilege access, and deletion-race behavior. Provider selection, hosted activation, and the remaining activation evidence are still blocked. No general job dispatcher, provider worker, or general-purpose queue exists; general provider orchestration remains proposed in ADR 0005.
