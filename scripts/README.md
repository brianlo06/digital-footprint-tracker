# Scripts

The SQL files provision local-only restricted runtime, rate-limit owner, retention, and key-rotation roles after migrations. They are idempotent, contain intentionally local passwords, and must not be used as hosted IAM configuration.

`build-cloudflare.sh` is a deployment-safety wrapper: it isolates `.env.local` while OpenNext builds, restores it on every normal/signal exit, and rejects a bundle containing any compiled project environment values. It performs no external call itself.

The separately deployable retention schedule lives in `workers/retention.ts`, not this directory. No provider-call script or general operational CLI is implemented. Future scripts must default to local/synthetic data, avoid external calls unless explicitly enabled, and document destructive behavior. Current quality and migration commands are declared in `package.json`.
