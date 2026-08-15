-- Local development and test databases only.
-- Run as the database owner after migrations. Hosted environments must create
-- an equivalent restricted role through their secret/IAM provisioning path.

DO $provision$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_runtime') THEN
    CREATE ROLE digital_footprint_runtime
      LOGIN
      PASSWORD 'local_runtime_only'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END
$provision$;

ALTER ROLE digital_footprint_runtime
  WITH LOGIN
  PASSWORD 'local_runtime_only'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

DO $grant_connect$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO digital_footprint_runtime',
    current_database()
  );
END
$grant_connect$;

GRANT USAGE ON SCHEMA public TO digital_footprint_runtime;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_runtime;

GRANT USAGE ON TYPE
  account_state,
  identity_state,
  identifier_type,
  verification_status,
  sensitivity,
  consent_state,
  deletion_state,
  rate_limit_scope_kind,
  rate_limit_action,
  provider_usage_state
TO digital_footprint_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users,
  identities,
  identifiers,
  identifier_lookup_tokens,
  identifier_verifications,
  consent_records,
  audit_events,
  deletion_receipts
TO digital_footprint_runtime;

-- Deliberately asymmetric to the full-CRUD grant above: the runtime
-- transaction that enqueues a delivery only ever inserts a row, never reads,
-- updates, or deletes one - the outbox worker under its own role owns every
-- subsequent state transition. See ADR 0017.
GRANT USAGE ON TYPE delivery_channel, delivery_state TO digital_footprint_runtime;
GRANT INSERT ON TABLE verification_delivery_outbox TO digital_footprint_runtime;
