-- Local development and test databases only.
-- Run as a superuser/database administrator after migrations and after the
-- restricted runtime role has been provisioned.

DO $provision$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_provider_usage_owner'
  ) THEN
    CREATE ROLE digital_footprint_provider_usage_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$provision$;

ALTER ROLE digital_footprint_provider_usage_owner
  WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO digital_footprint_provider_usage_owner;
GRANT USAGE ON TYPE public.provider_usage_state
TO digital_footprint_provider_usage_owner, digital_footprint_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_usage_reservations
TO digital_footprint_provider_usage_owner;
GRANT SELECT ON TABLE public.users TO digital_footprint_provider_usage_owner;
REVOKE ALL PRIVILEGES ON TABLE public.provider_usage_reservations
FROM digital_footprint_runtime;

GRANT CREATE ON SCHEMA public TO digital_footprint_provider_usage_owner;
ALTER FUNCTION public.reserve_provider_usage(
  uuid, text, text, text, integer, integer, integer, integer, integer, integer
) OWNER TO digital_footprint_provider_usage_owner;
ALTER FUNCTION public.complete_provider_usage(uuid, public.provider_usage_state, integer)
OWNER TO digital_footprint_provider_usage_owner;
ALTER FUNCTION public.release_provider_usage(uuid)
OWNER TO digital_footprint_provider_usage_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_provider_usage_owner;

REVOKE ALL ON FUNCTION public.reserve_provider_usage(
  uuid, text, text, text, integer, integer, integer, integer, integer, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_provider_usage(
  uuid, public.provider_usage_state, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_provider_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_provider_usage(
  uuid, text, text, text, integer, integer, integer, integer, integer, integer
) TO digital_footprint_runtime;
GRANT EXECUTE ON FUNCTION public.complete_provider_usage(
  uuid, public.provider_usage_state, integer
) TO digital_footprint_runtime;
GRANT EXECUTE ON FUNCTION public.release_provider_usage(uuid)
TO digital_footprint_runtime;
