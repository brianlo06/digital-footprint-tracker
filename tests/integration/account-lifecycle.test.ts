import { createAccountIfMissing, findAccount } from "@/core/account-service";
import {
  addEmailIdentifier,
  listIdentifiers,
  verifyEmailIdentifier,
} from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import {
  consentRecords,
  deletionReceipts,
  identifiers,
  identifierVerifications,
  users,
} from "@/database/schema";
import { deleteAccount } from "@/privacy/deletion-service";
import type { AuthGateway, AuthenticatedPrincipal } from "@/security/auth";
import { createLookupToken } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { resetServerEnvForTests } from "@/config/server-env";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.REQUIRE_DATABASE_TESTS === "1" && (!testDatabaseUrl || !testRuntimeDatabaseUrl)) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required for the integration test command",
  );
}
const describeWithDatabase = testDatabaseUrl && testRuntimeDatabaseUrl ? describe : describe.skip;

describeWithDatabase("synthetic account lifecycle", () => {
  const testRunId = Date.now();
  const principal: AuthenticatedPrincipal = {
    subject: `integration_subject_${testRunId}`,
    mode: "local",
  };

  const authGateway: AuthGateway = {
    async currentPrincipal() {
      return principal;
    },
    async deletePrincipal() {
      // The local development authentication mode has no external state.
    },
  };

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = principal.subject;
    process.env.ENCRYPTION_KEY_ID = "integration-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
    process.env.LOOKUP_KEY = Buffer.alloc(32, 29).toString("base64");
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();
  });

  afterAll(async () => {
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("creates, encrypts, verifies, and completely deletes a synthetic identifier", async () => {
    const concurrentAccounts = await Promise.all([
      createAccountIfMissing(principal),
      createAccountIfMissing(principal),
      createAccountIfMissing(principal),
    ]);
    const [account] = concurrentAccounts;
    expect(concurrentAccounts.every((candidate) => candidate.userId === account.userId)).toBe(true);
    expect(
      concurrentAccounts.every((candidate) => candidate.identityId === account.identityId),
    ).toBe(true);
    const created = await addEmailIdentifier(account, "Synthetic.Person@Example.Test");

    const [stored] = await getDatabase()
      .select({
        encryptedValue: identifiers.encryptedValue,
        maskedDisplay: identifiers.maskedDisplay,
        verificationStatus: identifiers.verificationStatus,
      })
      .from(identifiers)
      .where(eq(identifiers.id, created.identifierId));

    expect(JSON.stringify(stored.encryptedValue)).not.toContain("synthetic.person@example.test");
    expect(stored.maskedDisplay).toBe("s***@***.test");
    expect(stored.verificationStatus).toBe("PENDING");

    await verifyEmailIdentifier(account, created.verificationId, "000000");
    const [verified] = await getDatabase()
      .select({ status: identifiers.verificationStatus })
      .from(identifiers)
      .where(eq(identifiers.id, created.identifierId));
    expect(verified.status).toBe("VERIFIED");

    const result = await deleteAccount(principal, authGateway, {
      recentlyReauthenticated: true,
    });
    const [receipt] = await getDatabase()
      .select({ state: deletionReceipts.state })
      .from(deletionReceipts)
      .where(eq(deletionReceipts.id, result.receiptId));
    expect(receipt.state).toBe("COMPLETED");

    const remainingUsers = await getDatabase()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, account.userId));
    const remainingIdentifiers = await getDatabase()
      .select({ id: identifiers.id })
      .from(identifiers)
      .where(eq(identifiers.identityId, account.identityId));
    const remainingVerifications = await getDatabase()
      .select({ id: identifierVerifications.id })
      .from(identifierVerifications)
      .where(eq(identifierVerifications.identifierId, created.identifierId));
    const remainingConsent = await getDatabase()
      .select({ id: consentRecords.id })
      .from(consentRecords)
      .where(eq(consentRecords.userId, account.userId));

    expect(remainingUsers).toHaveLength(0);
    expect(remainingIdentifiers).toHaveLength(0);
    expect(remainingVerifications).toHaveLength(0);
    expect(remainingConsent).toHaveLength(0);
  });

  it("denies cross-account identifier access and verification", async () => {
    const ownerPrincipal: AuthenticatedPrincipal = {
      subject: `integration_owner_${testRunId}`,
      mode: "local",
    };
    const otherPrincipal: AuthenticatedPrincipal = {
      subject: `integration_other_${testRunId}`,
      mode: "local",
    };
    const owner = await createAccountIfMissing(ownerPrincipal);
    const other = await createAccountIfMissing(otherPrincipal);
    const created = await addEmailIdentifier(owner, "tenant.owner@example.test");

    expect((await listIdentifiers(other)).map((identifier) => identifier.id)).not.toContain(
      created.identifierId,
    );
    await expect(verifyEmailIdentifier(other, created.verificationId, "000000")).rejects.toThrow(
      "VERIFICATION_NOT_AVAILABLE",
    );

    await deleteAccount(ownerPrincipal, authGateway, { recentlyReauthenticated: true });
    await deleteAccount(otherPrincipal, authGateway, { recentlyReauthenticated: true });
  });

  it("locks a verification after five incorrect attempts", async () => {
    const lockoutPrincipal: AuthenticatedPrincipal = {
      subject: `integration_lockout_${testRunId}`,
      mode: "local",
    };
    const account = await createAccountIfMissing(lockoutPrincipal);
    const created = await addEmailIdentifier(account, "locked.challenge@example.test");

    const concurrentAttempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        verifyEmailIdentifier(account, created.verificationId, "111111"),
      ),
    );
    expect(concurrentAttempts.every((result) => result.status === "rejected")).toBe(true);
    for (const result of concurrentAttempts) {
      if (result.status === "fulfilled") throw new Error("verification unexpectedly succeeded");
      expect(["VERIFICATION_INVALID", "VERIFICATION_NOT_AVAILABLE"]).toContain(
        result.reason instanceof Error ? result.reason.message : String(result.reason),
      );
    }

    const [verification] = await getDatabase()
      .select({
        attemptCount: identifierVerifications.attemptCount,
        challengeHash: identifierVerifications.challengeHash,
        lockedAt: identifierVerifications.lockedAt,
        status: identifierVerifications.status,
      })
      .from(identifierVerifications)
      .where(eq(identifierVerifications.id, created.verificationId));

    expect(verification.attemptCount).toBe(5);
    expect(verification.status).toBe("REVOKED");
    expect(verification.challengeHash).toBe("consumed");
    expect(verification.lockedAt).toBeInstanceOf(Date);
    await expect(verifyEmailIdentifier(account, created.verificationId, "000000")).rejects.toThrow(
      "VERIFICATION_NOT_AVAILABLE",
    );

    await deleteAccount(lockoutPrincipal, authGateway, { recentlyReauthenticated: true });
  });

  it("requires recent reauthentication before deletion changes data", async () => {
    const guardedPrincipal: AuthenticatedPrincipal = {
      subject: `integration_reauth_${testRunId}`,
      mode: "local",
    };
    const account = await createAccountIfMissing(guardedPrincipal);

    await expect(
      deleteAccount(guardedPrincipal, authGateway, { recentlyReauthenticated: false }),
    ).rejects.toThrow("RECENT_REAUTHENTICATION_REQUIRED");
    const existingUsers = await getDatabase()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, account.userId));
    expect(existingUsers).toHaveLength(1);

    await deleteAccount(guardedPrincipal, authGateway, { recentlyReauthenticated: true });
  });

  it("quarantines a deletion-pending account and safely retries provider failure", async () => {
    const retryPrincipal: AuthenticatedPrincipal = {
      subject: `integration_delete_retry_${testRunId}`,
      mode: "local",
    };
    const account = await createAccountIfMissing(retryPrincipal);
    let deletionAttempts = 0;
    const flakyGateway: AuthGateway = {
      async currentPrincipal() {
        return retryPrincipal;
      },
      async deletePrincipal() {
        deletionAttempts += 1;
        if (deletionAttempts === 1) throw new Error("synthetic provider outage");
      },
    };

    await expect(
      deleteAccount(retryPrincipal, flakyGateway, { recentlyReauthenticated: true }),
    ).rejects.toThrow("ACCOUNT_DELETION_RETRY_REQUIRED");

    const [pendingUser] = await getDatabase()
      .select({ state: users.state })
      .from(users)
      .where(eq(users.id, account.userId));
    expect(pendingUser.state).toBe("DELETION_PENDING");
    await expect(findAccount(retryPrincipal)).resolves.toBeNull();
    await expect(createAccountIfMissing(retryPrincipal)).rejects.toThrow(
      "ACCOUNT_DELETION_PENDING",
    );

    const subjectToken = createLookupToken(
      retryPrincipal.subject,
      "deleted-auth-subject:v1",
      getApplicationKeyring(),
    );
    const [failedReceipt] = await getDatabase()
      .select({ id: deletionReceipts.id, state: deletionReceipts.state })
      .from(deletionReceipts)
      .where(eq(deletionReceipts.subjectToken, subjectToken));
    expect(failedReceipt.state).toBe("FAILED");

    const retried = await deleteAccount(retryPrincipal, flakyGateway, {
      recentlyReauthenticated: true,
    });
    expect(retried.receiptId).toBe(failedReceipt.id);
    const [completedReceipt] = await getDatabase()
      .select({ state: deletionReceipts.state })
      .from(deletionReceipts)
      .where(eq(deletionReceipts.id, retried.receiptId));
    expect(completedReceipt.state).toBe("COMPLETED");
    expect(deletionAttempts).toBe(2);
  });
});
