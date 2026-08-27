CREATE TYPE "public"."scan_job_state" AS ENUM('PENDING', 'CLAIMED', 'COMPLETED', 'DEAD_LETTERED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "scan_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"identifier_id" uuid NOT NULL,
	"consent_record_id" uuid NOT NULL,
	"state" "scan_job_state" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_safe_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_jobs_attempt_range" CHECK ("scan_jobs"."attempt_count" BETWEEN 0 AND "scan_jobs"."max_attempts"),
	CONSTRAINT "scan_jobs_max_attempts_range" CHECK ("scan_jobs"."max_attempts" BETWEEN 1 AND 10),
	CONSTRAINT "scan_jobs_error_safe_code_format" CHECK ("scan_jobs"."last_error_safe_code" IS NULL OR "scan_jobs"."last_error_safe_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
	CONSTRAINT "scan_jobs_lease_invariant" CHECK (("scan_jobs"."state" = 'CLAIMED' AND "scan_jobs"."lease_token" IS NOT NULL AND "scan_jobs"."lease_expires_at" IS NOT NULL)
        OR ("scan_jobs"."state" <> 'CLAIMED' AND "scan_jobs"."lease_token" IS NULL AND "scan_jobs"."lease_expires_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "scan_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "one_running_scan_per_user_capability";--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_identifier_id_identifiers_id_fk" FOREIGN KEY ("identifier_id") REFERENCES "public"."identifiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_consent_record_id_consent_records_id_fk" FOREIGN KEY ("consent_record_id") REFERENCES "public"."consent_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_jobs_scan_unique" ON "scan_jobs" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "scan_jobs_claim_idx" ON "scan_jobs" USING btree ("state","not_before");--> statement-breakpoint
CREATE INDEX "scan_jobs_lease_idx" ON "scan_jobs" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_scan_per_user_capability" ON "scans" USING btree ("user_id","requested_capability") WHERE "scans"."state" IN ('QUEUED', 'RUNNING');--> statement-breakpoint
CREATE POLICY "scans_scan_job_capability" ON "scans" AS PERMISSIVE FOR ALL TO public USING (current_user = 'digital_footprint_provider_usage_owner') WITH CHECK (current_user = 'digital_footprint_provider_usage_owner');--> statement-breakpoint
CREATE POLICY "users_scan_job_capability" ON "users" AS PERMISSIVE FOR SELECT TO public USING (current_user = 'digital_footprint_provider_usage_owner');--> statement-breakpoint
CREATE POLICY "scan_jobs_tenant_isolation" ON "scan_jobs" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "scan_jobs_scan_job_capability" ON "scan_jobs" AS PERMISSIVE FOR ALL TO public USING (current_user = 'digital_footprint_provider_usage_owner') WITH CHECK (current_user = 'digital_footprint_provider_usage_owner');--> statement-breakpoint
ALTER TABLE "scan_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.claim_breach_scan_jobs(
  claim_now timestamptz,
  claim_batch_size integer,
  claim_lease_seconds integer,
  claim_lease_token text,
  requested_scan_id uuid DEFAULT NULL
)
RETURNS TABLE (
  job_id uuid,
  scan_id uuid,
  user_id uuid,
  identity_id uuid,
  identifier_id uuid,
  consent_record_id uuid,
  auth_subject text,
  attempt_count integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $scan_jobs$
DECLARE
  exhausted_count integer;
BEGIN
  IF claim_now IS NULL THEN
    RAISE EXCEPTION 'scan-job claim time is required' USING ERRCODE = '22023';
  END IF;
  IF claim_batch_size IS NULL OR claim_batch_size < 1 OR claim_batch_size > 50 THEN
    RAISE EXCEPTION 'scan-job batch size must be between 1 and 50' USING ERRCODE = '22023';
  END IF;
  IF claim_lease_seconds IS NULL OR claim_lease_seconds < 30 OR claim_lease_seconds > 900 THEN
    RAISE EXCEPTION 'scan-job lease duration must be between 30 and 900 seconds' USING ERRCODE = '22023';
  END IF;
  IF claim_lease_token IS NULL OR claim_lease_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'scan-job lease token is invalid' USING ERRCODE = '22023';
  END IF;

  WITH exhausted AS (
    SELECT job.id, job.scan_id
    FROM public.scan_jobs AS job
    WHERE job.state = 'CLAIMED'
      AND job.lease_expires_at <= claim_now
      AND job.attempt_count >= job.max_attempts
      AND (requested_scan_id IS NULL OR job.scan_id = requested_scan_id)
    FOR UPDATE OF job SKIP LOCKED
  ), dead_jobs AS (
    UPDATE public.scan_jobs AS job
    SET state = 'DEAD_LETTERED',
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_safe_code = coalesce(job.last_error_safe_code, 'SCAN_JOB_LEASE_EXHAUSTED'),
      updated_at = claim_now
    FROM exhausted
    WHERE job.id = exhausted.id
    RETURNING job.scan_id
  ), dead_scans AS (
    UPDATE public.scans AS scan
    SET state = 'FAILED', completed_at = claim_now
    FROM dead_jobs
    WHERE scan.id = dead_jobs.scan_id AND scan.state IN ('QUEUED', 'RUNNING')
    RETURNING scan.id
  )
  SELECT count(*) INTO exhausted_count FROM dead_scans;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.scan_jobs AS job
    INNER JOIN public.scans AS scan ON scan.id = job.scan_id
    INNER JOIN public.users AS account ON account.id = job.user_id
    WHERE (
        (job.state = 'PENDING' AND job.not_before <= claim_now)
        OR (job.state = 'CLAIMED' AND job.lease_expires_at <= claim_now)
      )
      AND job.attempt_count < job.max_attempts
      AND scan.state IN ('QUEUED', 'RUNNING')
      AND account.state = 'ACTIVE'
      AND (requested_scan_id IS NULL OR job.scan_id = requested_scan_id)
    ORDER BY job.not_before, job.created_at, job.id
    LIMIT claim_batch_size
    FOR UPDATE OF job SKIP LOCKED
  ), claimed AS (
    UPDATE public.scan_jobs AS job
    SET state = 'CLAIMED',
      attempt_count = job.attempt_count + 1,
      lease_token = claim_lease_token,
      lease_expires_at = claim_now + make_interval(secs => claim_lease_seconds),
      updated_at = claim_now
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.id, job.scan_id, job.user_id, job.identity_id,
      job.identifier_id, job.consent_record_id, job.attempt_count, job.max_attempts
  ), running_scans AS (
    UPDATE public.scans AS scan
    SET state = 'RUNNING'
    FROM claimed
    WHERE scan.id = claimed.scan_id AND scan.state = 'QUEUED'
    RETURNING scan.id
  )
  SELECT claimed.id, claimed.scan_id, claimed.user_id, claimed.identity_id,
    claimed.identifier_id, claimed.consent_record_id, account.auth_subject,
    claimed.attempt_count, claimed.max_attempts
  FROM claimed
  INNER JOIN public.users AS account ON account.id = claimed.user_id;
END
$scan_jobs$;

REVOKE ALL ON FUNCTION public.claim_breach_scan_jobs(timestamptz, integer, integer, text, uuid)
FROM PUBLIC;
