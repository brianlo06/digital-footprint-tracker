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
