import { createAccountIfMissing } from "@/core/account-service";
import { addEmailIdentifier } from "@/core/identifier-service";
import { resetServerEnvForTests } from "@/config/server-env";
import { closeDatabase, getDatabase } from "@/database/client";
import { identifierLookupTokens } from "@/database/schema";
import { createLookupToken } from "@/security/crypto";
import { createLookupKeyring } from "@/security/lookup-keyring";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.REQUIRE_DATABASE_TESTS === "1" && (!testDatabaseUrl || !testRuntimeDatabaseUrl)) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required for lookup-key rotation identifier tests",
  );
}
const describeWithDatabase = testDatabaseUrl && testRuntimeDatabaseUrl ? describe : describe.skip;

describeWithDatabase("identifier lookup tokens across a lookup-key rotation", () => {
  const testRunId = Date.now();
  const currentKeyId = "identifiers-lookup-rotation-current-v1";
  const currentKeyBase64 = Buffer.alloc(32, 101).toString("base64");
  const previousKeyId = "identifiers-lookup-rotation-previous-v1";
  const previousKeyBase64 = Buffer.alloc(32, 103).toString("base64");

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = `identifiers_lookup_rotation_${testRunId}`;
    process.env.ENCRYPTION_KEY_ID = "identifiers-lookup-rotation-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 107).toString("base64");
    process.env.LOOKUP_KEY_ID = currentKeyId;
    process.env.LOOKUP_KEY = currentKeyBase64;
    process.env.PREVIOUS_LOOKUP_KEY_ID = previousKeyId;
    process.env.PREVIOUS_LOOKUP_KEY = previousKeyBase64;
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();
  });

  afterAll(async () => {
    await closeDatabase();
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    resetServerEnvForTests();
  });

  it("writes one token row per active lookup key in the same transaction", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `identifiers_lookup_rotation_owner_${testRunId}`,
      mode: "local",
    };
    const account = await createAccountIfMissing(principal);
    const created = await addEmailIdentifier(account, "dual.write@example.test");

    const rows = await getDatabase()
      .select({
        lookupKeyId: identifierLookupTokens.lookupKeyId,
        token: identifierLookupTokens.token,
        namespace: identifierLookupTokens.namespace,
      })
      .from(identifierLookupTokens)
      .where(eq(identifierLookupTokens.identifierId, created.identifierId));

    expect(rows.every((row) => row.namespace === "identifier:email:v1")).toBe(true);

    const currentKeyring = createLookupKeyring({
      keyId: currentKeyId,
      lookupKeyBase64: currentKeyBase64,
    });
    const previousKeyring = createLookupKeyring({
      keyId: previousKeyId,
      lookupKeyBase64: previousKeyBase64,
    });
    const expectedCurrentToken = createLookupToken(
      "dual.write@example.test",
      "identifier:email:v1",
      currentKeyring,
    );
    const expectedPreviousToken = createLookupToken(
      "dual.write@example.test",
      "identifier:email:v1",
      previousKeyring,
    );

    const byKeyId = new Map(rows.map((row) => [row.lookupKeyId, row.token]));
    // The global lookup-rotation integration worker may concurrently add its
    // own target-key row. This test owns only the two active application keys
    // and verifies that both were written atomically and exactly once.
    expect(
      rows.filter((row) => [currentKeyId, previousKeyId].includes(row.lookupKeyId)),
    ).toHaveLength(2);
    expect(byKeyId.get(currentKeyId)).toBe(expectedCurrentToken);
    expect(byKeyId.get(previousKeyId)).toBe(expectedPreviousToken);
  });

  it("rejects a duplicate enrollment recognized under either active key", async () => {
    const ownerPrincipal: AuthenticatedPrincipal = {
      subject: `identifiers_lookup_rotation_dup_owner_${testRunId}`,
      mode: "local",
    };
    const account = await createAccountIfMissing(ownerPrincipal);
    await addEmailIdentifier(account, "duplicate.check@example.test");

    await expect(addEmailIdentifier(account, "Duplicate.Check@Example.Test")).rejects.toThrow();
  });
});
