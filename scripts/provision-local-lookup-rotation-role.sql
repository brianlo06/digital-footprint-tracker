-- Local development and test databases only.
-- Run as a superuser/database administrator after migrations. Hosted
-- environments must reproduce these capabilities through managed IAM.
-- Deliberately separate from the envelope-rewrap rotation role pair so KEK
-- rewrap and lookup-key rotation cannot be triggered by the same credential.

DO $provision$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_lookup_rotation_owner'
  ) THEN
    CREATE ROLE digital_footprint_lookup_rotation_owner
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_lookup_rotation'
  ) THEN
    CREATE ROLE digital_footprint_lookup_rotation
      LOGIN
      PASSWORD 'local_lookup_rotation_only'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END
$provision$;

ALTER ROLE digital_footprint_lookup_rotation_owner
  WITH NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

ALTER ROLE digital_footprint_lookup_rotation
  WITH LOGIN
  PASSWORD 'local_lookup_rotation_only'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

DO $grant_connect$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO digital_footprint_lookup_rotation',
    current_database()
  );
END
$grant_connect$;

GRANT USAGE ON SCHEMA public
TO digital_footprint_lookup_rotation_owner, digital_footprint_lookup_rotation;

GRANT USAGE ON TYPE public.identifier_type
TO digital_footprint_lookup_rotation_owner;

-- Read-only on identifiers: this worker never mutates the parent row.
GRANT SELECT ON TABLE public.identifiers
TO digital_footprint_lookup_rotation_owner;
GRANT SELECT ON TABLE public.identities, public.users
TO digital_footprint_lookup_rotation_owner;

-- Insert-only on the child table: rows are never updated or deleted here.
GRANT SELECT, INSERT ON TABLE public.identifier_lookup_tokens
TO digital_footprint_lookup_rotation_owner;

REVOKE ALL PRIVILEGES ON TABLE
  public.identifiers,
  public.identifier_lookup_tokens,
  public.identities,
  public.users
FROM digital_footprint_lookup_rotation;

GRANT CREATE ON SCHEMA public TO digital_footprint_lookup_rotation_owner;
ALTER FUNCTION public.backfill_identifier_lookup_tokens(text, integer)
OWNER TO digital_footprint_lookup_rotation_owner;
ALTER FUNCTION public.list_identifiers_missing_lookup_token(text, integer)
OWNER TO digital_footprint_lookup_rotation_owner;
ALTER FUNCTION public.insert_identifier_lookup_token_for_rotation(
  uuid, uuid, public.identifier_type, text, text, text, text, jsonb, text
)
OWNER TO digital_footprint_lookup_rotation_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_lookup_rotation_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_lookup_rotation;

REVOKE ALL ON FUNCTION public.backfill_identifier_lookup_tokens(text, integer)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_identifiers_missing_lookup_token(text, integer)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_identifier_lookup_token_for_rotation(
  uuid, uuid, public.identifier_type, text, text, text, text, jsonb, text
)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_identifier_lookup_tokens(text, integer)
TO digital_footprint_lookup_rotation;
GRANT EXECUTE ON FUNCTION public.list_identifiers_missing_lookup_token(text, integer)
TO digital_footprint_lookup_rotation;
GRANT EXECUTE ON FUNCTION public.insert_identifier_lookup_token_for_rotation(
  uuid, uuid, public.identifier_type, text, text, text, text, jsonb, text
)
TO digital_footprint_lookup_rotation;
