# Notification placeholder

The MVP defaults to dashboard-only notifications. Email verification has a delivery-neutral gateway interface whose active implementation is a local fake that sends nothing. An encrypted transactional verification-delivery outbox and a route-less demonstration Worker now exist, but the Worker uses only a synthetic no-op provider and has no approved hosted deployment. No email, push, SMS, or real provider integration is active.

[ADR 0017](../../docs/adr/0017-verification-delivery-outbox.md) and the [delivery operations gate](../../docs/VERIFICATION_DELIVERY_OPERATIONS.md) define the remaining approval and activation evidence required before any real verification message can be sent.
