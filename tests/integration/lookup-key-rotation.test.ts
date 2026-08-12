import { resetServerEnvForTests } from "@/config/server-env";
import { createAccountIfMissing } from "@/core/account-service";
import { addEmailIdentifier } from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import { identifierLookupTokens, identifiers, users } from "@/database/schema";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { createLookupToken } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { createLookupKeyring } from "@/security/lookup-keyring";
import { migrateLookupTokenBatch } from "@/security/lookup-rotation-service";
import { and, eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const testLookupRotationDatabaseUrl = process.env.TEST_LOOKUP_ROTATION_DATABASE_URL;
if (
  process.env.REQUIRE_DATABASE_TESTS === "1" &&
  (!testDatabaseUrl || !testRuntimeDatabaseUrl || !testLookupRotationDatabaseUrl)
) {
  throw new Error(
    "TEST_DATABASE_URL, TEST_RUNTIME_DATABASE_URL, and TEST_LOOKUP_ROTATION_DATABASE_URL are required for lookup-key rotation integration tests",
  );
}
const describeWithDatabase =
  testDatabaseUrl && testRuntimeDatabaseUrl && testLookupRotationDatabaseUrl
    ? describe
    : describe.skip;

describeWithDatabase("bounded lookup-token rotation worker", () => {
  const testRunId = Date.now();
  const sourceKeyId = `lookup-rotation-source-${testRunId}`;
  const targetKeyId = `lookup-rotation-target-${testRunId}`;
  const principals: AuthenticatedPrincipal[] = [
    { subject: `lookup_rotation_subject_a_${testRunId}`, mode: "local" },
    { subject: `lookup_rotation_subject_b_${testRunId}`, mode: "local" },
  ];
  const allTestSubjects = [
    ...principals.map((principal) => principal.subject),
    `lookup_rotation_edgecases_${testRunId}`,
  ];
  const lookupRotationSql = postgres(testLookupRotationDatabaseUrl!, { max: 1, prepare: false });

  beforeAll(() => {
    // process.env is a shared global; another concurrently running
    // integration test file may have left a previous lookup key set. This
    // suite intentionally exercises single-key behavior, so start clean.
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.LOOKUP_ROTATION_DATABASE_URL = testLookupRotationDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = principals[0].subject;
    process.env.ENCRYPTION_KEY_ID = "lookup-rotation-envelope-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 109).toString("base64");
    process.env.LOOKUP_KEY_ID = sourceKeyId;
    process.env.LOOKUP_KEY = Buffer.alloc(32, 113).toString("base64");
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();
  });

  afterAll(async () => {
    await getDatabase().delete(users).where(inArray(users.authSubject, allTestSubjects));
    await lookupRotationSql.end({ timeout: 5 });
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("keeps the lookup-rotation login function-only and validates database inputs", async () => {
    const [capabilities] = await lookupRotationSql<
      {
        currentUser: string;
        superuser: boolean;
        bypassRls: boolean;
        canReadIdentifiers: boolean;
        canReadLookupTokens: boolean;
        canList: boolean;
        canInsert: boolean;
        runtimeCanList: boolean;
        runtimeCanInsert: boolean;
      }[]
    >`
      select
        current_user as "currentUser",
        role.rolsuper as superuser,
        role.rolbypassrls as "bypassRls",
        has_table_privilege(current_user, 'public.identifiers', 'SELECT') as "canReadIdentifiers",
        has_table_privilege(
          current_user, 'public.identifier_lookup_tokens', 'SELECT'
        ) as "canReadLookupTokens",
        has_function_privilege(
          current_user,
          'public.list_identifiers_missing_lookup_token(text,integer)',
          'EXECUTE'
        ) as "canList",
        has_function_privilege(
          current_user,
          'public.insert_identifier_lookup_token_for_rotation(uuid,uuid,identifier_type,text,text,text,text,jsonb,text)',
          'EXECUTE'
        ) as "canInsert",
        has_function_privilege(
          'digital_footprint_runtime',
          'public.list_identifiers_missing_lookup_token(text,integer)',
          'EXECUTE'
        ) as "runtimeCanList",
        has_function_privilege(
          'digital_footprint_runtime',
          'public.insert_identifier_lookup_token_for_rotation(uuid,uuid,identifier_type,text,text,text,text,jsonb,text)',
          'EXECUTE'
        ) as "runtimeCanInsert"
      from pg_roles as role
      where role.rolname = current_user
    `;
    expect(capabilities).toEqual({
      currentUser: "digital_footprint_lookup_rotation",
      superuser: false,
      bypassRls: false,
      canReadIdentifiers: false,
      canReadLookupTokens: false,
      canList: true,
      canInsert: true,
      runtimeCanList: false,
      runtimeCanInsert: false,
    });

    const functionOwners = await lookupRotationSql<{ canLogin: boolean; bypassRls: boolean }[]>`
      select owner.rolcanlogin as "canLogin", owner.rolbypassrls as "bypassRls"
      from pg_proc as procedure
      inner join pg_roles as owner on owner.oid = procedure.proowner
      where procedure.oid in (
        'public.list_identifiers_missing_lookup_token(text,integer)'::regprocedure,
        'public.insert_identifier_lookup_token_for_rotation(uuid,uuid,identifier_type,text,text,text,text,jsonb,text)'::regprocedure
      )
      order by procedure.proname
    `;
    expect(functionOwners).toEqual([
      { canLogin: false, bypassRls: true },
      { canLogin: false, bypassRls: true },
    ]);

    await expect(
      lookupRotationSql`select id from public.identifiers limit 1`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      lookupRotationSql`select * from public.list_identifiers_missing_lookup_token('source', 1002)`,
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("migrates identifiers to a new lookup key with dry-run, bounded batches, and restart-safety", async () => {
    const fixtures = await Promise.all(
      principals.map(async (principal, index) => {
        const account = await createAccountIfMissing(principal);
        const email = `lookup.rotation.fixture.${index}@example.test`;
        const added = await addEmailIdentifier(account, email);
        return { account, email, identifierId: added.identifierId };
      }),
    );
    const identifierIds = fixtures.map((fixture) => fixture.identifierId);

    const envelopeKeyring = getApplicationKeyring();
    const targetLookupKeyring = createLookupKeyring({
      keyId: targetKeyId,
      lookupKeyBase64: Buffer.alloc(32, 127).toString("base64"),
    });

    // `list_identifiers_missing_lookup_token` scans the whole table by
    // design (unlike the envelope-rewrap listing, which is naturally scoped
    // by a per-run-unique source key ID), so this integration suite's other
    // concurrently running files' identifiers are legitimate candidates too
    // (and, if encrypted under a different envelope key, legitimate
    // ENVELOPE_KEY_UNAVAILABLE conflicts). Assertions below therefore only
    // check this test's own fixtures, not global planned/migrated counts.
    async function runToCompletion(dryRun?: boolean) {
      let hasMore = true;
      for (let iteration = 0; hasMore; iteration += 1) {
        if (iteration >= 50) throw new Error("lookup-token migration did not converge");
        const result = await migrateLookupTokenBatch({
          envelopeKeyring,
          targetLookupKeyring,
          batchSize: 100,
          dryRun,
        });
        hasMore = result.hasMore;
        if (dryRun) break;
      }
    }

    await runToCompletion(true);
    const afterDryRun = await getDatabase()
      .select({ identifierId: identifierLookupTokens.identifierId })
      .from(identifierLookupTokens)
      .where(
        and(
          inArray(identifierLookupTokens.identifierId, identifierIds),
          eq(identifierLookupTokens.lookupKeyId, targetKeyId),
        ),
      );
    expect(afterDryRun).toHaveLength(0);

    await runToCompletion();

    const migratedRows = await getDatabase()
      .select({
        identifierId: identifierLookupTokens.identifierId,
        lookupKeyId: identifierLookupTokens.lookupKeyId,
        token: identifierLookupTokens.token,
      })
      .from(identifierLookupTokens)
      .where(inArray(identifierLookupTokens.identifierId, identifierIds));
    expect(migratedRows).toHaveLength(4);

    for (const fixture of fixtures) {
      const sourceRow = migratedRows.find(
        (row) => row.identifierId === fixture.identifierId && row.lookupKeyId === sourceKeyId,
      );
      const targetRow = migratedRows.find(
        (row) => row.identifierId === fixture.identifierId && row.lookupKeyId === targetKeyId,
      );
      expect(sourceRow?.token).toBe(
        createLookupToken(
          fixture.email,
          "identifier:email:v1",
          createLookupKeyring({
            keyId: sourceKeyId,
            lookupKeyBase64: Buffer.alloc(32, 113).toString("base64"),
          }),
        ),
      );
      expect(targetRow?.token).toBe(
        createLookupToken(fixture.email, "identifier:email:v1", targetLookupKeyring),
      );
    }

    // Restart-safety: rerunning against an already-migrated set never
    // creates a duplicate row for this test's fixtures.
    await runToCompletion();
    const afterRerun = await getDatabase()
      .select({ identifierId: identifierLookupTokens.identifierId })
      .from(identifierLookupTokens)
      .where(inArray(identifierLookupTokens.identifierId, identifierIds));
    expect(afterRerun).toHaveLength(4);
  });

  it("reports a stale envelope as an opaque conflict and a removed identifier as skipped", async () => {
    const account = await createAccountIfMissing({
      subject: `lookup_rotation_edgecases_${testRunId}`,
      mode: "local",
    });
    const conflictIdentifier = await addEmailIdentifier(account, "conflict.case@example.test");
    const deletedIdentifier = await addEmailIdentifier(account, "deleted.case@example.test");

    const conflictKeyId = `lookup-rotation-conflict-${testRunId}`;

    const [conflictCandidate] = await lookupRotationSql<
      { encryptedValue: unknown; normalizationVersion: string }[]
    >`
      select encrypted_value as "encryptedValue", normalization_version as "normalizationVersion"
      from public.list_identifiers_missing_lookup_token(${conflictKeyId}, 100)
      where identifier_id = ${conflictIdentifier.identifierId}
    `;
    expect(conflictCandidate).toBeDefined();

    // Simulate a concurrent envelope rewrap racing this rotation batch.
    await getDatabase()
      .update(identifiers)
      .set({
        encryptedValue: {
          ...(conflictCandidate.encryptedValue as Record<string, unknown>),
          wrappedDataKey: "mutated-between-list-and-insert",
        } as never,
      })
      .where(eq(identifiers.id, conflictIdentifier.identifierId));

    const [conflictStatus] = await lookupRotationSql<{ status: string }[]>`
      select public.insert_identifier_lookup_token_for_rotation(
        ${conflictIdentifier.identifierId}::uuid,
        ${account.identityId}::uuid,
        'EMAIL'::public.identifier_type,
        'identifier:email:v1',
        ${conflictCandidate.normalizationVersion},
        ${conflictKeyId},
        ${Buffer.alloc(32, 131).toString("base64url").slice(0, 43)},
        ${JSON.stringify(conflictCandidate.encryptedValue)}::jsonb,
        ${conflictCandidate.normalizationVersion}
      ) as status
    `;
    expect(conflictStatus.status).toBe("ENVELOPE_CHANGED");
    const conflictRows = await getDatabase()
      .select({ identifierId: identifierLookupTokens.identifierId })
      .from(identifierLookupTokens)
      .where(
        and(
          eq(identifierLookupTokens.identifierId, conflictIdentifier.identifierId),
          eq(identifierLookupTokens.lookupKeyId, conflictKeyId),
        ),
      );
    expect(conflictRows).toHaveLength(0);

    const [deletedCandidate] = await lookupRotationSql<
      { encryptedValue: unknown; normalizationVersion: string }[]
    >`
      select encrypted_value as "encryptedValue", normalization_version as "normalizationVersion"
      from public.list_identifiers_missing_lookup_token(${conflictKeyId}, 100)
      where identifier_id = ${deletedIdentifier.identifierId}
    `;
    await getDatabase()
      .delete(identifiers)
      .where(eq(identifiers.id, deletedIdentifier.identifierId));

    const [deletedStatus] = await lookupRotationSql<{ status: string }[]>`
      select public.insert_identifier_lookup_token_for_rotation(
        ${deletedIdentifier.identifierId}::uuid,
        ${account.identityId}::uuid,
        'EMAIL'::public.identifier_type,
        'identifier:email:v1',
        ${deletedCandidate.normalizationVersion},
        ${conflictKeyId},
        ${Buffer.alloc(32, 137).toString("base64url").slice(0, 43)},
        ${JSON.stringify(deletedCandidate.encryptedValue)}::jsonb,
        ${deletedCandidate.normalizationVersion}
      ) as status
    `;
    expect(deletedStatus.status).toBe("DELETED");
  });
});
