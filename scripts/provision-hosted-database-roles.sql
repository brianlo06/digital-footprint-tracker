-- Hosted PostgreSQL role provisioning.
-- Run as the dedicated database owner after migrations. Passwords are read
-- from DFT_RUNTIME_DB_PASSWORD, DFT_MAINTENANCE_DB_PASSWORD, and
-- DFT_ROTATION_DB_PASSWORD; they are never printed or passed as psql variables.

\set ON_ERROR_STOP on
\getenv runtime_password DFT_RUNTIME_DB_PASSWORD
\getenv maintenance_password DFT_MAINTENANCE_DB_PASSWORD
\getenv rotation_password DFT_ROTATION_DB_PASSWORD

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

SELECT
  length(:'runtime_password') >= 32
  AND length(:'maintenance_password') >= 32
  AND length(:'rotation_password') >= 32
  AND :'runtime_password' <> :'maintenance_password'
  AND :'runtime_password' <> :'rotation_password'
  AND :'maintenance_password' <> :'rotation_password'
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
END
$provision$;

ALTER ROLE digital_footprint_runtime
  WITH LOGIN PASSWORD :'runtime_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE digital_footprint_rate_limit_owner
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
ALTER ROLE digital_footprint_retention_owner
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
ALTER ROLE digital_footprint_maintenance
  WITH LOGIN PASSWORD :'maintenance_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE digital_footprint_rotation_owner
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
ALTER ROLE digital_footprint_rotation
  WITH LOGIN PASSWORD :'rotation_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

-- The dedicated database owner remains the administrator of the non-login
-- capability owners. PostgreSQL 16+ requires this relationship to keep
-- ownership transfers and later idempotent repairs manageable without making
-- any application login a member of those roles.
GRANT digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner
TO CURRENT_USER WITH ADMIN OPTION;

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
      'digital_footprint_rotation_owner'
    )
      AND member.rolname IN (
        'digital_footprint_runtime',
        'digital_footprint_maintenance',
        'digital_footprint_rotation'
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
    'GRANT CONNECT ON DATABASE %I TO digital_footprint_runtime, digital_footprint_maintenance, digital_footprint_rotation',
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
  digital_footprint_rotation_owner;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
FROM digital_footprint_runtime,
  digital_footprint_maintenance,
  digital_footprint_rotation,
  digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner;
REVOKE CREATE ON SCHEMA public
FROM digital_footprint_runtime,
  digital_footprint_maintenance,
  digital_footprint_rotation,
  digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner;

GRANT USAGE ON SCHEMA public
TO digital_footprint_runtime,
  digital_footprint_maintenance,
  digital_footprint_rotation,
  digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner;

GRANT USAGE ON TYPE
  public.account_state,
  public.identity_state,
  public.identifier_type,
  public.verification_status,
  public.sensitivity,
  public.consent_state,
  public.deletion_state,
  public.rate_limit_scope_kind,
  public.rate_limit_action
TO digital_footprint_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.users,
  public.identities,
  public.identifiers,
  public.identifier_verifications,
  public.consent_records,
  public.audit_events,
  public.deletion_receipts
TO digital_footprint_runtime;

GRANT USAGE ON TYPE public.rate_limit_scope_kind, public.rate_limit_action
TO digital_footprint_rate_limit_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rate_limit_windows
TO digital_footprint_rate_limit_owner;

GRANT SELECT, UPDATE ON TABLE public.identifier_verifications
TO digital_footprint_retention_owner;
GRANT SELECT, UPDATE, DELETE ON TABLE
  public.deletion_receipts,
  public.audit_events,
  public.rate_limit_windows
TO digital_footprint_retention_owner;

GRANT SELECT, UPDATE ON TABLE public.identifiers
TO digital_footprint_rotation_owner;

GRANT CREATE ON SCHEMA public
TO digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner;
ALTER FUNCTION public.consume_action_rate_limit(text, text, public.rate_limit_action)
OWNER TO digital_footprint_rate_limit_owner;
ALTER FUNCTION public.run_retention_maintenance(timestamptz, integer, timestamptz)
OWNER TO digital_footprint_retention_owner;
ALTER FUNCTION public.list_identifier_envelopes_for_rewrap(text, integer)
OWNER TO digital_footprint_rotation_owner;
ALTER FUNCTION public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text)
OWNER TO digital_footprint_rotation_owner;
REVOKE CREATE ON SCHEMA public
FROM digital_footprint_rate_limit_owner,
  digital_footprint_retention_owner,
  digital_footprint_rotation_owner;

REVOKE ALL ON FUNCTION
  public.consume_action_rate_limit(text, text, public.rate_limit_action),
  public.run_retention_maintenance(timestamptz, integer, timestamptz),
  public.list_identifier_envelopes_for_rewrap(text, integer),
  public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text)
FROM PUBLIC,
  digital_footprint_runtime,
  digital_footprint_maintenance,
  digital_footprint_rotation;
GRANT EXECUTE ON FUNCTION public.consume_action_rate_limit(text, text, public.rate_limit_action)
TO digital_footprint_runtime;
GRANT EXECUTE ON FUNCTION public.run_retention_maintenance(timestamptz, integer, timestamptz)
TO digital_footprint_maintenance;
GRANT EXECUTE ON FUNCTION
  public.list_identifier_envelopes_for_rewrap(text, integer),
  public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text)
TO digital_footprint_rotation;

COMMIT;

\unset runtime_password
\unset maintenance_password
\unset rotation_password
\echo 'Hosted database roles provisioned; run npm run db:verify:boundaries next.'
