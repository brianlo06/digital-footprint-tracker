-- Read-only preflight for the complete PostgreSQL authorization boundary.
-- Run with an owner/administrator connection after migrations and role grants.
-- The standard role names are part of the deployed security contract.

\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $verify$
DECLARE
  audited_role text;
  audited_table text;
  audited_privilege text;
  expected_login boolean;
  expected_bypass boolean;
  expected_privilege boolean;
  actual_privilege boolean;
  role_flags record;
  table_flags record;
  function_check record;
  function_owner text;
  function_signature text;
  expected_function_owner text;
  expected_policy text;
  capability_policy text;
  capability_owner text;
  capability_using text;
  capability_check text;
  capability_permissive boolean;
  public_can_execute boolean;
BEGIN
  FOR audited_role, expected_login, expected_bypass IN
    SELECT *
    FROM (VALUES
      ('digital_footprint_runtime', true, false),
      ('digital_footprint_maintenance', true, false),
      ('digital_footprint_rotation', true, false),
      ('digital_footprint_lookup_rotation', true, false),
      ('digital_footprint_rate_limit_owner', false, false),
      ('digital_footprint_retention_owner', false, false),
      ('digital_footprint_rotation_owner', false, false),
      ('digital_footprint_lookup_rotation_owner', false, false),
      ('digital_footprint_delivery', true, false),
      ('digital_footprint_delivery_owner', false, false),
      ('digital_footprint_provider_usage_owner', false, false)
    ) AS expected(role_name, can_login, bypasses_rls)
  LOOP
    SELECT
      rolcanlogin AS can_login,
      rolsuper AS is_superuser,
      rolcreatedb AS can_create_database,
      rolcreaterole AS can_create_role,
      rolinherit AS inherits_privileges,
      rolbypassrls AS bypasses_rls
    INTO role_flags
    FROM pg_catalog.pg_roles
    WHERE rolname = audited_role;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'required role is missing: %', audited_role;
    END IF;

    IF role_flags.can_login <> expected_login THEN
      RAISE EXCEPTION 'role % has unexpected LOGIN setting', audited_role;
    END IF;
    IF role_flags.bypasses_rls <> expected_bypass THEN
      RAISE EXCEPTION 'role % has unexpected BYPASSRLS setting', audited_role;
    END IF;
    IF role_flags.is_superuser
      OR role_flags.can_create_database
      OR role_flags.can_create_role
      OR role_flags.inherits_privileges THEN
      RAISE EXCEPTION 'role % has a forbidden administrative capability', audited_role;
    END IF;
    IF pg_catalog.has_schema_privilege(audited_role, 'public', 'CREATE') THEN
      RAISE EXCEPTION 'role % can create objects in schema public', audited_role;
    END IF;
    IF NOT pg_catalog.has_schema_privilege(audited_role, 'public', 'USAGE') THEN
      RAISE EXCEPTION 'role % lacks required schema usage', audited_role;
    END IF;
  END LOOP;

  FOR audited_role IN
    SELECT unnest(ARRAY[
      'digital_footprint_runtime',
      'digital_footprint_maintenance',
      'digital_footprint_rotation',
      'digital_footprint_lookup_rotation',
      'digital_footprint_delivery'
    ])
  LOOP
    IF NOT pg_catalog.has_database_privilege(audited_role, current_database(), 'CONNECT') THEN
      RAISE EXCEPTION 'login role % cannot connect to the current database', audited_role;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      INNER JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.member
      WHERE member_role.rolname = audited_role
    ) THEN
      RAISE EXCEPTION 'login role % inherits or can SET ROLE through a membership', audited_role;
    END IF;
  END LOOP;

  FOREACH audited_table IN ARRAY ARRAY[
    'users',
    'identities',
    'identifiers',
    'identifier_lookup_tokens',
    'identifier_verifications',
    'consent_records',
    'audit_events',
    'deletion_receipts',
    'provider_usage_reservations',
    'rate_limit_windows',
    'verification_delivery_outbox',
    'scans',
    'scan_jobs',
    'provider_runs',
    'breach_findings'
  ]
  LOOP
    SELECT
      relation.relrowsecurity AS rls_enabled,
      relation.relforcerowsecurity AS rls_forced,
      owner.rolname AS owner_name
    INTO table_flags
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    INNER JOIN pg_catalog.pg_roles AS owner ON owner.oid = relation.relowner
    WHERE namespace.nspname = 'public'
      AND relation.relname = audited_table
      AND relation.relkind IN ('r', 'p');

    IF NOT FOUND THEN
      RAISE EXCEPTION 'required protected table is missing: public.%', audited_table;
    END IF;
    IF NOT table_flags.rls_enabled OR NOT table_flags.rls_forced THEN
      RAISE EXCEPTION 'public.% does not have enabled and forced RLS', audited_table;
    END IF;
    IF table_flags.owner_name = ANY(ARRAY[
      'digital_footprint_runtime',
      'digital_footprint_maintenance',
      'digital_footprint_rotation',
      'digital_footprint_lookup_rotation',
      'digital_footprint_rate_limit_owner',
      'digital_footprint_retention_owner',
      'digital_footprint_rotation_owner',
      'digital_footprint_lookup_rotation_owner',
      'digital_footprint_delivery',
      'digital_footprint_delivery_owner',
      'digital_footprint_provider_usage_owner'
    ]) THEN
      RAISE EXCEPTION 'protected table public.% has a restricted or capability role as owner', audited_table;
    END IF;

    IF audited_table = 'rate_limit_windows' THEN
      NULL; -- Capability policies are verified below; there is no tenant policy.
    ELSIF audited_table = 'verification_delivery_outbox' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy AS policy
        INNER JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
        INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = audited_table
          AND policy.polname = 'verification_delivery_outbox_insert_only'
          AND policy.polcmd = 'a'
          AND policy.polroles = ARRAY[0::oid]
      ) THEN
        RAISE EXCEPTION 'required insert-only policy is missing on public.%', audited_table;
      END IF;
    ELSE
      expected_policy := audited_table || '_tenant_isolation';
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy AS policy
        INNER JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
        INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = audited_table
          AND policy.polname = expected_policy
          AND policy.polcmd = '*'
          AND policy.polroles = ARRAY[0::oid]
      ) THEN
        RAISE EXCEPTION 'required public all-command tenant policy is missing on public.%', audited_table;
      END IF;
    END IF;
  END LOOP;

  -- Every security-definer owner remains NOBYPASSRLS. Its permissive policy
  -- is an exact CURRENT_USER equality for one fixed non-login role; table
  -- grants separately constrain which commands that role can perform.
  FOR audited_table, capability_policy, capability_owner IN
    SELECT *
    FROM (VALUES
      ('users', 'users_delivery_capability', 'digital_footprint_delivery_owner'),
      ('users', 'users_rotation_capability', 'digital_footprint_rotation_owner'),
      ('users', 'users_lookup_rotation_capability', 'digital_footprint_lookup_rotation_owner'),
      ('users', 'users_retention_capability', 'digital_footprint_retention_owner'),
      ('users', 'users_provider_usage_capability', 'digital_footprint_provider_usage_owner'),
      ('identities', 'identities_rotation_capability', 'digital_footprint_rotation_owner'),
      (
        'identities',
        'identities_lookup_rotation_capability',
        'digital_footprint_lookup_rotation_owner'
      ),
      ('identities', 'identities_retention_capability', 'digital_footprint_retention_owner'),
      ('identities', 'identities_delivery_capability', 'digital_footprint_delivery_owner'),
      ('identifiers', 'identifiers_rotation_capability', 'digital_footprint_rotation_owner'),
      ('identifiers', 'identifiers_lookup_rotation_capability', 'digital_footprint_lookup_rotation_owner'),
      ('identifiers', 'identifiers_retention_capability', 'digital_footprint_retention_owner'),
      ('identifiers', 'identifiers_delivery_capability', 'digital_footprint_delivery_owner'),
      (
        'identifier_lookup_tokens',
        'identifier_lookup_tokens_lookup_rotation_capability',
        'digital_footprint_lookup_rotation_owner'
      ),
      (
        'identifier_verifications',
        'identifier_verifications_retention_capability',
        'digital_footprint_retention_owner'
      ),
      (
        'identifier_verifications',
        'identifier_verifications_delivery_capability',
        'digital_footprint_delivery_owner'
      ),
      ('audit_events', 'audit_events_retention_capability', 'digital_footprint_retention_owner'),
      (
        'deletion_receipts',
        'deletion_receipts_retention_capability',
        'digital_footprint_retention_owner'
      ),
      (
        'rate_limit_windows',
        'rate_limit_windows_rate_limit_capability',
        'digital_footprint_rate_limit_owner'
      ),
      (
        'rate_limit_windows',
        'rate_limit_windows_retention_capability',
        'digital_footprint_retention_owner'
      ),
      (
        'verification_delivery_outbox',
        'verification_delivery_outbox_delivery_capability',
        'digital_footprint_delivery_owner'
      ),
      (
        'provider_usage_reservations',
        'provider_usage_reservations_capability',
        'digital_footprint_provider_usage_owner'
      ),
      (
        'scans',
        'scans_scan_job_capability',
        'digital_footprint_provider_usage_owner'
      ),
      (
        'scan_jobs',
        'scan_jobs_scan_job_capability',
        'digital_footprint_provider_usage_owner'
      ),
      (
        'scan_jobs',
        'scan_jobs_retention_capability',
        'digital_footprint_retention_owner'
      )
    ) AS expected(table_name, policy_name, owner_name)
  LOOP
    SELECT
      pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
      pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
      policy.polpermissive
    INTO capability_using, capability_check, capability_permissive
    FROM pg_catalog.pg_policy AS policy
    INNER JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
    INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = audited_table
      AND policy.polname = capability_policy
      AND policy.polcmd = '*'
      AND policy.polroles = ARRAY[0::oid];

    IF NOT FOUND
      OR NOT capability_permissive
      OR capability_using <> pg_catalog.format('(CURRENT_USER = %L::name)', capability_owner)
      OR capability_check <> pg_catalog.format('(CURRENT_USER = %L::name)', capability_owner) THEN
      RAISE EXCEPTION 'capability policy % on public.% is missing or unsafe',
        capability_policy,
        audited_table;
    END IF;
  END LOOP;

  FOR audited_role IN
    SELECT unnest(ARRAY[
      'digital_footprint_runtime',
      'digital_footprint_maintenance',
      'digital_footprint_rotation',
      'digital_footprint_lookup_rotation',
      'digital_footprint_rate_limit_owner',
      'digital_footprint_retention_owner',
      'digital_footprint_rotation_owner',
      'digital_footprint_lookup_rotation_owner',
      'digital_footprint_delivery',
      'digital_footprint_delivery_owner',
      'digital_footprint_provider_usage_owner'
    ])
  LOOP
    FOREACH audited_table IN ARRAY ARRAY[
      'users',
      'identities',
      'identifiers',
      'identifier_lookup_tokens',
      'identifier_verifications',
      'consent_records',
      'audit_events',
      'deletion_receipts',
      'provider_usage_reservations',
      'rate_limit_windows',
      'verification_delivery_outbox',
      'scans',
      'scan_jobs',
      'provider_runs',
      'breach_findings'
    ]
    LOOP
      FOREACH audited_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ]
      LOOP
        expected_privilege :=
          (
            audited_role = 'digital_footprint_runtime'
            AND audited_table <> 'rate_limit_windows'
            AND audited_table <> 'verification_delivery_outbox'
            AND audited_table <> 'provider_usage_reservations'
            AND audited_privilege = ANY(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
          )
          OR (
            audited_role = 'digital_footprint_runtime'
            AND audited_table = 'verification_delivery_outbox'
            AND audited_privilege = 'INSERT'
          )
          OR (
            audited_role = 'digital_footprint_delivery_owner'
            AND audited_table = 'verification_delivery_outbox'
            AND audited_privilege = ANY(ARRAY['SELECT', 'UPDATE'])
          )
          OR (
            audited_role = 'digital_footprint_delivery_owner'
            AND audited_table = 'identifier_verifications'
            AND audited_privilege = 'SELECT'
          )
          OR (
            audited_role = 'digital_footprint_delivery_owner'
            AND audited_table = ANY(ARRAY['users', 'identities', 'identifiers'])
            AND audited_privilege = 'SELECT'
          )
          OR (
            audited_role = 'digital_footprint_rate_limit_owner'
            AND audited_table = 'rate_limit_windows'
            AND audited_privilege = ANY(ARRAY['SELECT', 'INSERT', 'UPDATE'])
          )
          OR (
            audited_role = 'digital_footprint_retention_owner'
            AND audited_table = 'identifier_verifications'
            AND audited_privilege = ANY(ARRAY['SELECT', 'UPDATE'])
          )
          OR (
            audited_role = 'digital_footprint_retention_owner'
            AND audited_table = ANY(ARRAY['users', 'identities', 'identifiers'])
            AND audited_privilege = 'SELECT'
          )
          OR (
            audited_role = 'digital_footprint_retention_owner'
            AND audited_table = ANY(ARRAY[
              'deletion_receipts', 'audit_events', 'rate_limit_windows', 'scan_jobs'
            ])
            AND audited_privilege = ANY(ARRAY['SELECT', 'UPDATE', 'DELETE'])
          )
          OR (
            audited_role = 'digital_footprint_rotation_owner'
            AND audited_table = 'identifiers'
            AND audited_privilege = ANY(ARRAY['SELECT', 'UPDATE'])
          )
          OR (
            audited_role = 'digital_footprint_rotation_owner'
            AND audited_table = ANY(ARRAY['users', 'identities'])
            AND audited_privilege = 'SELECT'
          )
          OR (
            audited_role = 'digital_footprint_lookup_rotation_owner'
            AND audited_table = 'identifiers'
            AND audited_privilege = 'SELECT'
          )
          OR (
            audited_role = 'digital_footprint_lookup_rotation_owner'
            AND audited_table = 'identifier_lookup_tokens'
            AND audited_privilege = ANY(ARRAY['SELECT', 'INSERT'])
          )
          OR (
            audited_role = 'digital_footprint_lookup_rotation_owner'
            AND audited_table = ANY(ARRAY['users', 'identities'])
            AND audited_privilege = 'SELECT'
          )
          OR (
            audited_role = 'digital_footprint_provider_usage_owner'
            AND audited_table = 'provider_usage_reservations'
            AND audited_privilege = ANY(ARRAY['SELECT', 'INSERT', 'UPDATE'])
          )
          OR (
            audited_role = 'digital_footprint_provider_usage_owner'
            AND audited_table = 'users'
            AND audited_privilege = 'SELECT'
          )
          OR (
            audited_role = 'digital_footprint_provider_usage_owner'
            AND audited_table = ANY(ARRAY['scans', 'scan_jobs'])
            AND audited_privilege = ANY(ARRAY['SELECT', 'UPDATE'])
          );

        actual_privilege := pg_catalog.has_table_privilege(
          audited_role,
          format('public.%I', audited_table),
          audited_privilege
        );
        IF actual_privilege <> expected_privilege THEN
          RAISE EXCEPTION 'unexpected % privilege for role % on public.% (expected %, found %)',
            audited_privilege,
            audited_role,
            audited_table,
            expected_privilege,
            actual_privilege;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOR function_signature, expected_function_owner IN
    SELECT *
    FROM (VALUES
      (
        'public.consume_action_rate_limit(text,text,public.rate_limit_action)',
        'digital_footprint_rate_limit_owner'
      ),
      (
        'public.consume_action_rate_limit_dual(text,text,text,text,public.rate_limit_action)',
        'digital_footprint_rate_limit_owner'
      ),
      (
        'public.run_retention_maintenance(timestamptz,integer,timestamptz,timestamptz)',
        'digital_footprint_retention_owner'
      ),
      (
        'public.list_identifier_envelopes_for_rewrap(text,integer)',
        'digital_footprint_rotation_owner'
      ),
      (
        'public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)',
        'digital_footprint_rotation_owner'
      ),
      (
        'public.backfill_identifier_lookup_tokens(text,integer)',
        'digital_footprint_lookup_rotation_owner'
      ),
      (
        'public.list_identifiers_missing_lookup_token(text,integer)',
        'digital_footprint_lookup_rotation_owner'
      ),
      (
        'public.insert_identifier_lookup_token_for_rotation(uuid,uuid,public.identifier_type,text,text,text,text,jsonb,text)',
        'digital_footprint_lookup_rotation_owner'
      ),
      (
        'public.claim_verification_deliveries(timestamptz,integer,integer,text)',
        'digital_footprint_delivery_owner'
      ),
      (
        'public.complete_verification_delivery(timestamptz,uuid,text)',
        'digital_footprint_delivery_owner'
      ),
      (
        'public.report_verification_delivery_failure(timestamptz,uuid,text,text,integer)',
        'digital_footprint_delivery_owner'
      ),
      (
        'public.reserve_provider_usage(uuid,text,text,text,integer,integer,integer,integer,integer,integer)',
        'digital_footprint_provider_usage_owner'
      ),
      (
        'public.complete_provider_usage(uuid,public.provider_usage_state,integer)',
        'digital_footprint_provider_usage_owner'
      ),
      (
        'public.release_provider_usage(uuid)',
        'digital_footprint_provider_usage_owner'
      ),
      (
        'public.claim_breach_scan_jobs(timestamptz,integer,integer,text,uuid)',
        'digital_footprint_provider_usage_owner'
      )
    ) AS expected(signature, owner_name)
  LOOP
    SELECT
      owner.rolname AS owner_name,
      procedure.prosecdef AS security_definer,
      procedure.proconfig AS configuration,
      EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
        ) AS privilege
        WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
      ) AS public_execute
    INTO function_check
    FROM pg_catalog.pg_proc AS procedure
    INNER JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
    WHERE procedure.oid = to_regprocedure(function_signature);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'required capability function is missing: %', function_signature;
    END IF;
    function_owner := function_check.owner_name;
    public_can_execute := function_check.public_execute;
    IF function_owner <> expected_function_owner THEN
      RAISE EXCEPTION 'function % has unexpected owner %', function_signature, function_owner;
    END IF;
    IF NOT function_check.security_definer THEN
      RAISE EXCEPTION 'function % is not SECURITY DEFINER', function_signature;
    END IF;
    IF NOT coalesce(
      function_check.configuration @> ARRAY['search_path=pg_catalog, pg_temp'],
      false
    ) THEN
      RAISE EXCEPTION 'function % does not fix its search_path', function_signature;
    END IF;
    IF public_can_execute THEN
      RAISE EXCEPTION 'PUBLIC can execute capability function %', function_signature;
    END IF;
  END LOOP;

  -- Every login role must execute exactly its own capability functions and
  -- none of the others: a full cross-execution matrix, not spot checks.
  FOR audited_role IN
    SELECT unnest(ARRAY[
      'digital_footprint_runtime',
      'digital_footprint_maintenance',
      'digital_footprint_rotation',
      'digital_footprint_lookup_rotation',
      'digital_footprint_delivery'
    ])
  LOOP
    FOR function_signature, expected_privilege IN
      SELECT
        signature,
        (
          (
            audited_role = 'digital_footprint_runtime'
            AND signature = ANY(ARRAY[
              'public.consume_action_rate_limit(text,text,public.rate_limit_action)',
              'public.consume_action_rate_limit_dual(text,text,text,text,public.rate_limit_action)',
              'public.reserve_provider_usage(uuid,text,text,text,integer,integer,integer,integer,integer,integer)',
              'public.complete_provider_usage(uuid,public.provider_usage_state,integer)',
              'public.release_provider_usage(uuid)',
              'public.claim_breach_scan_jobs(timestamptz,integer,integer,text,uuid)'
            ])
          )
          OR (
            audited_role = 'digital_footprint_maintenance'
            AND signature = 'public.run_retention_maintenance(timestamptz,integer,timestamptz,timestamptz)'
          )
          OR (
            audited_role = 'digital_footprint_rotation'
            AND signature = ANY(ARRAY[
              'public.list_identifier_envelopes_for_rewrap(text,integer)',
              'public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)'
            ])
          )
          OR (
            audited_role = 'digital_footprint_lookup_rotation'
            AND signature = ANY(ARRAY[
              'public.backfill_identifier_lookup_tokens(text,integer)',
              'public.list_identifiers_missing_lookup_token(text,integer)',
              'public.insert_identifier_lookup_token_for_rotation(uuid,uuid,public.identifier_type,text,text,text,text,jsonb,text)'
            ])
          )
          OR (
            audited_role = 'digital_footprint_delivery'
            AND signature = ANY(ARRAY[
              'public.claim_verification_deliveries(timestamptz,integer,integer,text)',
              'public.complete_verification_delivery(timestamptz,uuid,text)',
              'public.report_verification_delivery_failure(timestamptz,uuid,text,text,integer)'
            ])
          )
        )
      FROM (
        VALUES
          ('public.consume_action_rate_limit(text,text,public.rate_limit_action)'),
          ('public.consume_action_rate_limit_dual(text,text,text,text,public.rate_limit_action)'),
          ('public.run_retention_maintenance(timestamptz,integer,timestamptz,timestamptz)'),
          ('public.list_identifier_envelopes_for_rewrap(text,integer)'),
          ('public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)'),
          ('public.backfill_identifier_lookup_tokens(text,integer)'),
          ('public.list_identifiers_missing_lookup_token(text,integer)'),
          (
            'public.insert_identifier_lookup_token_for_rotation(uuid,uuid,public.identifier_type,text,text,text,text,jsonb,text)'
          ),
          ('public.claim_verification_deliveries(timestamptz,integer,integer,text)'),
          ('public.complete_verification_delivery(timestamptz,uuid,text)'),
          ('public.report_verification_delivery_failure(timestamptz,uuid,text,text,integer)'),
          (
            'public.reserve_provider_usage(uuid,text,text,text,integer,integer,integer,integer,integer,integer)'
          ),
          ('public.complete_provider_usage(uuid,public.provider_usage_state,integer)'),
          ('public.release_provider_usage(uuid)'),
          ('public.claim_breach_scan_jobs(timestamptz,integer,integer,text,uuid)')
      ) AS all_functions(signature)
    LOOP
      actual_privilege := pg_catalog.has_function_privilege(
        audited_role,
        function_signature,
        'EXECUTE'
      );
      IF actual_privilege <> expected_privilege THEN
        RAISE EXCEPTION 'unexpected EXECUTE privilege for role % on % (expected %, found %)',
          audited_role,
          function_signature,
          expected_privilege,
          actual_privilege;
      END IF;
    END LOOP;
  END LOOP;
END
$verify$;

SELECT 'database authorization boundaries verified' AS result;

ROLLBACK;
