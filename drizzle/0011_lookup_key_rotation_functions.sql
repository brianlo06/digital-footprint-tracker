CREATE OR REPLACE FUNCTION public.backfill_identifier_lookup_tokens(
  rotation_lookup_key_id text,
  rotation_batch_size integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $backfill_lookup_tokens$
DECLARE
  inserted_count integer;
  unmapped_type public.identifier_type;
BEGIN
  IF rotation_lookup_key_id IS NULL
    OR length(rotation_lookup_key_id) < 1
    OR length(rotation_lookup_key_id) > 64 THEN
    RAISE EXCEPTION 'lookup key ID is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- The application requests batch_size + 1 to determine whether another
  -- bounded batch remains.
  IF rotation_batch_size IS NULL
    OR rotation_batch_size < 1
    OR rotation_batch_size > 1001 THEN
    RAISE EXCEPTION 'rotation batch size must be between 1 and 1001'
      USING ERRCODE = '22023';
  END IF;

  SELECT identifier.type INTO unmapped_type
  FROM public.identifiers AS identifier
  WHERE NOT EXISTS (
    SELECT 1 FROM public.identifier_lookup_tokens AS token
    WHERE token.identifier_id = identifier.id
      AND token.lookup_key_id = rotation_lookup_key_id
  )
  AND identifier.type NOT IN ('EMAIL')
  ORDER BY identifier.id
  LIMIT 1;

  IF unmapped_type IS NOT NULL THEN
    RAISE EXCEPTION 'no lookup namespace is mapped for identifier type %', unmapped_type
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT
      identifier.id AS identifier_id,
      identifier.identity_id,
      identifier.type,
      identifier.lookup_token,
      identifier.normalization_version
    FROM public.identifiers AS identifier
    WHERE NOT EXISTS (
      SELECT 1 FROM public.identifier_lookup_tokens AS token
      WHERE token.identifier_id = identifier.id
        AND token.lookup_key_id = rotation_lookup_key_id
    )
    ORDER BY identifier.id
    LIMIT rotation_batch_size
  )
  INSERT INTO public.identifier_lookup_tokens (
    identifier_id,
    identity_id,
    identifier_type,
    namespace,
    normalization_version,
    lookup_key_id,
    token
  )
  SELECT
    candidates.identifier_id,
    candidates.identity_id,
    candidates.type,
    CASE candidates.type WHEN 'EMAIL' THEN 'identifier:email:v1' END,
    candidates.normalization_version,
    rotation_lookup_key_id,
    candidates.lookup_token
  FROM candidates
  ON CONFLICT (identifier_id, lookup_key_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END
$backfill_lookup_tokens$;

CREATE OR REPLACE FUNCTION public.list_identifiers_missing_lookup_token(
  rotation_lookup_key_id text,
  rotation_batch_size integer
)
RETURNS TABLE (
  identifier_id uuid,
  identity_id uuid,
  identifier_type public.identifier_type,
  namespace text,
  encrypted_value jsonb,
  normalization_version text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $list_missing_lookup_tokens$
BEGIN
  IF rotation_lookup_key_id IS NULL
    OR length(rotation_lookup_key_id) < 1
    OR length(rotation_lookup_key_id) > 64 THEN
    RAISE EXCEPTION 'lookup key ID is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF rotation_batch_size IS NULL
    OR rotation_batch_size < 1
    OR rotation_batch_size > 1001 THEN
    RAISE EXCEPTION 'rotation batch size must be between 1 and 1001'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.identifiers AS identifier
    WHERE NOT EXISTS (
      SELECT 1 FROM public.identifier_lookup_tokens AS token
      WHERE token.identifier_id = identifier.id
        AND token.lookup_key_id = rotation_lookup_key_id
    )
    AND identifier.type NOT IN ('EMAIL')
  ) THEN
    RAISE EXCEPTION 'no lookup namespace is mapped for at least one candidate identifier type'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    identifier.id,
    identifier.identity_id,
    identifier.type,
    CASE identifier.type WHEN 'EMAIL' THEN 'identifier:email:v1' END,
    identifier.encrypted_value,
    identifier.normalization_version
  FROM public.identifiers AS identifier
  WHERE NOT EXISTS (
    SELECT 1 FROM public.identifier_lookup_tokens AS token
    WHERE token.identifier_id = identifier.id
      AND token.lookup_key_id = rotation_lookup_key_id
  )
  ORDER BY identifier.id
  LIMIT rotation_batch_size;
END
$list_missing_lookup_tokens$;

CREATE OR REPLACE FUNCTION public.insert_identifier_lookup_token_for_rotation(
  rotation_identifier_id uuid,
  rotation_identity_id uuid,
  rotation_identifier_type public.identifier_type,
  rotation_namespace text,
  rotation_normalization_version text,
  rotation_lookup_key_id text,
  rotation_token text,
  rotation_expected_encrypted_value jsonb,
  rotation_expected_normalization_version text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $insert_rotation_token$
DECLARE
  current_row record;
  inserted_count integer;
BEGIN
  IF rotation_identifier_id IS NULL
    OR rotation_identity_id IS NULL
    OR rotation_identifier_type IS NULL
    OR rotation_namespace IS NULL
    OR length(rotation_namespace) < 1
    OR rotation_normalization_version IS NULL
    OR length(rotation_normalization_version) < 1
    OR rotation_expected_encrypted_value IS NULL
    OR rotation_expected_normalization_version IS NULL THEN
    RAISE EXCEPTION 'rotation identifier and token fields are required'
      USING ERRCODE = '22004';
  END IF;

  IF rotation_lookup_key_id IS NULL
    OR length(rotation_lookup_key_id) < 1
    OR length(rotation_lookup_key_id) > 64 THEN
    RAISE EXCEPTION 'lookup key ID is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF rotation_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'rotation token is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    identifier.identity_id,
    identifier.type,
    identifier.encrypted_value,
    identifier.normalization_version
    INTO current_row
    FROM public.identifiers AS identifier
    WHERE identifier.id = rotation_identifier_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'DELETED';
  END IF;

  IF current_row.identity_id IS DISTINCT FROM rotation_identity_id
    OR current_row.type IS DISTINCT FROM rotation_identifier_type
    OR current_row.encrypted_value IS DISTINCT FROM rotation_expected_encrypted_value
    OR current_row.normalization_version IS DISTINCT FROM rotation_expected_normalization_version
  THEN
    RETURN 'CONFLICT';
  END IF;

  BEGIN
    INSERT INTO public.identifier_lookup_tokens (
      identifier_id,
      identity_id,
      identifier_type,
      namespace,
      normalization_version,
      lookup_key_id,
      token
    )
    VALUES (
      rotation_identifier_id,
      rotation_identity_id,
      rotation_identifier_type,
      rotation_namespace,
      rotation_normalization_version,
      rotation_lookup_key_id,
      rotation_token
    )
    ON CONFLICT (identifier_id, lookup_key_id) DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN 'CONFLICT';
  END;

  IF inserted_count = 1 THEN
    RETURN 'INSERTED';
  END IF;

  RETURN 'ALREADY_PRESENT';
END
$insert_rotation_token$;

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
    END CASE;

    SELECT window_started_at, request_count, blocked_until
      INTO old_row
      FROM public.rate_limit_windows
      WHERE scope_kind = current_scope AND scope_token = old_token AND action = requested_action
      FOR UPDATE;
    old_found := FOUND;

    SELECT window_started_at, request_count, blocked_until
      INTO new_row
      FROM public.rate_limit_windows
      WHERE scope_kind = current_scope AND scope_token = new_token AND action = requested_action
      FOR UPDATE;
    new_found := FOUND;

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

    INSERT INTO public.rate_limit_windows (
      scope_kind, scope_token, action, window_started_at, request_count, blocked_until, expires_at
    )
    VALUES (
      current_scope, old_token, requested_action,
      final_window_started_at, final_request_count, final_blocked_until, final_expires_at
    )
    ON CONFLICT (scope_kind, scope_token, action) DO UPDATE
    SET
      window_started_at = excluded.window_started_at,
      request_count = excluded.request_count,
      blocked_until = excluded.blocked_until,
      expires_at = excluded.expires_at;

    INSERT INTO public.rate_limit_windows (
      scope_kind, scope_token, action, window_started_at, request_count, blocked_until, expires_at
    )
    VALUES (
      current_scope, new_token, requested_action,
      final_window_started_at, final_request_count, final_blocked_until, final_expires_at
    )
    ON CONFLICT (scope_kind, scope_token, action) DO UPDATE
    SET
      window_started_at = excluded.window_started_at,
      request_count = excluded.request_count,
      blocked_until = excluded.blocked_until,
      expires_at = excluded.expires_at;

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

REVOKE ALL ON FUNCTION public.backfill_identifier_lookup_tokens(text, integer)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_identifiers_missing_lookup_token(text, integer)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_identifier_lookup_token_for_rotation(
  uuid, uuid, public.identifier_type, text, text, text, text, jsonb, text
)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_action_rate_limit_dual(
  text, text, text, text, public.rate_limit_action
)
FROM PUBLIC;
