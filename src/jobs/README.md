# Job system boundary

The only executable background task is the separately deployable, bounded retention Worker. No general job dispatcher, delivery worker, provider worker, or queue exists.

Proposed [ADR 0017](../../docs/adr/0017-verification-delivery-outbox.md) defines a purpose-specific encrypted PostgreSQL outbox for future verification delivery, including leases, retries, cancellation, least-privilege access, and deletion races. It is not approved or implemented. General provider orchestration remains proposed in ADR 0005.
