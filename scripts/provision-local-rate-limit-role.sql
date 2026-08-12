-- Local development and test databases only.
-- Run as a superuser/database administrator after migrations and after the
-- restricted runtime role has been provisioned.

DO $provision$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_rate_limit_owner'
  ) THEN
    CREATE ROLE digital_footprint_rate_limit_owner
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      BYPASSRLS;
  END IF;
END
$provision$;

ALTER ROLE digital_footprint_rate_limit_owner
  WITH NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  BYPASSRLS;

GRANT USAGE ON SCHEMA public TO digital_footprint_rate_limit_owner;
GRANT USAGE ON TYPE public.rate_limit_scope_kind, public.rate_limit_action
TO digital_footprint_rate_limit_owner, digital_footprint_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rate_limit_windows
TO digital_footprint_rate_limit_owner;

REVOKE ALL PRIVILEGES ON TABLE public.rate_limit_windows
FROM digital_footprint_runtime;

GRANT CREATE ON SCHEMA public TO digital_footprint_rate_limit_owner;
ALTER FUNCTION public.consume_action_rate_limit(text, text, public.rate_limit_action)
OWNER TO digital_footprint_rate_limit_owner;
ALTER FUNCTION public.consume_action_rate_limit_dual(text, text, text, text, public.rate_limit_action)
OWNER TO digital_footprint_rate_limit_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_rate_limit_owner;

REVOKE ALL ON FUNCTION public.consume_action_rate_limit(text, text, public.rate_limit_action)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_action_rate_limit(text, text, public.rate_limit_action)
TO digital_footprint_runtime;
REVOKE ALL ON FUNCTION public.consume_action_rate_limit_dual(
  text, text, text, text, public.rate_limit_action
)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_action_rate_limit_dual(
  text, text, text, text, public.rate_limit_action
)
TO digital_footprint_runtime;
