-- Local development and test databases only.
-- Run as a superuser/database administrator after migrations. Hosted
-- environments must reproduce these capabilities through managed IAM.
-- Deliberately separate from every other purpose-specific role pair so the
-- verification delivery outbox cannot be driven by another credential.

DO $provision$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_delivery_owner'
  ) THEN
    CREATE ROLE digital_footprint_delivery_owner
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      BYPASSRLS;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'digital_footprint_delivery'
  ) THEN
    CREATE ROLE digital_footprint_delivery
      LOGIN
      PASSWORD 'local_delivery_only'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END
$provision$;

ALTER ROLE digital_footprint_delivery_owner
  WITH NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  BYPASSRLS;

ALTER ROLE digital_footprint_delivery
  WITH LOGIN
  PASSWORD 'local_delivery_only'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS;

DO $grant_connect$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO digital_footprint_delivery',
    current_database()
  );
END
$grant_connect$;

GRANT USAGE ON SCHEMA public
TO digital_footprint_delivery_owner, digital_footprint_delivery;

GRANT USAGE ON TYPE public.delivery_channel, public.delivery_state
TO digital_footprint_delivery_owner;

-- Read/write on the outbox itself: the claim function moves rows between
-- states and destroys payloads on completion/dead-letter/cancellation.
GRANT SELECT, UPDATE ON TABLE public.verification_delivery_outbox
TO digital_footprint_delivery_owner;

-- Read-only on the two tables the claim function's eligibility check joins
-- against: this worker never mutates a verification or an account.
GRANT SELECT ON TABLE public.identifier_verifications, public.users
TO digital_footprint_delivery_owner;

REVOKE ALL PRIVILEGES ON TABLE
  public.verification_delivery_outbox,
  public.identifier_verifications,
  public.users
FROM digital_footprint_delivery;

GRANT CREATE ON SCHEMA public TO digital_footprint_delivery_owner;
ALTER FUNCTION public.claim_verification_deliveries(timestamptz, integer, integer, text)
OWNER TO digital_footprint_delivery_owner;
ALTER FUNCTION public.complete_verification_delivery(timestamptz, uuid, text)
OWNER TO digital_footprint_delivery_owner;
ALTER FUNCTION public.report_verification_delivery_failure(
  timestamptz, uuid, text, text, integer
)
OWNER TO digital_footprint_delivery_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_delivery_owner;
REVOKE CREATE ON SCHEMA public FROM digital_footprint_delivery;

REVOKE ALL ON FUNCTION public.claim_verification_deliveries(timestamptz, integer, integer, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_verification_delivery(timestamptz, uuid, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_verification_delivery_failure(
  timestamptz, uuid, text, text, integer
)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_verification_deliveries(timestamptz, integer, integer, text)
TO digital_footprint_delivery;
GRANT EXECUTE ON FUNCTION public.complete_verification_delivery(timestamptz, uuid, text)
TO digital_footprint_delivery;
GRANT EXECUTE ON FUNCTION public.report_verification_delivery_failure(
  timestamptz, uuid, text, text, integer
)
TO digital_footprint_delivery;
