-- Local development and test databases only.
-- Run as a superuser/database administrator after migrations. Hosted
-- environments must reproduce these capabilities through managed IAM.

DO $provision$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_rotation_owner'
  ) THEN
    CREATE ROLE digital_footprint_rotation_owner
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_rotation'
  ) THEN
    CREATE ROLE digital_footprint_rotation
      LOGIN
      PASSWORD 'local_rotation_only'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END
$provision$;

ALTER ROLE digital_footprint_rotation_owner
  WITH NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

ALTER ROLE digital_footprint_rotation
  WITH LOGIN
  PASSWORD 'local_rotation_only'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

DO $grant_connect$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO digital_footprint_rotation',
    current_database()
  );
END
$grant_connect$;

GRANT USAGE ON SCHEMA public
TO digital_footprint_rotation_owner, digital_footprint_rotation;

GRANT SELECT, UPDATE ON TABLE public.identifiers
TO digital_footprint_rotation_owner;
-- Read-only dependencies of identifiers_tenant_isolation. PostgreSQL checks
-- their ACLs even when the fixed-role capability policy authorizes a row.
GRANT SELECT ON TABLE public.identities, public.users
TO digital_footprint_rotation_owner;

REVOKE ALL PRIVILEGES ON TABLE public.identifiers, public.identities, public.users
FROM digital_footprint_rotation;

GRANT CREATE ON SCHEMA public TO digital_footprint_rotation_owner;
ALTER FUNCTION public.list_identifier_envelopes_for_rewrap(text, integer)
OWNER TO digital_footprint_rotation_owner;
ALTER FUNCTION public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text)
OWNER TO digital_footprint_rotation_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_rotation_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_rotation;

REVOKE ALL ON FUNCTION public.list_identifier_envelopes_for_rewrap(text, integer)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_identifier_envelopes_for_rewrap(text, integer)
TO digital_footprint_rotation;
GRANT EXECUTE ON FUNCTION public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text)
TO digital_footprint_rotation;
