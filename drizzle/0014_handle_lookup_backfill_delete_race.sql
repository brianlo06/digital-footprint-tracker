-- Keep the one-time legacy-token backfill restart-safe during account deletion.
CREATE OR REPLACE FUNCTION public.backfill_identifier_lookup_tokens(
  rotation_lookup_key_id text,
  rotation_batch_size integer
)
RETURNS TABLE (
  copied integer,
  matched integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $backfill_lookup_tokens$
DECLARE
  unmapped_type public.identifier_type;
  candidate record;
  inserted_count integer;
  copied_count integer := 0;
  matched_count integer := 0;
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

  -- `matched` (not the insert count) drives the caller's hasMore decision:
  -- a concurrent backfill or rotation run targeting the same key could
  -- legitimately cause ON CONFLICT DO NOTHING to skip a row that was a
  -- genuine candidate at listing time, which must not be misread as "no
  -- more candidates remain".
  -- Process each candidate in its own exception block. A concurrent account
  -- deletion can remove the parent after this SELECT but before the child
  -- insert checks its composite foreign key. That expected race skips only
  -- the vanished candidate instead of rolling back successful inserts from
  -- the rest of the bounded batch. Row locking is deliberately avoided: it
  -- would require granting UPDATE on identifiers to this function owner.
  FOR candidate IN
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
  LOOP
    matched_count := matched_count + 1;
    inserted_count := 0;

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
        candidate.identifier_id,
        candidate.identity_id,
        candidate.type,
        CASE candidate.type WHEN 'EMAIL' THEN 'identifier:email:v1' END,
        candidate.normalization_version,
        rotation_lookup_key_id,
        candidate.lookup_token
      )
      ON CONFLICT (identifier_id, lookup_key_id) DO NOTHING;

      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      copied_count := copied_count + inserted_count;
    EXCEPTION
      WHEN foreign_key_violation THEN
        -- The selected identifier was concurrently deleted. Its token is no
        -- longer needed, and ON DELETE CASCADE covers a deletion that commits
        -- after a successful insert.
        NULL;
    END;
  END LOOP;

  copied := copied_count;
  matched := matched_count;
  RETURN NEXT;
END
$backfill_lookup_tokens$;
