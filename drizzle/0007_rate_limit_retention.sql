CREATE OR REPLACE FUNCTION public.run_retention_maintenance(
  maintenance_now timestamptz,
  maintenance_batch_size integer,
  orphan_audit_cutoff timestamptz
)
RETURNS TABLE (
  expired_verifications integer,
  deleted_receipts integer,
  deleted_orphan_audit_events integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $retention$
DECLARE
  expired_count integer;
  receipt_count integer;
  audit_count integer;
BEGIN
  IF maintenance_now IS NULL OR orphan_audit_cutoff IS NULL THEN
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

  RETURN QUERY SELECT expired_count, receipt_count, audit_count;
END
$retention$;

REVOKE ALL ON FUNCTION public.run_retention_maintenance(timestamptz, integer, timestamptz)
FROM PUBLIC;
