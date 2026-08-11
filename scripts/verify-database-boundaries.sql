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
  public_can_execute boolean;
BEGIN
  FOR audited_role, expected_login, expected_bypass IN
    SELECT *
    FROM (VALUES
      ('digital_footprint_runtime', true, false),
      ('digital_footprint_maintenance', true, false),
      ('digital_footprint_rotation', true, false),
      ('digital_footprint_rate_limit_owner', false, true),
      ('digital_footprint_retention_owner', false, true),
      ('digital_footprint_rotation_owner', false, true)
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
      'digital_footprint_rotation'
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
    'identifier_verifications',
    'consent_records',
    'audit_events',
    'deletion_receipts',
    'rate_limit_windows'
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
      'digital_footprint_rate_limit_owner',
      'digital_footprint_retention_owner',
      'digital_footprint_rotation_owner'
    ]) THEN
      RAISE EXCEPTION 'protected table public.% has a restricted or capability role as owner', audited_table;
    END IF;

    IF audited_table = 'rate_limit_windows' THEN
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy AS policy
        INNER JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
        INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' AND relation.relname = audited_table
      ) THEN
        RAISE EXCEPTION 'public.rate_limit_windows must remain function-only without an RLS policy';
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

  FOR audited_role IN
    SELECT unnest(ARRAY[
      'digital_footprint_runtime',
      'digital_footprint_maintenance',
      'digital_footprint_rotation',
      'digital_footprint_rate_limit_owner',
      'digital_footprint_retention_owner',
      'digital_footprint_rotation_owner'
    ])
  LOOP
    FOREACH audited_table IN ARRAY ARRAY[
      'users',
      'identities',
      'identifiers',
      'identifier_verifications',
      'consent_records',
      'audit_events',
      'deletion_receipts',
      'rate_limit_windows'
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
            AND audited_privilege = ANY(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
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
            AND audited_table = ANY(ARRAY['deletion_receipts', 'audit_events', 'rate_limit_windows'])
            AND audited_privilege = ANY(ARRAY['SELECT', 'UPDATE', 'DELETE'])
          )
          OR (
            audited_role = 'digital_footprint_rotation_owner'
            AND audited_table = 'identifiers'
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
        'public.run_retention_maintenance(timestamptz,integer,timestamptz)',
        'digital_footprint_retention_owner'
      ),
      (
        'public.list_identifier_envelopes_for_rewrap(text,integer)',
        'digital_footprint_rotation_owner'
      ),
      (
        'public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)',
        'digital_footprint_rotation_owner'
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

  IF NOT pg_catalog.has_function_privilege(
    'digital_footprint_runtime',
    'public.consume_action_rate_limit(text,text,public.rate_limit_action)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime role cannot execute the rate-limit capability';
  END IF;
  IF pg_catalog.has_function_privilege(
    'digital_footprint_runtime',
    'public.run_retention_maintenance(timestamptz,integer,timestamptz)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'digital_footprint_runtime',
    'public.list_identifier_envelopes_for_rewrap(text,integer)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'digital_footprint_runtime',
    'public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'runtime role can execute a maintenance or rotation capability';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'digital_footprint_maintenance',
    'public.run_retention_maintenance(timestamptz,integer,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'maintenance role cannot execute the retention capability';
  END IF;
  IF pg_catalog.has_function_privilege(
    'digital_footprint_maintenance',
    'public.consume_action_rate_limit(text,text,public.rate_limit_action)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'digital_footprint_maintenance',
    'public.list_identifier_envelopes_for_rewrap(text,integer)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'digital_footprint_maintenance',
    'public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'maintenance role can execute a runtime or rotation capability';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'digital_footprint_rotation',
    'public.list_identifier_envelopes_for_rewrap(text,integer)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'digital_footprint_rotation',
    'public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'rotation role lacks a required rewrap capability';
  END IF;
  IF pg_catalog.has_function_privilege(
    'digital_footprint_rotation',
    'public.consume_action_rate_limit(text,text,public.rate_limit_action)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'digital_footprint_rotation',
    'public.run_retention_maintenance(timestamptz,integer,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'rotation role can execute a runtime or maintenance capability';
  END IF;
END
$verify$;

SELECT 'database authorization boundaries verified' AS result;

ROLLBACK;
