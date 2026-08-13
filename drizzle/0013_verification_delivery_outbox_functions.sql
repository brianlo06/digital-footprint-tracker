CREATE OR REPLACE FUNCTION public.claim_verification_deliveries(
  claim_now timestamptz,
  claim_batch_size integer,
  claim_lease_seconds integer,
  claim_lease_token text
)
RETURNS TABLE (
  delivery_id uuid,
  verification_id uuid,
  channel public.delivery_channel,
  template text,
  encrypted_payload jsonb,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $claim_verification_deliveries$
BEGIN
  IF claim_now IS NULL THEN
    RAISE EXCEPTION 'claim timestamp is required'
      USING ERRCODE = '22004';
  END IF;

  IF claim_batch_size IS NULL
    OR claim_batch_size < 1
    OR claim_batch_size > 200 THEN
    RAISE EXCEPTION 'claim batch size must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  IF claim_lease_seconds IS NULL
    OR claim_lease_seconds < 30
    OR claim_lease_seconds > 900 THEN
    RAISE EXCEPTION 'claim lease duration must be between 30 and 900 seconds'
      USING ERRCODE = '22023';
  END IF;

  IF claim_lease_token IS NULL OR claim_lease_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'claim lease token is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Pass 1: cancel deliveries whose verification or account has fallen out
  -- of the eligible state, before pass 2 claims anything, so a row this
  -- call also invalidates can never be claimed by it. A CLAIMED row under
  -- a still-live lease is never touched here, even if it just became
  -- ineligible - that is left for its current holder's CAS-guarded
  -- complete/report-failure call.
  WITH ineligible_candidates AS (
    SELECT outbox.delivery_id
    FROM public.verification_delivery_outbox AS outbox
    LEFT JOIN public.identifier_verifications AS verification
      ON verification.id = outbox.verification_id
    LEFT JOIN public.users AS account
      ON account.id = outbox.user_id
    WHERE outbox.state IN ('PENDING', 'CLAIMED')
      AND (outbox.state = 'PENDING' OR outbox.lease_expires_at <= claim_now)
      AND (
        verification.id IS NULL
        OR verification.status <> 'PENDING'
        OR verification.expires_at <= claim_now
        OR verification.locked_at IS NOT NULL
        OR account.id IS NULL
        OR account.state <> 'ACTIVE'
      )
    ORDER BY outbox.delivery_id
    FOR UPDATE OF outbox SKIP LOCKED
  )
  UPDATE public.verification_delivery_outbox AS outbox
  SET state = 'CANCELLED',
    encrypted_payload = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = claim_now
  FROM ineligible_candidates
  WHERE outbox.delivery_id = ineligible_candidates.delivery_id;

  -- Pass 2: claim eligible deliveries. This is a separate statement in the
  -- same transaction as pass 1 above, so under READ COMMITTED it sees pass
  -- 1's writes (read-your-own-writes) - a row can never match both passes.
  RETURN QUERY
  WITH eligible_candidates AS (
    SELECT outbox.delivery_id
    FROM public.verification_delivery_outbox AS outbox
    INNER JOIN public.identifier_verifications AS verification
      ON verification.id = outbox.verification_id
    INNER JOIN public.users AS account
      ON account.id = outbox.user_id
    WHERE outbox.state = 'PENDING'
      AND outbox.not_before <= claim_now
      AND verification.status = 'PENDING'
      AND verification.expires_at > claim_now
      AND verification.locked_at IS NULL
      AND account.state = 'ACTIVE'
    ORDER BY outbox.not_before, outbox.delivery_id
    FOR UPDATE OF outbox SKIP LOCKED
    LIMIT claim_batch_size
  )
  UPDATE public.verification_delivery_outbox AS outbox
  SET state = 'CLAIMED',
    lease_token = claim_lease_token,
    lease_expires_at = claim_now + make_interval(secs => claim_lease_seconds),
    updated_at = claim_now
  FROM eligible_candidates
  WHERE outbox.delivery_id = eligible_candidates.delivery_id
  RETURNING outbox.delivery_id, outbox.verification_id, outbox.channel, outbox.template,
    outbox.encrypted_payload, outbox.attempt_count;
END
$claim_verification_deliveries$;

CREATE OR REPLACE FUNCTION public.complete_verification_delivery(
  complete_now timestamptz,
  complete_delivery_id uuid,
  complete_lease_token text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $complete_verification_delivery$
DECLARE
  updated_count integer;
BEGIN
  IF complete_now IS NULL OR complete_delivery_id IS NULL THEN
    RAISE EXCEPTION 'completion timestamp and delivery ID are required'
      USING ERRCODE = '22004';
  END IF;

  IF complete_lease_token IS NULL OR complete_lease_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'completion lease token is invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.verification_delivery_outbox
  SET state = 'COMPLETED',
    encrypted_payload = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = complete_now
  WHERE delivery_id = complete_delivery_id
    AND state = 'CLAIMED'
    AND lease_token = complete_lease_token
    AND lease_expires_at > complete_now;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count = 1 THEN
    RETURN 'COMPLETED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.verification_delivery_outbox WHERE delivery_id = complete_delivery_id
  ) THEN
    RETURN 'NOT_FOUND';
  END IF;

  RETURN 'LEASE_MISMATCH';
END
$complete_verification_delivery$;

CREATE OR REPLACE FUNCTION public.report_verification_delivery_failure(
  report_now timestamptz,
  report_delivery_id uuid,
  report_lease_token text,
  report_outcome text,
  report_retry_after_seconds integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $report_verification_delivery_failure$
DECLARE
  current_row record;
  next_attempt_count integer;
  backoff_seconds numeric;
  next_not_before timestamptz;
BEGIN
  IF report_now IS NULL OR report_delivery_id IS NULL THEN
    RAISE EXCEPTION 'report timestamp and delivery ID are required'
      USING ERRCODE = '22004';
  END IF;

  IF report_lease_token IS NULL OR report_lease_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'report lease token is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF report_outcome NOT IN ('TRANSIENT', 'PERMANENT') THEN
    RAISE EXCEPTION 'report outcome must be TRANSIENT or PERMANENT'
      USING ERRCODE = '22023';
  END IF;

  IF report_retry_after_seconds IS NOT NULL
    AND (report_retry_after_seconds < 0 OR report_retry_after_seconds > 3600) THEN
    RAISE EXCEPTION 'retry-after seconds must be between 0 and 3600'
      USING ERRCODE = '22023';
  END IF;

  SELECT outbox.attempt_count, outbox.max_attempts
    INTO current_row
    FROM public.verification_delivery_outbox AS outbox
    WHERE outbox.delivery_id = report_delivery_id
      AND outbox.state = 'CLAIMED'
      AND outbox.lease_token = report_lease_token
      AND outbox.lease_expires_at > report_now
    FOR UPDATE OF outbox;

  IF NOT FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.verification_delivery_outbox WHERE delivery_id = report_delivery_id
    ) THEN
      RETURN 'NOT_FOUND';
    END IF;
    RETURN 'LEASE_MISMATCH';
  END IF;

  next_attempt_count := current_row.attempt_count + 1;

  IF report_outcome = 'PERMANENT' OR next_attempt_count >= current_row.max_attempts THEN
    UPDATE public.verification_delivery_outbox
    SET state = 'DEAD_LETTERED',
      encrypted_payload = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      attempt_count = next_attempt_count,
      updated_at = report_now
    WHERE delivery_id = report_delivery_id;

    RETURN 'DEAD_LETTERED';
  END IF;

  -- Capped exponential backoff with jitter: least(30 * 2^attempt_count,
  -- 3600) seconds, +-10% jitter, floored (not ceilinged) by a
  -- provider-supplied Retry-After when present.
  backoff_seconds := least(30 * power(2, current_row.attempt_count), 3600);
  backoff_seconds := backoff_seconds * (0.9 + random() * 0.2);

  IF report_retry_after_seconds IS NOT NULL THEN
    backoff_seconds := greatest(backoff_seconds, report_retry_after_seconds);
  END IF;

  next_not_before := report_now + make_interval(secs => backoff_seconds);

  UPDATE public.verification_delivery_outbox
  SET state = 'PENDING',
    lease_token = NULL,
    lease_expires_at = NULL,
    not_before = next_not_before,
    attempt_count = next_attempt_count,
    updated_at = report_now
  WHERE delivery_id = report_delivery_id;

  RETURN 'RETRY_SCHEDULED';
END
$report_verification_delivery_failure$;

REVOKE ALL ON FUNCTION public.claim_verification_deliveries(timestamptz, integer, integer, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_verification_delivery(timestamptz, uuid, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_verification_delivery_failure(
  timestamptz, uuid, text, text, integer
)
FROM PUBLIC;
