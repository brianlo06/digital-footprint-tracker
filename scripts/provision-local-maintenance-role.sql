-- Local development and test databases only.
-- Run as a superuser/database administrator after migrations. Hosted
-- environments must reproduce these capabilities through managed IAM.

DO $provision$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_retention_owner'
  ) THEN
    CREATE ROLE digital_footprint_retention_owner
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_maintenance'
  ) THEN
    CREATE ROLE digital_footprint_maintenance
      LOGIN
      PASSWORD 'local_maintenance_only'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END
$provision$;

ALTER ROLE digital_footprint_retention_owner
  WITH NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

ALTER ROLE digital_footprint_maintenance
  WITH LOGIN
  PASSWORD 'local_maintenance_only'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

DO $grant_connect$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO digital_footprint_maintenance',
    current_database()
  );
END
$grant_connect$;

GRANT USAGE ON SCHEMA public
TO digital_footprint_retention_owner, digital_footprint_maintenance;

GRANT SELECT, UPDATE ON TABLE public.identifier_verifications
TO digital_footprint_retention_owner;
GRANT SELECT ON TABLE public.identifiers, public.identities, public.users
TO digital_footprint_retention_owner;
-- UPDATE is required for SELECT ... FOR UPDATE SKIP LOCKED even though the
-- function only deletes from these two tables.
GRANT SELECT, UPDATE, DELETE ON TABLE public.deletion_receipts, public.audit_events
TO digital_footprint_retention_owner;
GRANT SELECT, UPDATE, DELETE ON TABLE public.rate_limit_windows
TO digital_footprint_retention_owner;

REVOKE ALL PRIVILEGES ON TABLE
  public.users,
  public.identities,
  public.identifiers,
  public.identifier_verifications,
  public.consent_records,
  public.audit_events,
  public.deletion_receipts
FROM digital_footprint_maintenance;

GRANT CREATE ON SCHEMA public TO digital_footprint_retention_owner;
ALTER FUNCTION public.run_retention_maintenance(timestamptz, integer, timestamptz)
OWNER TO digital_footprint_retention_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_retention_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_maintenance;

REVOKE ALL ON FUNCTION public.run_retention_maintenance(timestamptz, integer, timestamptz)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_retention_maintenance(timestamptz, integer, timestamptz)
TO digital_footprint_maintenance;
