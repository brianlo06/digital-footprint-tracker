CREATE POLICY "observations_retention_capability" ON "observations" AS PERMISSIVE FOR ALL TO public USING (current_user = 'digital_footprint_retention_owner') WITH CHECK (current_user = 'digital_footprint_retention_owner');--> statement-breakpoint

-- The signature gains an observation cutoff, so the previous four-argument
-- function is removed rather than left behind as an executable overload.
DROP FUNCTION public.run_retention_maintenance(timestamptz, integer, timestamptz, timestamptz);--> statement-breakpoint

CREATE FUNCTION public.run_retention_maintenance(
  maintenance_now timestamptz,
  maintenance_batch_size integer,
  orphan_audit_cutoff timestamptz,
  scan_job_cutoff timestamptz,
  observation_cutoff timestamptz
)
RETURNS TABLE (
  expired_verifications integer,
  deleted_receipts integer,
  deleted_orphan_audit_events integer,
  deleted_scan_jobs integer,
  deleted_observations integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $retention$
DECLARE
  expired_count integer;
  receipt_count integer;
  audit_count integer;
  scan_job_count integer;
  observation_count integer;
BEGIN
  IF maintenance_now IS NULL
    OR orphan_audit_cutoff IS NULL
    OR scan_job_cutoff IS NULL
    OR observation_cutoff IS NULL THEN
    RAISE EXCEPTION 'retention timestamps are required'
      USING ERRCODE = '22004';
  END IF;

  IF maintenance_batch_size IS NULL
    OR maintenance_batch_size < 1
    OR maintenance_batch_size > 1000 THEN
    RAISE EXCEPTION 'retention batch size must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  IF maintenance_now > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'retention clock cannot be in the future'
      USING ERRCODE = '22023';
  END IF;

  IF orphan_audit_cutoff > maintenance_now - interval '1 day' THEN
    RAISE EXCEPTION 'orphan audit retention must be at least one day'
      USING ERRCODE = '22023';
  END IF;

  IF scan_job_cutoff > maintenance_now - interval '1 day' THEN
    RAISE EXCEPTION 'scan-job retention must be at least one day'
      USING ERRCODE = '22023';
  END IF;

  IF observation_cutoff > maintenance_now - interval '30 days' THEN
    RAISE EXCEPTION 'observation retention must be at least thirty days'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT verification.id
    FROM public.identifier_verifications AS verification
    WHERE verification.status = 'PENDING'
      AND verification.expires_at <= maintenance_now
    ORDER BY verification.expires_at, verification.id
    FOR UPDATE SKIP LOCKED
    LIMIT maintenance_batch_size
  ), updated AS (
    UPDATE public.identifier_verifications AS verification
    SET status = 'EXPIRED', challenge_hash = 'consumed'
    FROM candidates
    WHERE verification.id = candidates.id
      AND verification.status = 'PENDING'
    RETURNING 1
  )
  SELECT count(*)::integer INTO expired_count FROM updated;

  WITH candidates AS (
    SELECT receipt.id
    FROM public.deletion_receipts AS receipt
    WHERE receipt.state = 'COMPLETED'
      AND receipt.expires_at <= maintenance_now
    ORDER BY receipt.expires_at, receipt.id
    FOR UPDATE SKIP LOCKED
    LIMIT maintenance_batch_size
  ), deleted AS (
    DELETE FROM public.deletion_receipts AS receipt
    USING candidates
    WHERE receipt.id = candidates.id
    RETURNING 1
  )
  SELECT count(*)::integer INTO receipt_count FROM deleted;

  WITH candidates AS (
    SELECT event.id
    FROM public.audit_events AS event
    WHERE event.user_id IS NULL
      AND event.occurred_at <= orphan_audit_cutoff
    ORDER BY event.occurred_at, event.id
    FOR UPDATE SKIP LOCKED
    LIMIT maintenance_batch_size
  ), deleted AS (
    DELETE FROM public.audit_events AS event
    USING candidates
    WHERE event.id = candidates.id
    RETURNING 1
  )
  SELECT count(*)::integer INTO audit_count FROM deleted;

  WITH candidates AS (
    SELECT rate_window.scope_kind, rate_window.scope_token, rate_window.action
    FROM public.rate_limit_windows AS rate_window
    WHERE rate_window.expires_at <= maintenance_now
    ORDER BY
      rate_window.expires_at,
      rate_window.scope_kind,
      rate_window.scope_token,
      rate_window.action
    FOR UPDATE SKIP LOCKED
    LIMIT maintenance_batch_size
  )
  DELETE FROM public.rate_limit_windows AS rate_window
  USING candidates
  WHERE rate_window.scope_kind = candidates.scope_kind
    AND rate_window.scope_token = candidates.scope_token
    AND rate_window.action = candidates.action;

  -- Terminal job detail (opaque payload references, lease history, and safe
  -- error codes) ages out; the scans/provider_runs/breach_findings summary
  -- is deliberately retained on its own longer schedule.
  WITH candidates AS (
    SELECT job.id
    FROM public.scan_jobs AS job
    WHERE job.state IN ('COMPLETED', 'DEAD_LETTERED', 'CANCELLED')
      AND job.updated_at <= scan_job_cutoff
    ORDER BY job.updated_at, job.id
    FOR UPDATE SKIP LOCKED
    LIMIT maintenance_batch_size
  ), deleted AS (
    DELETE FROM public.scan_jobs AS job
    USING candidates
    WHERE job.id = candidates.id
    RETURNING 1
  )
  SELECT count(*)::integer INTO scan_job_count FROM deleted;

  -- Aged observation history ages out, but every finding keeps its most
  -- recent observation regardless of age: `docs/PRIVACY.md` retains evidence
  -- summary and provenance for the life of the finding, so a finding must
  -- never be left with no observation explaining its current state.
  WITH ranked AS (
    SELECT
      observation.id,
      observation.observed_at,
      row_number() OVER (
        PARTITION BY observation.finding_id
        ORDER BY observation.observed_at DESC, observation.id DESC
      ) AS recency
    FROM public.observations AS observation
  ), stale AS (
    SELECT ranked.id
    FROM ranked
    WHERE ranked.recency > 1
      AND ranked.observed_at <= observation_cutoff
    ORDER BY ranked.observed_at, ranked.id
    LIMIT maintenance_batch_size
  ), locked AS (
    SELECT observation.id
    FROM public.observations AS observation
    INNER JOIN stale ON stale.id = observation.id
    FOR UPDATE OF observation SKIP LOCKED
  ), deleted AS (
    DELETE FROM public.observations AS observation
    USING locked
    WHERE observation.id = locked.id
    RETURNING 1
  )
  SELECT count(*)::integer INTO observation_count FROM deleted;

  RETURN QUERY SELECT
    expired_count,
    receipt_count,
    audit_count,
    scan_job_count,
    observation_count;
END
$retention$;--> statement-breakpoint

REVOKE ALL ON FUNCTION
  public.run_retention_maintenance(timestamptz, integer, timestamptz, timestamptz, timestamptz)
FROM PUBLIC;
