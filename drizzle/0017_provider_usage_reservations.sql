CREATE TYPE "public"."provider_usage_state" AS ENUM('RESERVED', 'COMPLETED', 'FAILED', 'RELEASED');--> statement-breakpoint
CREATE TABLE "provider_usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"estimated_cost_units" integer NOT NULL,
	"actual_cost_units" integer,
	"state" "provider_usage_state" DEFAULT 'RESERVED' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminal_at" timestamp with time zone,
	CONSTRAINT "provider_usage_costs_nonnegative" CHECK ("provider_usage_reservations"."estimated_cost_units" >= 0 AND ("provider_usage_reservations"."actual_cost_units" IS NULL OR "provider_usage_reservations"."actual_cost_units" BETWEEN 0 AND "provider_usage_reservations"."estimated_cost_units")),
	CONSTRAINT "provider_usage_terminal_invariant" CHECK (("provider_usage_reservations"."state" = 'RESERVED' AND "provider_usage_reservations"."actual_cost_units" IS NULL AND "provider_usage_reservations"."terminal_at" IS NULL)
        OR ("provider_usage_reservations"."state" IN ('COMPLETED', 'FAILED') AND "provider_usage_reservations"."actual_cost_units" IS NOT NULL AND "provider_usage_reservations"."terminal_at" IS NOT NULL)
        OR ("provider_usage_reservations"."state" = 'RELEASED' AND "provider_usage_reservations"."actual_cost_units" IS NULL AND "provider_usage_reservations"."terminal_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "provider_usage_reservations" ADD CONSTRAINT "provider_usage_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_usage_user_provider_idempotency_unique" ON "provider_usage_reservations" USING btree ("user_id","provider_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "provider_usage_provider_time_idx" ON "provider_usage_reservations" USING btree ("provider_id","reserved_at");--> statement-breakpoint
CREATE INDEX "provider_usage_user_time_idx" ON "provider_usage_reservations" USING btree ("user_id","reserved_at");--> statement-breakpoint
ALTER TABLE "provider_usage_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_usage_reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "provider_usage_reservations_tenant_isolation" ON "provider_usage_reservations" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "provider_usage_reservations_capability" ON "provider_usage_reservations" AS PERMISSIVE FOR ALL TO public USING (current_user = 'digital_footprint_provider_usage_owner') WITH CHECK (current_user = 'digital_footprint_provider_usage_owner');--> statement-breakpoint
CREATE POLICY "users_provider_usage_capability" ON "users" AS PERMISSIVE FOR ALL TO public USING (current_user = 'digital_footprint_provider_usage_owner') WITH CHECK (current_user = 'digital_footprint_provider_usage_owner');--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.reserve_provider_usage(
  requested_user_id uuid,
  requested_provider_id text,
  requested_idempotency_key text,
  requested_fingerprint text,
  requested_estimated_cost_units integer,
  max_user_daily_requests integer,
  max_provider_daily_requests integer,
  max_provider_monthly_requests integer,
  max_provider_daily_cost_units integer,
  max_provider_monthly_cost_units integer
)
RETURNS TABLE (
  result_status text,
  denial_reason text,
  reservation_id uuid,
  reservation_user_id uuid,
  reservation_provider_id text,
  reservation_idempotency_key text,
  reservation_request_fingerprint text,
  reservation_estimated_cost_units integer,
  reservation_actual_cost_units integer,
  reservation_state public.provider_usage_state,
  reservation_reserved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $reserve_provider_usage$
DECLARE
  invocation_now timestamptz := clock_timestamp();
  day_start timestamptz;
  month_start timestamptz;
  tenant_auth_subject text := nullif(current_setting('app.auth_subject', true), '');
  existing_reservation public.provider_usage_reservations%ROWTYPE;
  user_daily_requests bigint;
  provider_daily_requests bigint;
  provider_monthly_requests bigint;
  provider_daily_cost bigint;
  provider_monthly_cost bigint;
BEGIN
  IF requested_user_id IS NULL
    OR requested_provider_id IS NULL
    OR char_length(requested_provider_id) NOT BETWEEN 1 AND 64
    OR requested_provider_id !~ '^[a-z0-9][a-z0-9-]*$'
    OR requested_idempotency_key IS NULL
    OR char_length(requested_idempotency_key) NOT BETWEEN 16 AND 128
    OR requested_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    OR requested_fingerprint IS NULL
    OR char_length(requested_fingerprint) NOT BETWEEN 16 AND 512
    OR requested_fingerprint !~ '^[A-Za-z0-9][A-Za-z0-9:_-]*$'
    OR requested_estimated_cost_units IS NULL
    OR requested_estimated_cost_units < 0
    OR max_user_daily_requests IS NULL OR max_user_daily_requests < 0
    OR max_provider_daily_requests IS NULL OR max_provider_daily_requests < 0
    OR max_provider_monthly_requests IS NULL OR max_provider_monthly_requests < 0
    OR max_provider_daily_cost_units IS NULL OR max_provider_daily_cost_units < 0
    OR max_provider_monthly_cost_units IS NULL OR max_provider_monthly_cost_units < 0 THEN
    RAISE EXCEPTION 'provider usage reservation input is invalid' USING ERRCODE = '22023';
  END IF;

  IF tenant_auth_subject IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users AS account
    WHERE account.id = requested_user_id
      AND account.auth_subject = tenant_auth_subject
  ) THEN
    RAISE EXCEPTION 'provider usage tenant is unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('provider-usage:' || requested_provider_id, 0)
  );

  SELECT usage.* INTO existing_reservation
  FROM public.provider_usage_reservations AS usage
  WHERE usage.user_id = requested_user_id
    AND usage.provider_id = requested_provider_id
    AND usage.idempotency_key = requested_idempotency_key;

  IF FOUND THEN
    IF existing_reservation.request_fingerprint <> requested_fingerprint
      OR existing_reservation.estimated_cost_units <> requested_estimated_cost_units THEN
      result_status := 'DENIED';
      denial_reason := 'IDEMPOTENCY_CONFLICT';
      RETURN NEXT;
      RETURN;
    END IF;

    result_status := 'EXISTING';
    reservation_id := existing_reservation.id;
    reservation_user_id := existing_reservation.user_id;
    reservation_provider_id := existing_reservation.provider_id;
    reservation_idempotency_key := existing_reservation.idempotency_key;
    reservation_request_fingerprint := existing_reservation.request_fingerprint;
    reservation_estimated_cost_units := existing_reservation.estimated_cost_units;
    reservation_actual_cost_units := existing_reservation.actual_cost_units;
    reservation_state := existing_reservation.state;
    reservation_reserved_at := existing_reservation.reserved_at;
    RETURN NEXT;
    RETURN;
  END IF;

  day_start := pg_catalog.date_trunc('day', invocation_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  month_start := pg_catalog.date_trunc('month', invocation_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  SELECT count(*) INTO user_daily_requests
  FROM public.provider_usage_reservations AS usage
  WHERE usage.user_id = requested_user_id
    AND usage.provider_id = requested_provider_id
    AND usage.state <> 'RELEASED'
    AND usage.reserved_at >= day_start;
  IF user_daily_requests + 1 > max_user_daily_requests THEN
    result_status := 'DENIED'; denial_reason := 'USER_DAILY_REQUEST_LIMIT'; RETURN NEXT; RETURN;
  END IF;

  SELECT count(*), coalesce(sum(usage.estimated_cost_units), 0)
  INTO provider_daily_requests, provider_daily_cost
  FROM public.provider_usage_reservations AS usage
  WHERE usage.provider_id = requested_provider_id
    AND usage.state <> 'RELEASED'
    AND usage.reserved_at >= day_start;
  IF provider_daily_requests + 1 > max_provider_daily_requests THEN
    result_status := 'DENIED'; denial_reason := 'PROVIDER_DAILY_REQUEST_LIMIT'; RETURN NEXT; RETURN;
  END IF;

  SELECT count(*), coalesce(sum(usage.estimated_cost_units), 0)
  INTO provider_monthly_requests, provider_monthly_cost
  FROM public.provider_usage_reservations AS usage
  WHERE usage.provider_id = requested_provider_id
    AND usage.state <> 'RELEASED'
    AND usage.reserved_at >= month_start;
  IF provider_monthly_requests + 1 > max_provider_monthly_requests THEN
    result_status := 'DENIED'; denial_reason := 'PROVIDER_MONTHLY_REQUEST_LIMIT'; RETURN NEXT; RETURN;
  END IF;
  IF provider_daily_cost + requested_estimated_cost_units > max_provider_daily_cost_units THEN
    result_status := 'DENIED'; denial_reason := 'PROVIDER_DAILY_COST_LIMIT'; RETURN NEXT; RETURN;
  END IF;
  IF provider_monthly_cost + requested_estimated_cost_units > max_provider_monthly_cost_units THEN
    result_status := 'DENIED'; denial_reason := 'PROVIDER_MONTHLY_COST_LIMIT'; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.provider_usage_reservations (
    user_id, provider_id, idempotency_key, request_fingerprint,
    estimated_cost_units, state, reserved_at
  ) VALUES (
    requested_user_id, requested_provider_id, requested_idempotency_key,
    requested_fingerprint, requested_estimated_cost_units, 'RESERVED', invocation_now
  )
  RETURNING * INTO existing_reservation;

  result_status := 'RESERVED';
  reservation_id := existing_reservation.id;
  reservation_user_id := existing_reservation.user_id;
  reservation_provider_id := existing_reservation.provider_id;
  reservation_idempotency_key := existing_reservation.idempotency_key;
  reservation_request_fingerprint := existing_reservation.request_fingerprint;
  reservation_estimated_cost_units := existing_reservation.estimated_cost_units;
  reservation_actual_cost_units := existing_reservation.actual_cost_units;
  reservation_state := existing_reservation.state;
  reservation_reserved_at := existing_reservation.reserved_at;
  RETURN NEXT;
END
$reserve_provider_usage$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.complete_provider_usage(
  requested_reservation_id uuid,
  requested_outcome public.provider_usage_state,
  requested_actual_cost_units integer
)
RETURNS TABLE (
  reservation_id uuid,
  reservation_user_id uuid,
  reservation_provider_id text,
  reservation_idempotency_key text,
  reservation_request_fingerprint text,
  reservation_estimated_cost_units integer,
  reservation_actual_cost_units integer,
  reservation_state public.provider_usage_state,
  reservation_reserved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $complete_provider_usage$
DECLARE
  tenant_auth_subject text := nullif(current_setting('app.auth_subject', true), '');
  existing_reservation public.provider_usage_reservations%ROWTYPE;
BEGIN
  IF requested_reservation_id IS NULL
    OR requested_outcome IS NULL
    OR requested_outcome NOT IN ('COMPLETED', 'FAILED')
    OR requested_actual_cost_units IS NULL
    OR requested_actual_cost_units < 0 THEN
    RAISE EXCEPTION 'provider usage completion input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT usage.* INTO existing_reservation
  FROM public.provider_usage_reservations AS usage
  WHERE usage.id = requested_reservation_id
  FOR UPDATE;
  IF NOT FOUND OR tenant_auth_subject IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users AS account
    WHERE account.id = existing_reservation.user_id
      AND account.auth_subject = tenant_auth_subject
  ) THEN
    RAISE EXCEPTION 'provider usage reservation is unavailable' USING ERRCODE = '42501';
  END IF;
  IF requested_actual_cost_units > existing_reservation.estimated_cost_units THEN
    RAISE EXCEPTION 'provider usage actual cost exceeds reservation' USING ERRCODE = '22023';
  END IF;
  IF existing_reservation.state = 'RELEASED' THEN
    RAISE EXCEPTION 'provider usage reservation was released' USING ERRCODE = '22023';
  END IF;
  IF existing_reservation.state <> 'RESERVED' THEN
    IF existing_reservation.state <> requested_outcome
      OR existing_reservation.actual_cost_units <> requested_actual_cost_units THEN
      RAISE EXCEPTION 'provider usage completion conflicts' USING ERRCODE = '22023';
    END IF;
  ELSE
    UPDATE public.provider_usage_reservations AS usage
    SET state = requested_outcome,
      actual_cost_units = requested_actual_cost_units,
      terminal_at = clock_timestamp()
    WHERE usage.id = requested_reservation_id
    RETURNING usage.* INTO existing_reservation;
  END IF;

  reservation_id := existing_reservation.id;
  reservation_user_id := existing_reservation.user_id;
  reservation_provider_id := existing_reservation.provider_id;
  reservation_idempotency_key := existing_reservation.idempotency_key;
  reservation_request_fingerprint := existing_reservation.request_fingerprint;
  reservation_estimated_cost_units := existing_reservation.estimated_cost_units;
  reservation_actual_cost_units := existing_reservation.actual_cost_units;
  reservation_state := existing_reservation.state;
  reservation_reserved_at := existing_reservation.reserved_at;
  RETURN NEXT;
END
$complete_provider_usage$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.release_provider_usage(requested_reservation_id uuid)
RETURNS TABLE (
  reservation_id uuid,
  reservation_user_id uuid,
  reservation_provider_id text,
  reservation_idempotency_key text,
  reservation_request_fingerprint text,
  reservation_estimated_cost_units integer,
  reservation_actual_cost_units integer,
  reservation_state public.provider_usage_state,
  reservation_reserved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $release_provider_usage$
DECLARE
  tenant_auth_subject text := nullif(current_setting('app.auth_subject', true), '');
  existing_reservation public.provider_usage_reservations%ROWTYPE;
BEGIN
  IF requested_reservation_id IS NULL THEN
    RAISE EXCEPTION 'provider usage release input is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT usage.* INTO existing_reservation
  FROM public.provider_usage_reservations AS usage
  WHERE usage.id = requested_reservation_id
  FOR UPDATE;
  IF NOT FOUND OR tenant_auth_subject IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users AS account
    WHERE account.id = existing_reservation.user_id
      AND account.auth_subject = tenant_auth_subject
  ) THEN
    RAISE EXCEPTION 'provider usage reservation is unavailable' USING ERRCODE = '42501';
  END IF;
  IF existing_reservation.state = 'RELEASED' THEN
    NULL;
  ELSIF existing_reservation.state <> 'RESERVED' THEN
    RAISE EXCEPTION 'provider usage reservation already completed' USING ERRCODE = '22023';
  ELSE
    UPDATE public.provider_usage_reservations AS usage
    SET state = 'RELEASED', terminal_at = clock_timestamp()
    WHERE usage.id = requested_reservation_id
    RETURNING usage.* INTO existing_reservation;
  END IF;

  reservation_id := existing_reservation.id;
  reservation_user_id := existing_reservation.user_id;
  reservation_provider_id := existing_reservation.provider_id;
  reservation_idempotency_key := existing_reservation.idempotency_key;
  reservation_request_fingerprint := existing_reservation.request_fingerprint;
  reservation_estimated_cost_units := existing_reservation.estimated_cost_units;
  reservation_actual_cost_units := existing_reservation.actual_cost_units;
  reservation_state := existing_reservation.state;
  reservation_reserved_at := existing_reservation.reserved_at;
  RETURN NEXT;
END
$release_provider_usage$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.reserve_provider_usage(uuid,text,text,text,integer,integer,integer,integer,integer,integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complete_provider_usage(uuid,public.provider_usage_state,integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.release_provider_usage(uuid) FROM PUBLIC;
