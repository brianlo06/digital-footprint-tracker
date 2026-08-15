import { randomUUID } from "node:crypto";
import { createAccountIfMissing, findAccount } from "@/core/account-service";
import {
  addEmailIdentifier,
  listIdentifiers,
  verifyEmailIdentifier,
} from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import {
  auditEvents,
  consentRecords,
  deletionReceipts,
  identifiers,
  identifierVerifications,
  users,
  verificationDeliveryOutbox,
} from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import {
  getBreachConsentSummary,
  grantBreachConsent,
  withdrawBreachConsent,
} from "@/privacy/breach-consent-service";
import { deleteAccount, resumeAccountDeletionAfterAuthRevoked } from "@/privacy/deletion-service";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import type { AuthGateway, AuthenticatedPrincipal } from "@/security/auth";
import { createDeliveryKeyring, createLookupToken } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { encryptDeliveryCommand } from "@/verification/delivery-envelope";
import { OutboxEmailVerificationGateway } from "@/verification/email-verification-gateway";
import { resetServerEnvForTests } from "@/config/server-env";
import { and, eq } from "drizzle-orm";
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
    // process.env is a shared global; another concurrently running
    // integration test file may have left a previous lookup key set.
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = principal.subject;
    process.env.ENCRYPTION_KEY_ID = "integration-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
    process.env.LOOKUP_KEY = Buffer.alloc(32, 29).toString("base64");
    process.env.LOOKUP_KEY_ID = "account-lifecycle-lookup-v1";
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

  it("records an idempotent, revocable breach-consent lifecycle", async () => {
    const consentPrincipal: AuthenticatedPrincipal = {
      subject: `integration_consent_${testRunId}`,
      mode: "local",
    };
    const account = await createAccountIfMissing(consentPrincipal);

    const concurrentGrants = await Promise.all([
      grantBreachConsent(account),
      grantBreachConsent(account),
      grantBreachConsent(account),
    ]);
    expect(new Set(concurrentGrants.map((grant) => grant.consentRecordId)).size).toBe(1);
    expect(concurrentGrants.filter((grant) => grant.changed)).toHaveLength(1);

    const grantedSummary = await getBreachConsentSummary(account);
    expect(grantedSummary).toMatchObject({
      consentRecordId: concurrentGrants[0].consentRecordId,
      state: "GRANTED",
      withdrawnAt: null,
    });

    const concurrentWithdrawals = await Promise.all([
      withdrawBreachConsent(account),
      withdrawBreachConsent(account),
      withdrawBreachConsent(account),
    ]);
    expect(concurrentWithdrawals.filter(Boolean)).toHaveLength(1);
    expect(await getBreachConsentSummary(account)).toMatchObject({
      consentRecordId: concurrentGrants[0].consentRecordId,
      state: "WITHDRAWN",
    });

    const replacementGrant = await grantBreachConsent(account);
    expect(replacementGrant.changed).toBe(true);
    expect(replacementGrant.consentRecordId).not.toBe(concurrentGrants[0].consentRecordId);

    const lifecycleRecords = await getDatabase()
      .select({
        id: consentRecords.id,
        state: consentRecords.state,
        withdrawnAt: consentRecords.withdrawnAt,
      })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.userId, account.userId),
          eq(consentRecords.purpose, BREACH_CONSENT_PURPOSE),
          eq(consentRecords.policyVersion, BREACH_CONSENT_POLICY_VERSION),
        ),
      );
    expect(lifecycleRecords).toHaveLength(2);
    expect(lifecycleRecords.filter((record) => record.state === "GRANTED")).toHaveLength(1);
    expect(
      lifecycleRecords.every(
        (record) =>
          (record.state === "GRANTED" && record.withdrawnAt === null) ||
          (record.state === "WITHDRAWN" && record.withdrawnAt instanceof Date),
      ),
    ).toBe(true);

    const lifecycleAudits = await getDatabase()
      .select({ action: auditEvents.action, targetId: auditEvents.targetId })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.userId, account.userId), eq(auditEvents.targetType, "CONSENT_RECORD")),
      );
    expect(
      lifecycleAudits.filter((event) => event.action === "BREACH_CONSENT_GRANTED"),
    ).toHaveLength(2);
    expect(
      lifecycleAudits.filter((event) => event.action === "BREACH_CONSENT_WITHDRAWN"),
    ).toHaveLength(1);

    await deleteAccount(consentPrincipal, authGateway, { recentlyReauthenticated: true });
    expect(
      await getDatabase()
        .select({ id: consentRecords.id })
        .from(consentRecords)
        .where(eq(consentRecords.userId, account.userId)),
    ).toHaveLength(0);
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

  it("purges a provider-deleted account and converges concurrent deliveries", async () => {
    const providerDeletedPrincipal: AuthenticatedPrincipal = {
      subject: `integration_provider_deleted_${testRunId}`,
      mode: "clerk",
    };
    const account = await createAccountIfMissing(providerDeletedPrincipal);
    await addEmailIdentifier(account, "provider.deleted@example.test");

    const deliveries = await Promise.all([
      resumeAccountDeletionAfterAuthRevoked(providerDeletedPrincipal.subject),
      resumeAccountDeletionAfterAuthRevoked(providerDeletedPrincipal.subject),
    ]);
    expect(deliveries[0].receiptId).not.toBeNull();
    expect(deliveries[1].receiptId).toBe(deliveries[0].receiptId);

    const [receipt] = await getDatabase()
      .select({ state: deletionReceipts.state })
      .from(deletionReceipts)
      .where(eq(deletionReceipts.id, deliveries[0].receiptId!));
    expect(receipt.state).toBe("COMPLETED");
    expect(
      await getDatabase().select({ id: users.id }).from(users).where(eq(users.id, account.userId)),
    ).toHaveLength(0);
  });

  it("finishes a quarantined deletion after the provider confirms revocation", async () => {
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

    const resumed = await resumeAccountDeletionAfterAuthRevoked(retryPrincipal.subject);
    expect(resumed.receiptId).toBe(failedReceipt.id);
    const [completedReceipt] = await getDatabase()
      .select({ state: deletionReceipts.state })
      .from(deletionReceipts)
      .where(eq(deletionReceipts.id, resumed.receiptId!));
    expect(completedReceipt.state).toBe("COMPLETED");
    expect(deletionAttempts).toBe(1);

    const redelivered = await resumeAccountDeletionAfterAuthRevoked(retryPrincipal.subject);
    expect(redelivered.receiptId).toBe(failedReceipt.id);
  });

  it("verifies a challenge issued under a key that has since become the previous key", async () => {
    const rotationPrincipal: AuthenticatedPrincipal = {
      subject: `integration_verify_rotation_${testRunId}`,
      mode: "local",
    };
    const account = await createAccountIfMissing(rotationPrincipal);
    const created = await addEmailIdentifier(account, "verify.rotation@example.test");

    // Rotate: the key active at challenge-issue time becomes the previous
    // key, and a new key becomes current, before the code is submitted.
    process.env.LOOKUP_KEY_ID = "account-lifecycle-lookup-v2";
    process.env.LOOKUP_KEY = Buffer.alloc(32, 31).toString("base64");
    process.env.PREVIOUS_LOOKUP_KEY_ID = "account-lifecycle-lookup-v1";
    process.env.PREVIOUS_LOOKUP_KEY = Buffer.alloc(32, 29).toString("base64");
    resetServerEnvForTests();

    try {
      await verifyEmailIdentifier(account, created.verificationId, "000000");
      const [verified] = await getDatabase()
        .select({ status: identifiers.verificationStatus })
        .from(identifiers)
        .where(eq(identifiers.id, created.identifierId));
      expect(verified.status).toBe("VERIFIED");
    } finally {
      delete process.env.PREVIOUS_LOOKUP_KEY_ID;
      delete process.env.PREVIOUS_LOOKUP_KEY;
      process.env.LOOKUP_KEY_ID = "account-lifecycle-lookup-v1";
      process.env.LOOKUP_KEY = Buffer.alloc(32, 29).toString("base64");
      resetServerEnvForTests();
      await deleteAccount(rotationPrincipal, authGateway, { recentlyReauthenticated: true });
    }
  });

  it("atomically enqueues a delivery outbox row with the outbox gateway, and rolls it back with the rest of the transaction on failure", async () => {
    const outboxPrincipal: AuthenticatedPrincipal = {
      subject: `integration_outbox_${testRunId}`,
      mode: "local",
    };
    const account = await createAccountIfMissing(outboxPrincipal);
    const deliveryKeyring = createDeliveryKeyring({
      keyId: "account-lifecycle-delivery-v1",
      encryptionKeyBase64: Buffer.alloc(32, 41).toString("base64"),
    });
    const outboxGateway = new OutboxEmailVerificationGateway(
      { appEnv: "local", authMode: "local" },
      getApplicationKeyring(),
      deliveryKeyring,
    );

    const created = await addEmailIdentifier(account, "outbox.enqueue@example.test", outboxGateway);

    const [outboxRow] = await getDatabase()
      .select({
        verificationId: verificationDeliveryOutbox.verificationId,
        userId: verificationDeliveryOutbox.userId,
        state: verificationDeliveryOutbox.state,
        template: verificationDeliveryOutbox.template,
      })
      .from(verificationDeliveryOutbox)
      .where(eq(verificationDeliveryOutbox.verificationId, created.verificationId));
    expect(outboxRow).toBeDefined();
    expect(outboxRow.userId).toBe(account.userId);
    // A concurrently running delivery-worker integration file may claim the
    // globally visible row immediately after this transaction commits. Both
    // states prove the atomic enqueue; no consumer can observe it before
    // commit, and the rollback assertion below covers the failure path.
    expect(["PENDING", "CLAIMED"]).toContain(outboxRow.state);
    expect(outboxRow.template).toBe("EMAIL_VERIFICATION_CODE_V1");

    // Prove the outbox insert is genuinely inside the same transaction as
    // everything else, not an independent write: insert a second outbox row
    // for the same verification, then force a later statement in the same
    // transaction to fail, and confirm the outbox row never persists.
    const forcedDeliveryId = randomUUID();
    const forcedPayload = encryptDeliveryCommand(
      { destination: "outbox.enqueue@example.test", code: "000000" },
      "forced-rollback-context",
      deliveryKeyring,
    );
    await expect(
      withTenantDatabase(outboxPrincipal, async (transaction) => {
        await transaction.insert(verificationDeliveryOutbox).values({
          deliveryId: forcedDeliveryId,
          verificationId: created.verificationId,
          userId: account.userId,
          channel: "EMAIL",
          template: "EMAIL_VERIFICATION_CODE_V1",
          encryptedPayload: forcedPayload,
          state: "PENDING",
        });
        throw new Error("forced rollback after outbox insert");
      }),
    ).rejects.toThrow("forced rollback after outbox insert");

    const forcedRows = await getDatabase()
      .select({ deliveryId: verificationDeliveryOutbox.deliveryId })
      .from(verificationDeliveryOutbox)
      .where(eq(verificationDeliveryOutbox.deliveryId, forcedDeliveryId));
    expect(forcedRows).toHaveLength(0);

    await deleteAccount(outboxPrincipal, authGateway, { recentlyReauthenticated: true });
  });
});
