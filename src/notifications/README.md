# Notification placeholder

The MVP defaults to dashboard-only notifications. Email verification has a delivery-neutral gateway interface, but its only implementation is a local fake that sends nothing. No email, push, SMS, provider integration, delivery worker, or outbox exists.

Proposed [ADR 0017](../../docs/adr/0017-verification-delivery-outbox.md) and the [delivery operations gate](../../docs/VERIFICATION_DELIVERY_OPERATIONS.md) define the atomic, encrypted, idempotent boundary required before any real verification message can be sent.
