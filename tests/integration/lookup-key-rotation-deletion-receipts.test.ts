import { randomUUID } from "node:crypto";
import { createAccountIfMissing } from "@/core/account-service";
import { resetServerEnvForTests } from "@/config/server-env";
import { closeDatabase, getDatabase } from "@/database/client";
import { deletionReceipts, users } from "@/database/schema";
import { deletionSubjectTokens } from "@/database/tenant";
import { deleteAccount, resumeAccountDeletionAfterAuthRevoked } from "@/privacy/deletion-service";
import type { AuthGateway, AuthenticatedPrincipal } from "@/security/auth";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.REQUIRE_DATABASE_TESTS === "1" && (!testDatabaseUrl || !testRuntimeDatabaseUrl)) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required for lookup-key rotation deletion-receipt tests",
  );
}
const describeWithDatabase = testDatabaseUrl && testRuntimeDatabaseUrl ? describe : describe.skip;

describeWithDatabase("deletion receipts across a lookup-key rotation", () => {
  const testRunId = Date.now();
  const receiptIds: string[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = `lookup_rotation_receipts_${testRunId}`;
    process.env.ENCRYPTION_KEY_ID = "lookup-rotation-receipts-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 83).toString("base64");
    process.env.LOOKUP_KEY_ID = "lookup-rotation-receipts-current-v1";
    process.env.LOOKUP_KEY = Buffer.alloc(32, 89).toString("base64");
    process.env.PREVIOUS_LOOKUP_KEY_ID = "lookup-rotation-receipts-previous-v1";
    process.env.PREVIOUS_LOOKUP_KEY = Buffer.alloc(32, 97).toString("base64");
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();
  });

  afterAll(async () => {
    if (receiptIds.length > 0) {
      await getDatabase().delete(deletionReceipts).where(inArray(deletionReceipts.id, receiptIds));
    }
    await closeDatabase();
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    resetServerEnvForTests();
  });

  it("migrates a previous-key receipt in place instead of creating a duplicate", async () => {
    const subject = `lookup_rotation_migrate_${testRunId}`;
    const principal: AuthenticatedPrincipal = { subject, mode: "local" };
    const account = await createAccountIfMissing(principal);
    const tokens = deletionSubjectTokens(subject);
    if (!tokens.previous) throw new Error("test requires a configured previous lookup key");

    const preExistingReceiptId = randomUUID();
    receiptIds.push(preExistingReceiptId);
    await getDatabase()
      .insert(deletionReceipts)
      .values({
        id: preExistingReceiptId,
        subjectToken: tokens.previous.token,
        subjectTokenKeyId: tokens.previous.keyId,
        state: "FAILED",
        failureCode: "AUTH_PROVIDER_DELETE_FAILED",
        expiresAt: new Date(Date.now() + 86_400_000),
      });

    const localGateway: AuthGateway = {
      async currentPrincipal() {
        return principal;
      },
      async deletePrincipal() {
        // Succeeds; no external state to simulate.
      },
    };
    const result = await deleteAccount(principal, localGateway, { recentlyReauthenticated: true });

    // Exactly one receipt row should exist for this subject across both keys.
    const rows = await getDatabase()
      .select({
        id: deletionReceipts.id,
        subjectToken: deletionReceipts.subjectToken,
        subjectTokenKeyId: deletionReceipts.subjectTokenKeyId,
        state: deletionReceipts.state,
      })
      .from(deletionReceipts)
      .where(inArray(deletionReceipts.subjectToken, [tokens.current.token, tokens.previous.token]));

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(preExistingReceiptId);
    expect(rows[0].subjectToken).toBe(tokens.current.token);
    expect(rows[0].subjectTokenKeyId).toBe(tokens.current.keyId);
    expect(rows[0].state).toBe("COMPLETED");
    expect(result.receiptId).toBe(preExistingReceiptId);

    const remainingUsers = await getDatabase()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, account.userId));
    expect(remainingUsers).toHaveLength(0);
  });

  it("leaves a completed previous-key receipt untouched on idempotent webhook replay", async () => {
    const subject = `lookup_rotation_completed_${testRunId}`;
    const tokens = deletionSubjectTokens(subject);
    if (!tokens.previous) throw new Error("test requires a configured previous lookup key");

    const completedReceiptId = randomUUID();
    receiptIds.push(completedReceiptId);
    const completedAt = new Date(Date.now() - 3_600_000);
    await getDatabase()
      .insert(deletionReceipts)
      .values({
        id: completedReceiptId,
        subjectToken: tokens.previous.token,
        subjectTokenKeyId: tokens.previous.keyId,
        state: "COMPLETED",
        completedAt,
        expiresAt: new Date(Date.now() + 86_400_000),
      });

    // No local `users` row exists for this subject: this exercises the
    // idempotent-webhook/no-user branch, which must be read-only.
    const first = await resumeAccountDeletionAfterAuthRevoked(subject);
    const second = await resumeAccountDeletionAfterAuthRevoked(subject);
    expect(first.receiptId).toBe(completedReceiptId);
    expect(second.receiptId).toBe(completedReceiptId);

    const [row] = await getDatabase()
      .select({
        subjectToken: deletionReceipts.subjectToken,
        subjectTokenKeyId: deletionReceipts.subjectTokenKeyId,
        state: deletionReceipts.state,
        completedAt: deletionReceipts.completedAt,
      })
      .from(deletionReceipts)
      .where(eq(deletionReceipts.id, completedReceiptId));

    // Untouched: still under the previous key, completedAt unchanged.
    expect(row.subjectToken).toBe(tokens.previous.token);
    expect(row.subjectTokenKeyId).toBe(tokens.previous.keyId);
    expect(row.state).toBe("COMPLETED");
    expect(row.completedAt?.getTime()).toBe(completedAt.getTime());
  });

  it("fails closed when neither subject-token setting is present", async () => {
    const subject = `lookup_rotation_failclosed_${testRunId}`;
    const tokens = deletionSubjectTokens(subject);
    const receiptId = randomUUID();
    receiptIds.push(receiptId);
    await getDatabase()
      .insert(deletionReceipts)
      .values({
        id: receiptId,
        subjectToken: tokens.current.token,
        subjectTokenKeyId: tokens.current.keyId,
        state: "COMPLETED",
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });

    const runtimeSql = postgres(testRuntimeDatabaseUrl!, { max: 1, prepare: false });
    try {
      const visible = await runtimeSql.begin(async (transaction) => {
        await transaction`
          select
            set_config('app.auth_subject', '', true),
            set_config('app.subject_token', '', true),
            set_config('app.subject_token_previous', '', true)
        `;
        return transaction<{ id: string }[]>`
          select id from deletion_receipts where id = ${receiptId}
        `;
      });
      expect(visible).toHaveLength(0);
    } finally {
      await runtimeSql.end({ timeout: 5 });
    }
  });
});
