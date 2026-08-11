# Scripts

The SQL files provision local-only restricted runtime, rate-limit owner, retention, and key-rotation roles after migrations. They are idempotent, contain intentionally local passwords, and must not be used as hosted IAM configuration.

No standalone operational command, scheduler, or external-call script is implemented. Future scripts must default to local/synthetic data, avoid external calls unless explicitly enabled, and document destructive behavior. Current quality and migration commands are declared in `package.json`.
