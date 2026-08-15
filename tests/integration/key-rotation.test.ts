import { resetServerEnvForTests } from "@/config/server-env";
import { createAccountIfMissing } from "@/core/account-service";
import { addEmailIdentifier } from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import { identifiers, users } from "@/database/schema";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { createKeyring, decryptSensitiveValue, type EncryptedEnvelope } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { rewrapIdentifierBatch } from "@/security/key-rotation-service";
import { inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const testRotationDatabaseUrl = process.env.TEST_ROTATION_DATABASE_URL;
if (
  process.env.REQUIRE_DATABASE_TESTS === "1" &&
  (!testDatabaseUrl || !testRuntimeDatabaseUrl || !testRotationDatabaseUrl)
) {
  throw new Error(
    "TEST_DATABASE_URL, TEST_RUNTIME_DATABASE_URL, and TEST_ROTATION_DATABASE_URL are required for key-rotation integration tests",
  );
}
const describeWithDatabase =
  testDatabaseUrl && testRuntimeDatabaseUrl && testRotationDatabaseUrl ? describe : describe.skip;

describeWithDatabase("bounded identifier envelope rewrap", () => {
  const testRunId = Date.now();
  const sourceKeyId = `rotation-source-${testRunId}`;
  const targetKeyId = `rotation-target-${testRunId}`;
  const principals: AuthenticatedPrincipal[] = [
    { subject: `rotation_subject_a_${testRunId}`, mode: "local" },
    { subject: `rotation_subject_b_${testRunId}`, mode: "local" },
  ];
  const rotationSql = postgres(testRotationDatabaseUrl!, { max: 1, prepare: false });

  beforeAll(() => {
    // process.env is a shared global; another concurrently running
    // integration test file may have left a previous lookup key set.
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.ROTATION_DATABASE_URL = testRotationDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = principals[0].subject;
    process.env.ENCRYPTION_KEY_ID = sourceKeyId;
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 71).toString("base64");
    process.env.LOOKUP_KEY = Buffer.alloc(32, 73).toString("base64");
    process.env.LOOKUP_KEY_ID = "key-rotation-lookup-v1";
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();
  });

  afterAll(async () => {
    await getDatabase()
      .delete(users)
      .where(
        inArray(
          users.authSubject,
          principals.map((principal) => principal.subject),
        ),
      );
    await rotationSql.end({ timeout: 5 });
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("keeps the rotation login function-only and validates database inputs", async () => {
    const [capabilities] = await rotationSql<
      {
        currentUser: string;
        superuser: boolean;
        bypassRls: boolean;
        canReadIdentifiers: boolean;
        canList: boolean;
        canReplace: boolean;
        runtimeCanList: boolean;
        runtimeCanReplace: boolean;
      }[]
    >`
      select
        current_user as "currentUser",
        role.rolsuper as superuser,
        role.rolbypassrls as "bypassRls",
        has_table_privilege(current_user, 'public.identifiers', 'SELECT') as "canReadIdentifiers",
        has_function_privilege(
          current_user,
          'public.list_identifier_envelopes_for_rewrap(text,integer)',
          'EXECUTE'
        ) as "canList",
        has_function_privilege(
          current_user,
          'public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)',
          'EXECUTE'
        ) as "canReplace",
        has_function_privilege(
          'digital_footprint_runtime',
          'public.list_identifier_envelopes_for_rewrap(text,integer)',
          'EXECUTE'
        ) as "runtimeCanList",
        has_function_privilege(
          'digital_footprint_runtime',
          'public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)',
          'EXECUTE'
        ) as "runtimeCanReplace"
      from pg_roles as role
      where role.rolname = current_user
    `;
    expect(capabilities).toEqual({
      currentUser: "digital_footprint_rotation",
      superuser: false,
      bypassRls: false,
      canReadIdentifiers: false,
      canList: true,
      canReplace: true,
      runtimeCanList: false,
      runtimeCanReplace: false,
    });

    const functionOwners = await rotationSql<{ canLogin: boolean; bypassRls: boolean }[]>`
      select owner.rolcanlogin as "canLogin", owner.rolbypassrls as "bypassRls"
      from pg_proc as procedure
      inner join pg_roles as owner on owner.oid = procedure.proowner
      where procedure.oid in (
        'public.list_identifier_envelopes_for_rewrap(text,integer)'::regprocedure,
        'public.replace_identifier_envelope_for_rewrap(uuid,jsonb,jsonb,text,text)'::regprocedure
      )
      order by procedure.proname
    `;
    expect(functionOwners).toEqual([
      { canLogin: false, bypassRls: false },
      { canLogin: false, bypassRls: false },
    ]);

    await expect(rotationSql`select id from public.identifiers limit 1`).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      rotationSql`select * from public.list_identifier_envelopes_for_rewrap('source', 1002)`,
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("supports dry-run, interruption recovery, and rollback without changing ciphertext", async () => {
    const fixtures = await Promise.all(
      principals.map(async (principal, index) => {
        const account = await createAccountIfMissing(principal);
        const email = `rotation.fixture.${index}@example.test`;
        const added = await addEmailIdentifier(account, email);
        return { account, email, identifierId: added.identifierId };
      }),
    );
    const identifierIds = fixtures.map((fixture) => fixture.identifierId);
    const beforeRows = await getDatabase()
      .select({ id: identifiers.id, encryptedValue: identifiers.encryptedValue })
      .from(identifiers)
      .where(inArray(identifiers.id, identifierIds));
    const before = new Map<string, EncryptedEnvelope>(
      beforeRows.map((row) => [row.id, row.encryptedValue]),
    );
    const sourceKeyring = getApplicationKeyring();
    const targetKeyring = createKeyring({
      keyId: targetKeyId,
      encryptionKeyBase64: Buffer.alloc(32, 79).toString("base64"),
      lookupKeyBase64: Buffer.alloc(32, 73).toString("base64"),
    });

    await expect(
      rewrapIdentifierBatch({
        currentKeyring: sourceKeyring,
        nextKeyring: targetKeyring,
        batchSize: 1,
        dryRun: true,
      }),
    ).resolves.toEqual({
      dryRun: true,
      planned: 1,
      rewrapped: 0,
      conflicts: 0,
      hasMore: true,
    });
    const afterDryRun = await getDatabase()
      .select({ encryptedValue: identifiers.encryptedValue })
      .from(identifiers)
      .where(inArray(identifiers.id, identifierIds));
    expect(afterDryRun.every((row) => row.encryptedValue.keyId === sourceKeyId)).toBe(true);

    await expect(
      rewrapIdentifierBatch({
        currentKeyring: sourceKeyring,
        nextKeyring: targetKeyring,
        batchSize: 1,
      }),
    ).resolves.toEqual({
      dryRun: false,
      planned: 1,
      rewrapped: 1,
      conflicts: 0,
      hasMore: true,
    });
    await expect(
      rewrapIdentifierBatch({
        currentKeyring: sourceKeyring,
        nextKeyring: targetKeyring,
        batchSize: 100,
      }),
    ).resolves.toEqual({
      dryRun: false,
      planned: 1,
      rewrapped: 1,
      conflicts: 0,
      hasMore: false,
    });

    const rotatedRows = await getDatabase()
      .select({ id: identifiers.id, encryptedValue: identifiers.encryptedValue })
      .from(identifiers)
      .where(inArray(identifiers.id, identifierIds));
    for (const row of rotatedRows) {
      const original = before.get(row.id)!;
      expect(row.encryptedValue.keyId).toBe(targetKeyId);
      expect(row.encryptedValue.ciphertext).toBe(original.ciphertext);
      expect(row.encryptedValue.nonce).toBe(original.nonce);
      expect(row.encryptedValue.authTag).toBe(original.authTag);
      expect(row.encryptedValue.wrappedDataKey).not.toBe(original.wrappedDataKey);
      const fixture = fixtures.find((candidate) => candidate.identifierId === row.id)!;
      expect(
        decryptSensitiveValue(
          row.encryptedValue,
          `identifier:${fixture.account.identityId}:${row.id}:value:v1`,
          targetKeyring,
        ),
      ).toBe(fixture.email);
    }

    await expect(
      rewrapIdentifierBatch({
        currentKeyring: targetKeyring,
        nextKeyring: sourceKeyring,
        batchSize: 100,
      }),
    ).resolves.toEqual({
      dryRun: false,
      planned: 2,
      rewrapped: 2,
      conflicts: 0,
      hasMore: false,
    });
    const rolledBackRows = await getDatabase()
      .select({ id: identifiers.id, encryptedValue: identifiers.encryptedValue })
      .from(identifiers)
      .where(inArray(identifiers.id, identifierIds));
    expect(rolledBackRows.every((row) => row.encryptedValue.keyId === sourceKeyId)).toBe(true);
  });
});
