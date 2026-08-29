-- Hosted PostgreSQL role provisioning.
-- Run as the dedicated database owner after migrations. Passwords are read
-- from DFT_RUNTIME_DB_PASSWORD, DFT_MAINTENANCE_DB_PASSWORD,
-- DFT_ROTATION_DB_PASSWORD, DFT_LOOKUP_ROTATION_DB_PASSWORD, and
-- DFT_DELIVERY_DB_PASSWORD; they are never printed or passed as psql
-- variables.

\set ON_ERROR_STOP on
\getenv runtime_password DFT_RUNTIME_DB_PASSWORD
\getenv maintenance_password DFT_MAINTENANCE_DB_PASSWORD
\getenv rotation_password DFT_ROTATION_DB_PASSWORD
\getenv lookup_rotation_password DFT_LOOKUP_ROTATION_DB_PASSWORD
\getenv delivery_password DFT_DELIVERY_DB_PASSWORD

\if :{?runtime_password}
\else
  \echo 'DFT_RUNTIME_DB_PASSWORD is required'
  DO $$ BEGIN RAISE EXCEPTION 'required hosted database password is unavailable'; END $$;
\endif
\if :{?maintenance_password}
\else
  \echo 'DFT_MAINTENANCE_DB_PASSWORD is required'
  DO $$ BEGIN RAISE EXCEPTION 'required hosted database password is unavailable'; END $$;
\endif
\if :{?rotation_password}
\else
  \echo 'DFT_ROTATION_DB_PASSWORD is required'
  DO $$ BEGIN RAISE EXCEPTION 'required hosted database password is unavailable'; END $$;
\endif
\if :{?lookup_rotation_password}
\else
  \echo 'DFT_LOOKUP_ROTATION_DB_PASSWORD is required'
  DO $$ BEGIN RAISE EXCEPTION 'required hosted database password is unavailable'; END $$;
\endif
\if :{?delivery_password}
\else
  \echo 'DFT_DELIVERY_DB_PASSWORD is required'
  DO $$ BEGIN RAISE EXCEPTION 'required hosted database password is unavailable'; END $$;
\endif

SELECT
  length(:'runtime_password') >= 32
  AND length(:'maintenance_password') >= 32
  AND length(:'rotation_password') >= 32
  AND length(:'lookup_rotation_password') >= 32
  AND length(:'delivery_password') >= 32
  AND :'runtime_password' <> :'maintenance_password'
  AND :'runtime_password' <> :'rotation_password'
  AND :'runtime_password' <> :'lookup_rotation_password'
  AND :'runtime_password' <> :'delivery_password'
  AND :'maintenance_password' <> :'rotation_password'
  AND :'maintenance_password' <> :'lookup_rotation_password'
  AND :'maintenance_password' <> :'delivery_password'
  AND :'rotation_password' <> :'lookup_rotation_password'
  AND :'rotation_password' <> :'delivery_password'
  AND :'lookup_rotation_password' <> :'delivery_password'
  AS hosted_passwords_valid
\gset

\if :hosted_passwords_valid
\else
  \echo 'Hosted database passwords must be distinct and at least 32 characters'
  DO $$ BEGIN RAISE EXCEPTION 'hosted database password policy failed'; END $$;
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $provision$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_runtime') THEN
    CREATE ROLE digital_footprint_runtime LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_rate_limit_owner') THEN
    CREATE ROLE digital_footprint_rate_limit_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_retention_owner') THEN
    CREATE ROLE digital_footprint_retention_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_maintenance') THEN
    CREATE ROLE digital_footprint_maintenance LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_rotation_owner') THEN
    CREATE ROLE digital_footprint_rotation_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_rotation') THEN
    CREATE ROLE digital_footprint_rotation LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_lookup_rotation_owner') THEN
    CREATE ROLE digital_footprint_lookup_rotation_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_lookup_rotation') THEN
    CREATE ROLE digital_footprint_lookup_rotation LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_delivery_owner') THEN
    CREATE ROLE digital_footprint_delivery_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_delivery') THEN
    CREATE ROLE digital_footprint_delivery LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'digital_footprint_provider_usage_owner') THEN
    CREATE ROLE digital_footprint_provider_usage_owner NOLOGIN;
  END IF;
END
$provision$;

ALTER ROLE digital_footprint_runtime
  WITH LOGIN PASSWORD :'runtime_password' NOINHERIT;
ALTER ROLE digital_footprint_rate_limit_owner
  WITH NOLOGIN NOINHERIT;
ALTER ROLE digital_footprint_retention_owner
  WITH NOLOGIN NOINHERIT;
ALTER ROLE digital_footprint_maintenance
  WITH LOGIN PASSWORD :'maintenance_password' NOINHERIT;
ALTER ROLE digital_footprint_rotation_owner
  WITH NOLOGIN NOINHERIT;
ALTER ROLE digital_footprint_rotation
  WITH LOGIN PASSWORD :'rotation_password' NOINHERIT;
ALTER ROLE digital_footprint_lookup_rotation_owner
  WITH NOLOGIN NOINHERIT;
ALTER ROLE digital_footprint_lookup_rotation
  WITH LOGIN PASSWORD :'lookup_rotation_password' NOINHERIT;
ALTER ROLE digital_footprint_delivery_owner
  WITH NOLOGIN NOINHERIT;
ALTER ROLE digital_footprint_delivery
  WITH LOGIN PASSWORD :'delivery_password' NOINHERIT;
ALTER ROLE digital_footprint_provider_usage_owner
  WITH NOLOGIN NOINHERIT;

-- Managed PostgreSQL commonly reserves SUPERUSER and BYPASSRLS attribute
-- changes for the provider's true superuser. New roles receive safe defaults;
-- existing roles are checked fail-closed rather than attempting a privileged
-- attribute repair that the dedicated database owner may not be allowed to
-- perform.
DO $validate_role_flags$
DECLARE
  audited_role text;
  expected_login boolean;
  actual record;
BEGIN
  FOR audited_role, expected_login IN
    SELECT *
    FROM (VALUES
      ('digital_footprint_runtime', true),
      ('digital_footprint_rate_limit_owner', false),
      ('digital_footprint_retention_owner', false),
      ('digital_footprint_maintenance', true),
      ('digital_footprint_rotation_owner', false),
      ('digital_footprint_rotation', true),
      ('digital_footprint_lookup_rotation_owner', false),
      ('digital_footprint_lookup_rotation', true),
      ('digital_footprint_delivery_owner', false),
      ('digital_footprint_delivery', true),
      ('digital_footprint_provider_usage_owner', false)
    ) AS expected(role_name, can_login)
  LOOP
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
    INTO STRICT actual
    FROM pg_catalog.pg_roles
    WHERE rolname = audited_role;

    IF actual.rolcanlogin <> expected_login
      OR actual.rolsuper
      OR actual.rolcreatedb
      OR actual.rolcreaterole
      OR actual.rolinherit
      OR actual.rolbypassrls THEN
      RAISE EXCEPTION 'role % has unsafe or unexpected attributes', audited_role;
    END IF;
  END LOOP;
END
$validate_role_flags$;

-- The dedicated database owner can SET ROLE to the non-login capability
-- owners. PostgreSQL 16+ requires this membership for ownership transfers;
-- the role creator already holds the authority needed to manage roles, and
-- managed PostgreSQL rejects granting ADMIN OPTION back to that same grantor.
GRANT digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner,
  digital_footprint_lookup_rotation_owner,
  digital_footprint_delivery_owner,
  digital_footprint_provider_usage_owner
TO CURRENT_USER;

DO $remove_memberships$
DECLARE
  membership record;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
    FROM pg_catalog.pg_auth_members AS relation
    INNER JOIN pg_catalog.pg_roles AS granted ON granted.oid = relation.roleid
    INNER JOIN pg_catalog.pg_roles AS member ON member.oid = relation.member
    WHERE granted.rolname IN (
      'digital_footprint_rate_limit_owner',
      'digital_footprint_retention_owner',
      'digital_footprint_rotation_owner',
      'digital_footprint_lookup_rotation_owner',
      'digital_footprint_delivery_owner',
      'digital_footprint_provider_usage_owner'
    )
      AND member.rolname IN (
        'digital_footprint_runtime',
        'digital_footprint_maintenance',
        'digital_footprint_rotation',
        'digital_footprint_lookup_rotation',
        'digital_footprint_delivery'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE %I FROM %I',
      membership.granted_role,
      membership.member_role
    );
  END LOOP;
END
$remove_memberships$;

DO $database_connect$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO digital_footprint_runtime, digital_footprint_maintenance, digital_footprint_rotation, digital_footprint_lookup_rotation, digital_footprint_delivery',
    pg_catalog.current_database()
  );
END
$database_connect$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
FROM digital_footprint_runtime,
  digital_footprint_maintenance,
  digital_footprint_rotation,
  digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner,
  digital_footprint_lookup_rotation_owner,
  digital_footprint_lookup_rotation,
  digital_footprint_delivery_owner,
  digital_footprint_delivery,
  digital_footprint_provider_usage_owner;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
FROM digital_footprint_runtime,
  digital_footprint_maintenance,
  digital_footprint_rotation,
  digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner,
  digital_footprint_lookup_rotation_owner,
  digital_footprint_lookup_rotation,
  digital_footprint_delivery_owner,
  digital_footprint_delivery,
  digital_footprint_provider_usage_owner;
REVOKE CREATE ON SCHEMA public
FROM digital_footprint_runtime,
  digital_footprint_maintenance,
  digital_footprint_rotation,
  digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner,
  digital_footprint_lookup_rotation_owner,
  digital_footprint_lookup_rotation,
  digital_footprint_delivery_owner,
  digital_footprint_delivery,
  digital_footprint_provider_usage_owner;

GRANT USAGE ON SCHEMA public
TO digital_footprint_runtime,
  digital_footprint_maintenance,
  digital_footprint_rotation,
  digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner,
  digital_footprint_lookup_rotation_owner,
  digital_footprint_lookup_rotation,
  digital_footprint_delivery_owner,
  digital_footprint_delivery,
  digital_footprint_provider_usage_owner;

GRANT USAGE ON TYPE
  public.account_state,
  public.identity_state,
  public.identifier_type,
  public.verification_status,
  public.sensitivity,
  public.consent_state,
  public.deletion_state,
  public.rate_limit_scope_kind,
  public.rate_limit_action,
  public.provider_usage_state,
  public.scan_state,
  public.scan_trigger,
  public.provider_run_state,
  public.scan_job_state,
  public.finding_type,
  public.finding_presence_state,
  public.finding_status,
  public.observation_presence
TO digital_footprint_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.users,
  public.identities,
  public.identifiers,
  public.identifier_lookup_tokens,
  public.identifier_verifications,
  public.consent_records,
  public.audit_events,
  public.deletion_receipts,
  public.scans,
  public.scan_jobs,
  public.provider_runs,
  public.breach_findings,
  public.findings,
  public.observations
TO digital_footprint_runtime;

-- Deliberately asymmetric to the full-CRUD grant above: the runtime
-- transaction that enqueues a delivery only ever inserts a row, never reads,
-- updates, or deletes one - the outbox worker under its own role owns every
-- subsequent state transition.
GRANT USAGE ON TYPE public.delivery_channel, public.delivery_state
TO digital_footprint_runtime;
GRANT INSERT ON TABLE public.verification_delivery_outbox
TO digital_footprint_runtime;

GRANT USAGE ON TYPE public.rate_limit_scope_kind, public.rate_limit_action
TO digital_footprint_rate_limit_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rate_limit_windows
TO digital_footprint_rate_limit_owner;

GRANT SELECT, UPDATE ON TABLE public.identifier_verifications
TO digital_footprint_retention_owner;
GRANT SELECT ON TABLE public.identifiers, public.identities, public.users
TO digital_footprint_retention_owner;
GRANT SELECT, UPDATE, DELETE ON TABLE
  public.deletion_receipts,
  public.audit_events,
  public.rate_limit_windows
TO digital_footprint_retention_owner;
-- UPDATE is required for SELECT ... FOR UPDATE SKIP LOCKED on terminal
-- scan-job rows even though the function only deletes them.
GRANT SELECT, UPDATE, DELETE ON TABLE public.scan_jobs
TO digital_footprint_retention_owner;

GRANT SELECT, UPDATE ON TABLE public.identifiers
TO digital_footprint_rotation_owner;
GRANT SELECT ON TABLE public.identities, public.users
TO digital_footprint_rotation_owner;

GRANT USAGE ON TYPE public.identifier_type
TO digital_footprint_lookup_rotation_owner;
-- Read-only on identifiers: the lookup-rotation worker never mutates the
-- parent row, only inserts into the child token table.
GRANT SELECT ON TABLE public.identifiers
TO digital_footprint_lookup_rotation_owner;
GRANT SELECT ON TABLE public.identities, public.users
TO digital_footprint_lookup_rotation_owner;
GRANT SELECT, INSERT ON TABLE public.identifier_lookup_tokens
TO digital_footprint_lookup_rotation_owner;

GRANT USAGE ON TYPE public.delivery_channel, public.delivery_state
TO digital_footprint_delivery_owner;
GRANT SELECT, UPDATE ON TABLE public.verification_delivery_outbox
TO digital_footprint_delivery_owner;
-- Read-only: the claim eligibility check uses verifications/accounts, while
-- identifiers/identities are dependencies of the verification tenant policy.
GRANT SELECT ON TABLE
  public.identifier_verifications,
  public.identifiers,
  public.identities,
  public.users
TO digital_footprint_delivery_owner;

GRANT USAGE ON TYPE public.provider_usage_state, public.scan_job_state, public.scan_state
TO digital_footprint_provider_usage_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_usage_reservations
TO digital_footprint_provider_usage_owner;
GRANT SELECT ON TABLE public.users
TO digital_footprint_provider_usage_owner;
GRANT SELECT, UPDATE ON TABLE public.scan_jobs, public.scans
TO digital_footprint_provider_usage_owner;

GRANT CREATE ON SCHEMA public
TO digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner,
  digital_footprint_lookup_rotation_owner,
  digital_footprint_delivery_owner,
  digital_footprint_provider_usage_owner;
ALTER FUNCTION public.consume_action_rate_limit(text, text, public.rate_limit_action)
OWNER TO digital_footprint_rate_limit_owner;
ALTER FUNCTION public.consume_action_rate_limit_dual(
  text, text, text, text, public.rate_limit_action
)
OWNER TO digital_footprint_rate_limit_owner;
ALTER FUNCTION public.run_retention_maintenance(timestamptz, integer, timestamptz, timestamptz)
OWNER TO digital_footprint_retention_owner;
ALTER FUNCTION public.list_identifier_envelopes_for_rewrap(text, integer)
OWNER TO digital_footprint_rotation_owner;
ALTER FUNCTION public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text)
OWNER TO digital_footprint_rotation_owner;
ALTER FUNCTION public.backfill_identifier_lookup_tokens(text, integer)
OWNER TO digital_footprint_lookup_rotation_owner;
ALTER FUNCTION public.list_identifiers_missing_lookup_token(text, integer)
OWNER TO digital_footprint_lookup_rotation_owner;
ALTER FUNCTION public.insert_identifier_lookup_token_for_rotation(
  uuid, uuid, public.identifier_type, text, text, text, text, jsonb, text
)
OWNER TO digital_footprint_lookup_rotation_owner;
ALTER FUNCTION public.claim_verification_deliveries(timestamptz, integer, integer, text)
OWNER TO digital_footprint_delivery_owner;
ALTER FUNCTION public.complete_verification_delivery(timestamptz, uuid, text)
OWNER TO digital_footprint_delivery_owner;
ALTER FUNCTION public.report_verification_delivery_failure(
  timestamptz, uuid, text, text, integer
)
OWNER TO digital_footprint_delivery_owner;
ALTER FUNCTION public.reserve_provider_usage(
  uuid, text, text, text, integer, integer, integer, integer, integer, integer
) OWNER TO digital_footprint_provider_usage_owner;
ALTER FUNCTION public.complete_provider_usage(uuid, public.provider_usage_state, integer)
OWNER TO digital_footprint_provider_usage_owner;
ALTER FUNCTION public.release_provider_usage(uuid)
OWNER TO digital_footprint_provider_usage_owner;
ALTER FUNCTION public.claim_breach_scan_jobs(timestamptz, integer, integer, text, uuid)
OWNER TO digital_footprint_provider_usage_owner;
REVOKE CREATE ON SCHEMA public
FROM digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner,
  digital_footprint_lookup_rotation_owner,
  digital_footprint_delivery_owner,
  digital_footprint_provider_usage_owner;

REVOKE ALL ON FUNCTION
  public.consume_action_rate_limit(text, text, public.rate_limit_action),
  public.consume_action_rate_limit_dual(text, text, text, text, public.rate_limit_action),
  public.run_retention_maintenance(timestamptz, integer, timestamptz, timestamptz),
  public.list_identifier_envelopes_for_rewrap(text, integer),
  public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text),
  public.backfill_identifier_lookup_tokens(text, integer),
  public.list_identifiers_missing_lookup_token(text, integer),
  public.insert_identifier_lookup_token_for_rotation(
    uuid, uuid, public.identifier_type, text, text, text, text, jsonb, text
  ),
  public.claim_verification_deliveries(timestamptz, integer, integer, text),
  public.complete_verification_delivery(timestamptz, uuid, text),
  public.report_verification_delivery_failure(timestamptz, uuid, text, text, integer),
  public.reserve_provider_usage(
    uuid, text, text, text, integer, integer, integer, integer, integer, integer
  ),
  public.complete_provider_usage(uuid, public.provider_usage_state, integer),
  public.release_provider_usage(uuid),
  public.claim_breach_scan_jobs(timestamptz, integer, integer, text, uuid)
FROM PUBLIC,
  digital_footprint_runtime,
  digital_footprint_maintenance,
  digital_footprint_rotation,
  digital_footprint_lookup_rotation,
  digital_footprint_delivery;
GRANT EXECUTE ON FUNCTION public.consume_action_rate_limit(text, text, public.rate_limit_action)
TO digital_footprint_runtime;
GRANT EXECUTE ON FUNCTION public.consume_action_rate_limit_dual(
  text, text, text, text, public.rate_limit_action
)
TO digital_footprint_runtime;
GRANT EXECUTE ON FUNCTION public.run_retention_maintenance(timestamptz, integer, timestamptz, timestamptz)
TO digital_footprint_maintenance;
GRANT EXECUTE ON FUNCTION
  public.list_identifier_envelopes_for_rewrap(text, integer),
  public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text)
TO digital_footprint_rotation;
GRANT EXECUTE ON FUNCTION
  public.backfill_identifier_lookup_tokens(text, integer),
  public.list_identifiers_missing_lookup_token(text, integer),
  public.insert_identifier_lookup_token_for_rotation(
    uuid, uuid, public.identifier_type, text, text, text, text, jsonb, text
  )
TO digital_footprint_lookup_rotation;
GRANT EXECUTE ON FUNCTION
  public.claim_verification_deliveries(timestamptz, integer, integer, text),
  public.complete_verification_delivery(timestamptz, uuid, text),
  public.report_verification_delivery_failure(timestamptz, uuid, text, text, integer)
TO digital_footprint_delivery;
GRANT EXECUTE ON FUNCTION
  public.reserve_provider_usage(
    uuid, text, text, text, integer, integer, integer, integer, integer, integer
  ),
  public.complete_provider_usage(uuid, public.provider_usage_state, integer),
  public.release_provider_usage(uuid),
  public.claim_breach_scan_jobs(timestamptz, integer, integer, text, uuid)
TO digital_footprint_runtime;

COMMIT;

\unset runtime_password
\unset maintenance_password
\unset rotation_password
\unset lookup_rotation_password
\unset delivery_password
\echo 'Hosted database roles provisioned; run npm run db:verify:boundaries next.'
