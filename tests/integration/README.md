# Integration tests

These tests use an explicitly supplied disposable local PostgreSQL database and synthetic `.test` identifiers. They cover account/identifier lifecycle, concurrent onboarding, purpose-specific consent grant/withdrawal, cross-account denial, verification lockout, destructive-action reauthentication, deletion failure/retry quarantine, bounded retention maintenance, restart-safe envelope key rewrap/rollback, and durable provider authorization/usage reservations with cross-tenant atomic caps.

Production data, production authentication tenants, and provider credentials are prohibited. Run with owner/setup, restricted web-runtime, function-only maintenance, and function-only rotation test database URLs; see the root test documentation and `docs/RLS_OPERATIONS.md`.
