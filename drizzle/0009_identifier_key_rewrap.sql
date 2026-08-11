CREATE OR REPLACE FUNCTION public.list_identifier_envelopes_for_rewrap(
  rotation_source_key_id text,
  rotation_batch_size integer
)
RETURNS TABLE (
  identifier_id uuid,
  encrypted_value jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $list_rewrap$
BEGIN
  IF rotation_source_key_id IS NULL
    OR length(rotation_source_key_id) < 1
    OR length(rotation_source_key_id) > 64 THEN
    RAISE EXCEPTION 'source key ID is invalid'
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

  RETURN QUERY
  SELECT identifier.id, identifier.encrypted_value
  FROM public.identifiers AS identifier
  WHERE identifier.encrypted_value->>'keyId' = rotation_source_key_id
  ORDER BY identifier.id
  LIMIT rotation_batch_size;
END
$list_rewrap$;

CREATE OR REPLACE FUNCTION public.replace_identifier_envelope_for_rewrap(
  rotation_identifier_id uuid,
  rotation_expected_envelope jsonb,
  rotation_replacement_envelope jsonb,
  rotation_source_key_id text,
  rotation_target_key_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $replace_rewrap$
DECLARE
  replaced_count integer;
BEGIN
  IF rotation_identifier_id IS NULL
    OR rotation_expected_envelope IS NULL
    OR rotation_replacement_envelope IS NULL THEN
    RAISE EXCEPTION 'rotation identifier and envelopes are required'
      USING ERRCODE = '22004';
  END IF;

  IF rotation_source_key_id IS NULL
    OR rotation_target_key_id IS NULL
    OR length(rotation_source_key_id) < 1
    OR length(rotation_source_key_id) > 64
    OR length(rotation_target_key_id) < 1
    OR length(rotation_target_key_id) > 64
    OR rotation_source_key_id = rotation_target_key_id THEN
    RAISE EXCEPTION 'rotation key IDs are invalid'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(rotation_expected_envelope) <> 'object'
    OR jsonb_typeof(rotation_replacement_envelope) <> 'object'
    OR rotation_expected_envelope->>'version' <> '1'
    OR rotation_replacement_envelope->>'version' <> '1'
    OR rotation_expected_envelope->>'algorithm' <> 'A256GCM_ENVELOPE'
    OR rotation_replacement_envelope->>'algorithm' <> 'A256GCM_ENVELOPE'
    OR rotation_expected_envelope->>'keyId' <> rotation_source_key_id
    OR rotation_replacement_envelope->>'keyId' <> rotation_target_key_id
    OR rotation_replacement_envelope->>'ciphertext'
      IS DISTINCT FROM rotation_expected_envelope->>'ciphertext'
    OR rotation_replacement_envelope->>'nonce'
      IS DISTINCT FROM rotation_expected_envelope->>'nonce'
    OR rotation_replacement_envelope->>'authTag'
      IS DISTINCT FROM rotation_expected_envelope->>'authTag'
    OR coalesce(rotation_replacement_envelope->>'wrappedDataKey', '')
      !~ '^[A-Za-z0-9_-]+$'
    OR coalesce(rotation_replacement_envelope->>'wrapNonce', '')
      !~ '^[A-Za-z0-9_-]+$'
    OR coalesce(rotation_replacement_envelope->>'wrapAuthTag', '')
      !~ '^[A-Za-z0-9_-]+$'
    OR rotation_replacement_envelope->>'wrapNonce'
      IS NOT DISTINCT FROM rotation_expected_envelope->>'wrapNonce' THEN
    RAISE EXCEPTION 'replacement envelope is not a valid key-only rewrap'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.identifiers AS identifier
  SET encrypted_value = rotation_replacement_envelope
  WHERE identifier.id = rotation_identifier_id
    AND identifier.encrypted_value = rotation_expected_envelope
    AND identifier.encrypted_value->>'keyId' = rotation_source_key_id;

  GET DIAGNOSTICS replaced_count = ROW_COUNT;
  RETURN replaced_count = 1;
END
$replace_rewrap$;

REVOKE ALL ON FUNCTION public.list_identifier_envelopes_for_rewrap(text, integer)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_identifier_envelope_for_rewrap(uuid, jsonb, jsonb, text, text)
FROM PUBLIC;
