CREATE TYPE "public"."provider_run_state" AS ENUM('RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."scan_state" AS ENUM('QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."scan_trigger" AS ENUM('USER');--> statement-breakpoint
ALTER TYPE "public"."rate_limit_action" ADD VALUE 'BREACH_SCAN';--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"trigger" "scan_trigger" DEFAULT 'USER' NOT NULL,
	"state" "scan_state" NOT NULL,
	"requested_capability" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "scans_terminal_invariant" CHECK (("scans"."state" IN ('QUEUED', 'RUNNING') AND "scans"."completed_at" IS NULL)
        OR ("scans"."state" IN ('PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED')
          AND "scans"."completed_at" IS NOT NULL AND "scans"."completed_at" >= "scans"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "provider_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"capability" text NOT NULL,
	"reservation_id" uuid,
	"state" "provider_run_state" NOT NULL,
	"health_outcome" text,
	"result_count" integer,
	"error_safe_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "provider_runs_provider_id_format" CHECK ("provider_runs"."provider_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "provider_runs_error_safe_code_format" CHECK ("provider_runs"."error_safe_code" IS NULL OR "provider_runs"."error_safe_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
	CONSTRAINT "provider_runs_terminal_invariant" CHECK (("provider_runs"."state" = 'RUNNING' AND "provider_runs"."health_outcome" IS NULL
          AND "provider_runs"."result_count" IS NULL AND "provider_runs"."error_safe_code" IS NULL AND "provider_runs"."finished_at" IS NULL)
        OR ("provider_runs"."state" = 'COMPLETED' AND "provider_runs"."finished_at" IS NOT NULL
          AND "provider_runs"."result_count" IS NOT NULL AND "provider_runs"."error_safe_code" IS NULL)
        OR ("provider_runs"."state" = 'FAILED' AND "provider_runs"."finished_at" IS NOT NULL
          AND "provider_runs"."error_safe_code" IS NOT NULL AND "provider_runs"."result_count" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "breach_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"provider_breach_id" text NOT NULL,
	"breach_name" text NOT NULL,
	"breach_date" date NOT NULL,
	"provider_added_at" timestamp with time zone NOT NULL,
	"provider_modified_at" timestamp with time zone NOT NULL,
	"data_categories" text[] NOT NULL,
	"is_verified" boolean NOT NULL,
	"is_sensitive" boolean NOT NULL,
	"is_retired" boolean NOT NULL,
	"source_url" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"parser_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "breach_findings_breach_name_length" CHECK (char_length("breach_findings"."breach_name") BETWEEN 1 AND 200),
	CONSTRAINT "breach_findings_data_categories_nonempty" CHECK (array_length("breach_findings"."data_categories", 1) >= 1),
	CONSTRAINT "breach_findings_source_url_scheme" CHECK ("breach_findings"."source_url" ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_reservation_id_provider_usage_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."provider_usage_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_findings" ADD CONSTRAINT "breach_findings_provider_run_id_provider_runs_id_fk" FOREIGN KEY ("provider_run_id") REFERENCES "public"."provider_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_findings" ADD CONSTRAINT "breach_findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_findings" ADD CONSTRAINT "breach_findings_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scans_user_time_idx" ON "scans" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "provider_runs_scan_idx" ON "provider_runs" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "provider_runs_user_time_idx" ON "provider_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "breach_findings_provider_run_idx" ON "breach_findings" USING btree ("provider_run_id");--> statement-breakpoint
CREATE INDEX "breach_findings_user_time_idx" ON "breach_findings" USING btree ("user_id","checked_at");--> statement-breakpoint
ALTER TABLE "scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "breach_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "breach_findings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "scans_tenant_isolation" ON "scans" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "provider_runs_tenant_isolation" ON "provider_runs" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "breach_findings_tenant_isolation" ON "breach_findings" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.consume_action_rate_limit(
  user_scope_token text,
  network_scope_token text,
  requested_action public.rate_limit_action
)
RETURNS TABLE (
  allowed boolean,
  retry_after_seconds integer,
  limiting_scope public.rate_limit_scope_kind
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $rate_limit$
DECLARE
  rate_limit_now timestamptz := clock_timestamp();
  current_scope public.rate_limit_scope_kind;
  current_token text;
  max_attempts integer;
  window_duration interval;
  block_duration interval;
  effective_blocked_until timestamptz;
  current_retry integer;
BEGIN
  IF user_scope_token !~ '^[A-Za-z0-9_-]{43}$'
    OR network_scope_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'rate-limit scope tokens are invalid'
      USING ERRCODE = '22023';
  END IF;

  allowed := true;
  retry_after_seconds := 0;
  limiting_scope := NULL;

  FOR current_scope, current_token IN
    SELECT scope_kind, scope_token
    FROM (
      VALUES
        ('USER'::public.rate_limit_scope_kind, user_scope_token),
        ('NETWORK'::public.rate_limit_scope_kind, network_scope_token)
    ) AS scopes(scope_kind, scope_token)
  LOOP
    CASE requested_action
      WHEN 'ONBOARDING' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 5 ELSE 20 END;
        window_duration := interval '1 hour';
        block_duration := interval '1 hour';
      WHEN 'IDENTIFIER_ADD' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 10 ELSE 30 END;
        window_duration := interval '1 hour';
        block_duration := interval '1 hour';
      WHEN 'VERIFICATION_ATTEMPT' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 20 ELSE 60 END;
        window_duration := interval '15 minutes';
        block_duration := interval '30 minutes';
      WHEN 'ACCOUNT_DELETE' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 5 ELSE 20 END;
        window_duration := interval '1 hour';
        block_duration := interval '1 hour';
      WHEN 'BREACH_SCAN' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 5 ELSE 20 END;
        window_duration := interval '1 hour';
        block_duration := interval '1 hour';
    END CASE;

    INSERT INTO public.rate_limit_windows AS existing (
      scope_kind,
      scope_token,
      action,
      window_started_at,
      request_count,
      blocked_until,
      expires_at
    )
    VALUES (
      current_scope,
      current_token,
      requested_action,
      rate_limit_now,
      1,
      NULL,
      rate_limit_now + window_duration + block_duration + interval '1 day'
    )
    ON CONFLICT (scope_kind, scope_token, action) DO UPDATE
    SET
      window_started_at = CASE
        WHEN existing.blocked_until > rate_limit_now THEN existing.window_started_at
        WHEN existing.window_started_at + window_duration <= rate_limit_now THEN rate_limit_now
        ELSE existing.window_started_at
      END,
      request_count = CASE
        WHEN existing.blocked_until > rate_limit_now THEN existing.request_count
        WHEN existing.window_started_at + window_duration <= rate_limit_now THEN 1
        ELSE existing.request_count + 1
      END,
      blocked_until = CASE
        WHEN existing.blocked_until > rate_limit_now THEN existing.blocked_until
        WHEN existing.window_started_at + window_duration <= rate_limit_now THEN NULL
        WHEN existing.request_count >= max_attempts THEN rate_limit_now + block_duration
        ELSE NULL
      END,
      expires_at = rate_limit_now + window_duration + block_duration + interval '1 day'
    RETURNING existing.blocked_until INTO effective_blocked_until;

    IF effective_blocked_until > rate_limit_now THEN
      current_retry := greatest(
        1,
        ceil(extract(epoch FROM effective_blocked_until - rate_limit_now))::integer
      );
      IF allowed OR current_retry > retry_after_seconds THEN
        limiting_scope := current_scope;
        retry_after_seconds := current_retry;
      END IF;
      allowed := false;
    END IF;
  END LOOP;

  RETURN NEXT;
END
$rate_limit$;

REVOKE ALL ON FUNCTION public.consume_action_rate_limit(text, text, public.rate_limit_action)
FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.consume_action_rate_limit_dual(
  old_user_scope_token text,
  new_user_scope_token text,
  old_network_scope_token text,
  new_network_scope_token text,
  requested_action public.rate_limit_action
)
RETURNS TABLE (
  allowed boolean,
  retry_after_seconds integer,
  limiting_scope public.rate_limit_scope_kind
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $rate_limit_dual$
DECLARE
  rate_limit_now timestamptz := clock_timestamp();
  current_scope public.rate_limit_scope_kind;
  old_token text;
  new_token text;
  max_attempts integer;
  window_duration interval;
  block_duration interval;
  old_row record;
  new_row record;
  old_found boolean;
  new_found boolean;
  ensure_inserted integer;
  reconciled_window_started_at timestamptz;
  reconciled_request_count integer;
  reconciled_blocked_until timestamptz;
  final_window_started_at timestamptz;
  final_request_count integer;
  final_blocked_until timestamptz;
  final_expires_at timestamptz;
  current_retry integer;
BEGIN
  IF old_user_scope_token !~ '^[A-Za-z0-9_-]{43}$'
    OR new_user_scope_token !~ '^[A-Za-z0-9_-]{43}$'
    OR old_network_scope_token !~ '^[A-Za-z0-9_-]{43}$'
    OR new_network_scope_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'rate-limit scope tokens are invalid'
      USING ERRCODE = '22023';
  END IF;

  allowed := true;
  retry_after_seconds := 0;
  limiting_scope := NULL;

  FOR current_scope, old_token, new_token IN
    SELECT scope_kind, old_scope_token, new_scope_token
    FROM (
      VALUES
        ('USER'::public.rate_limit_scope_kind, old_user_scope_token, new_user_scope_token),
        ('NETWORK'::public.rate_limit_scope_kind, old_network_scope_token, new_network_scope_token)
    ) AS scopes(scope_kind, old_scope_token, new_scope_token)
  LOOP
    CASE requested_action
      WHEN 'ONBOARDING' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 5 ELSE 20 END;
        window_duration := interval '1 hour';
        block_duration := interval '1 hour';
      WHEN 'IDENTIFIER_ADD' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 10 ELSE 30 END;
        window_duration := interval '1 hour';
        block_duration := interval '1 hour';
      WHEN 'VERIFICATION_ATTEMPT' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 20 ELSE 60 END;
        window_duration := interval '15 minutes';
        block_duration := interval '30 minutes';
      WHEN 'ACCOUNT_DELETE' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 5 ELSE 20 END;
        window_duration := interval '1 hour';
        block_duration := interval '1 hour';
      WHEN 'BREACH_SCAN' THEN
        max_attempts := CASE WHEN current_scope = 'USER' THEN 5 ELSE 20 END;
        window_duration := interval '1 hour';
        block_duration := interval '1 hour';
    END CASE;

    -- A plain SELECT ... FOR UPDATE locks nothing when the row does not yet
    -- exist, so two concurrent first-ever calls could both observe "missing"
    -- and then both write a precomputed count, losing one request's count
    -- (the original single-key function avoids this because its lone
    -- INSERT ... ON CONFLICT DO UPDATE is itself the atomic operation). Ensure
    -- both rows exist first, tracking whether each insert actually happened
    -- (meaning the row was genuinely missing) versus was a no-op (meaning a
    -- real row already existed to reconcile from), then lock the
    -- now-guaranteed-existing rows in a fixed order to avoid deadlocking
    -- against a concurrent call for the same scope pair.
    INSERT INTO public.rate_limit_windows (
      scope_kind, scope_token, action, window_started_at, request_count, blocked_until, expires_at
    )
    VALUES (current_scope, old_token, requested_action, rate_limit_now, 0, NULL, rate_limit_now)
    ON CONFLICT (scope_kind, scope_token, action) DO NOTHING;
    GET DIAGNOSTICS ensure_inserted = ROW_COUNT;
    old_found := ensure_inserted = 0;

    INSERT INTO public.rate_limit_windows (
      scope_kind, scope_token, action, window_started_at, request_count, blocked_until, expires_at
    )
    VALUES (current_scope, new_token, requested_action, rate_limit_now, 0, NULL, rate_limit_now)
    ON CONFLICT (scope_kind, scope_token, action) DO NOTHING;
    GET DIAGNOSTICS ensure_inserted = ROW_COUNT;
    new_found := ensure_inserted = 0;

    IF old_token <= new_token THEN
      SELECT window_started_at, request_count, blocked_until
        INTO old_row
        FROM public.rate_limit_windows
        WHERE scope_kind = current_scope AND scope_token = old_token AND action = requested_action
        FOR UPDATE;
      SELECT window_started_at, request_count, blocked_until
        INTO new_row
        FROM public.rate_limit_windows
        WHERE scope_kind = current_scope AND scope_token = new_token AND action = requested_action
        FOR UPDATE;
    ELSE
      SELECT window_started_at, request_count, blocked_until
        INTO new_row
        FROM public.rate_limit_windows
        WHERE scope_kind = current_scope AND scope_token = new_token AND action = requested_action
        FOR UPDATE;
      SELECT window_started_at, request_count, blocked_until
        INTO old_row
        FROM public.rate_limit_windows
        WHERE scope_kind = current_scope AND scope_token = old_token AND action = requested_action
        FOR UPDATE;
    END IF;

    -- Seed a missing version from its existing counterpart; if both exist and
    -- diverge, reconcile to the stricter (higher count, later block) state.
    IF NOT old_found AND NOT new_found THEN
      reconciled_window_started_at := rate_limit_now;
      reconciled_request_count := 0;
      reconciled_blocked_until := NULL;
    ELSIF NOT old_found THEN
      reconciled_window_started_at := new_row.window_started_at;
      reconciled_request_count := new_row.request_count;
      reconciled_blocked_until := new_row.blocked_until;
    ELSIF NOT new_found THEN
      reconciled_window_started_at := old_row.window_started_at;
      reconciled_request_count := old_row.request_count;
      reconciled_blocked_until := old_row.blocked_until;
    ELSE
      reconciled_window_started_at := least(old_row.window_started_at, new_row.window_started_at);
      reconciled_request_count := greatest(old_row.request_count, new_row.request_count);
      reconciled_blocked_until := greatest(
        coalesce(old_row.blocked_until, '-infinity'::timestamptz),
        coalesce(new_row.blocked_until, '-infinity'::timestamptz)
      );
      IF reconciled_blocked_until = '-infinity'::timestamptz THEN
        reconciled_blocked_until := NULL;
      END IF;
    END IF;

    -- Apply the same single-consumption decision as consume_action_rate_limit,
    -- exactly once, then persist the identical resulting state under both keys.
    IF reconciled_blocked_until IS NOT NULL AND reconciled_blocked_until > rate_limit_now THEN
      final_window_started_at := reconciled_window_started_at;
      final_request_count := reconciled_request_count;
      final_blocked_until := reconciled_blocked_until;
    ELSIF reconciled_window_started_at + window_duration <= rate_limit_now THEN
      final_window_started_at := rate_limit_now;
      final_request_count := 1;
      final_blocked_until := NULL;
    ELSE
      final_window_started_at := reconciled_window_started_at;
      final_request_count := reconciled_request_count + 1;
      final_blocked_until := CASE
        WHEN reconciled_request_count >= max_attempts THEN rate_limit_now + block_duration
        ELSE NULL
      END;
    END IF;

    final_expires_at := rate_limit_now + window_duration + block_duration + interval '1 day';

    -- Both rows are already locked above, so a plain UPDATE (not another
    -- upsert) is enough and cannot race a concurrent caller.
    UPDATE public.rate_limit_windows
    SET
      window_started_at = final_window_started_at,
      request_count = final_request_count,
      blocked_until = final_blocked_until,
      expires_at = final_expires_at
    WHERE scope_kind = current_scope AND scope_token = old_token AND action = requested_action;

    UPDATE public.rate_limit_windows
    SET
      window_started_at = final_window_started_at,
      request_count = final_request_count,
      blocked_until = final_blocked_until,
      expires_at = final_expires_at
    WHERE scope_kind = current_scope AND scope_token = new_token AND action = requested_action;

    IF final_blocked_until IS NOT NULL AND final_blocked_until > rate_limit_now THEN
      current_retry := greatest(
        1,
        ceil(extract(epoch FROM final_blocked_until - rate_limit_now))::integer
      );
      IF allowed OR current_retry > retry_after_seconds THEN
        limiting_scope := current_scope;
        retry_after_seconds := current_retry;
      END IF;
      allowed := false;
    END IF;
  END LOOP;

  RETURN NEXT;
END
$rate_limit_dual$;

REVOKE ALL ON FUNCTION public.consume_action_rate_limit_dual(
  text, text, text, text, public.rate_limit_action
) FROM PUBLIC;
