import { randomUUID } from "node:crypto";
import { createAccountIfMissing } from "@/core/account-service";
import { addEmailIdentifier } from "@/core/identifier-service";
import { resetServerEnvForTests } from "@/config/server-env";
import { closeDatabase, getDatabase } from "@/database/client";
import {
  auditEvents,
  consentRecords,
  deletionReceipts,
  identifierVerifications,
  rateLimitWindows,
  scanJobs,
  scans,
} from "@/database/schema";
import { deleteAccount } from "@/privacy/deletion-service";
import { runRetentionMaintenance } from "@/privacy/retention-service";
import type { AuthGateway, AuthenticatedPrincipal } from "@/security/auth";
import { createLookupToken } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const testMaintenanceDatabaseUrl = process.env.TEST_MAINTENANCE_DATABASE_URL;
if (
  process.env.REQUIRE_DATABASE_TESTS === "1" &&
  (!testDatabaseUrl || !testRuntimeDatabaseUrl || !testMaintenanceDatabaseUrl)
) {
  throw new Error(
    "TEST_DATABASE_URL, TEST_RUNTIME_DATABASE_URL, and TEST_MAINTENANCE_DATABASE_URL are required for retention integration tests",
  );
}
const describeWithDatabase =
  testDatabaseUrl && testRuntimeDatabaseUrl && testMaintenanceDatabaseUrl
    ? describe
    : describe.skip;

describeWithDatabase("bounded retention maintenance", () => {
  const principal: AuthenticatedPrincipal = {
    subject: `retention_subject_${Date.now()}`,
    mode: "local",
  };
  const authGateway: AuthGateway = {
    async currentPrincipal() {
      return principal;
    },
    async deletePrincipal() {
      // Synthetic local identity has no external state.
    },
  };
  const maintenanceSql = postgres(testMaintenanceDatabaseUrl!, { max: 1, prepare: false });

  beforeAll(() => {
    // process.env is a shared global; another concurrently running
    // integration test file may have left a previous lookup key set.
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.MAINTENANCE_DATABASE_URL = testMaintenanceDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = principal.subject;
    process.env.ENCRYPTION_KEY_ID = "retention-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 41).toString("base64");
    process.env.LOOKUP_KEY = Buffer.alloc(32, 43).toString("base64");
    process.env.LOOKUP_KEY_ID = "retention-lookup-v1";
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();
  });

  afterAll(async () => {
    await maintenanceSql.end({ timeout: 5 });
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("uses a function-only maintenance role with a non-login capability owner", async () => {
    const [capabilities] = await maintenanceSql<
      {
        currentUser: string;
        superuser: boolean;
        bypassRls: boolean;
        canReadVerifications: boolean;
        canExecuteRetention: boolean;
      }[]
    >`
      select
        current_user as "currentUser",
        rolsuper as superuser,
        rolbypassrls as "bypassRls",
        has_table_privilege(
          current_user,
          'public.identifier_verifications',
          'SELECT'
        ) as "canReadVerifications",
        has_function_privilege(
          current_user,
          'public.run_retention_maintenance(timestamptz,integer,timestamptz,timestamptz,timestamptz)',
          'EXECUTE'
        ) as "canExecuteRetention"
      from pg_roles
      where rolname = current_user
    `;
    expect(capabilities).toEqual({
      currentUser: "digital_footprint_maintenance",
      superuser: false,
      bypassRls: false,
      canReadVerifications: false,
      canExecuteRetention: true,
    });

    const [functionOwner] = await maintenanceSql<{ canLogin: boolean; bypassRls: boolean }[]>`
      select owner.rolcanlogin as "canLogin", owner.rolbypassrls as "bypassRls"
      from pg_proc as procedure
      inner join pg_roles as owner on owner.oid = procedure.proowner
      where procedure.oid =
        'public.run_retention_maintenance(timestamptz,integer,timestamptz,timestamptz,timestamptz)'::regprocedure
    `;
    expect(functionOwner).toEqual({ canLogin: false, bypassRls: false });

    await expect(
      maintenanceSql`select id from public.identifier_verifications limit 1`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      maintenanceSql`
        select * from public.run_retention_maintenance(
          now(),
          1001,
          now() - interval '365 days',
          now() - interval '90 days',
          now() - interval '730 days'
        )
      `,
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      maintenanceSql`
        select * from public.run_retention_maintenance(
          now() + interval '1 day',
          1,
          now() - interval '365 days',
          now() - interval '90 days',
          now() - interval '730 days'
        )
      `,
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      maintenanceSql`
        select * from public.run_retention_maintenance(
          now(),
          null,
          now() - interval '365 days',
          now() - interval '90 days',
          now() - interval '730 days'
        )
      `,
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      maintenanceSql`
        select * from public.run_retention_maintenance(
          now(),
          1,
          now() - interval '365 days',
          now(),
          now() - interval '730 days'
        )
      `,
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      maintenanceSql`
        select * from public.run_retention_maintenance(
          now(),
          1,
          now() - interval '365 days',
          now() - interval '90 days',
          now() - interval '29 days'
        )
      `,
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("expires secrets and deletes only retention-eligible records", async () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    const account = await createAccountIfMissing(principal);
    const created = await addEmailIdentifier(account, "retention.fixture@example.test");
    await getDatabase()
      .update(identifierVerifications)
      .set({ expiresAt: new Date(now.getTime() - 1_000) })
      .where(eq(identifierVerifications.id, created.verificationId));

    const deletionPrincipal: AuthenticatedPrincipal = {
      subject: `retention_deleted_subject_${Date.now()}`,
      mode: "local",
    };
    await createAccountIfMissing(deletionPrincipal);
    const completed = await deleteAccount(deletionPrincipal, authGateway, {
      recentlyReauthenticated: true,
    });
    await getDatabase()
      .update(deletionReceipts)
      .set({ expiresAt: new Date(now.getTime() - 1_000) })
      .where(eq(deletionReceipts.id, completed.receiptId));

    const failedReceiptId = randomUUID();
    await getDatabase()
      .insert(deletionReceipts)
      .values({
        id: failedReceiptId,
        subjectToken: `synthetic-failed-${randomUUID()}`,
        state: "FAILED",
        expiresAt: new Date(now.getTime() - 1_000),
        failureCode: "SYNTHETIC_FAILURE",
      });
    const orphanAuditId = randomUUID();
    await getDatabase()
      .insert(auditEvents)
      .values({
        id: orphanAuditId,
        userId: null,
        actorType: "SYSTEM",
        action: "SYNTHETIC_RETENTION_FIXTURE",
        targetType: "NONE",
        targetId: null,
        outcome: "SUCCESS",
        correlationId: randomUUID(),
        occurredAt: new Date("2025-01-01T00:00:00.000Z"),
      });
    const expiredRateLimitToken = createLookupToken(
      `expired-rate-limit-${Date.now()}`,
      "rate-limit-user:v1",
      getApplicationKeyring(),
    );
    await getDatabase()
      .insert(rateLimitWindows)
      .values({
        scopeKind: "USER",
        scopeToken: expiredRateLimitToken,
        action: "ONBOARDING",
        windowStartedAt: new Date(now.getTime() - 3_600_000),
        requestCount: 1,
        expiresAt: new Date(now.getTime() - 1_000),
      });

    const [consent] = await getDatabase()
      .insert(consentRecords)
      .values({
        userId: account.userId,
        identityId: account.identityId,
        purpose: "BREACH_METADATA_LOOKUP",
        policyVersion: "phase2-breach-v1",
        dataCategories: ["EMAIL_IDENTIFIER", "BREACH_METADATA"],
        state: "GRANTED",
      })
      .returning({ id: consentRecords.id });
    async function seedScanJob(
      scanState: "COMPLETED" | "QUEUED",
      jobState: "COMPLETED" | "DEAD_LETTERED" | "PENDING",
      updatedAt: Date,
    ): Promise<string> {
      const [scan] = await getDatabase()
        .insert(scans)
        .values({
          userId: account.userId,
          identityId: account.identityId,
          trigger: "USER",
          state: scanState,
          requestedCapability: "BREACH_METADATA_BY_VERIFIED_EMAIL",
          startedAt: updatedAt,
          completedAt: scanState === "COMPLETED" ? updatedAt : null,
        })
        .returning({ id: scans.id });
      const [job] = await getDatabase()
        .insert(scanJobs)
        .values({
          scanId: scan.id,
          userId: account.userId,
          identityId: account.identityId,
          identifierId: created.identifierId,
          consentRecordId: consent.id,
          state: jobState,
          attemptCount: jobState === "PENDING" ? 0 : 1,
          updatedAt,
        })
        .returning({ id: scanJobs.id });
      return job.id;
    }
    const agedTerminalJobId = await seedScanJob(
      "COMPLETED",
      "COMPLETED",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const agedDeadLetterJobId = await seedScanJob(
      "COMPLETED",
      "DEAD_LETTERED",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const recentTerminalJobId = await seedScanJob(
      "COMPLETED",
      "COMPLETED",
      new Date(now.getTime() - 1_000),
    );
    const agedPendingJobId = await seedScanJob(
      "QUEUED",
      "PENDING",
      new Date("2026-01-01T00:00:00.000Z"),
    );

    const result = await runRetentionMaintenance({
      now,
      batchSize: 100,
      orphanAuditRetentionDays: 365,
      scanJobRetentionDays: 90,
      observationRetentionDays: 730,
    });

    expect(result.expiredVerifications).toBeGreaterThanOrEqual(1);
    expect(result.deletedReceipts).toBeGreaterThanOrEqual(1);
    expect(result.deletedOrphanAuditEvents).toBeGreaterThanOrEqual(1);
    expect(result.deletedScanJobs).toBeGreaterThanOrEqual(2);
    const remainingJobs = await getDatabase()
      .select({ id: scanJobs.id })
      .from(scanJobs)
      .where(eq(scanJobs.userId, account.userId));
    const remainingJobIds = remainingJobs.map((job) => job.id);
    expect(remainingJobIds).not.toContain(agedTerminalJobId);
    expect(remainingJobIds).not.toContain(agedDeadLetterJobId);
    expect(remainingJobIds).toContain(recentTerminalJobId);
    expect(remainingJobIds).toContain(agedPendingJobId);
    const [failedReceipt] = await getDatabase()
      .select({ state: deletionReceipts.state })
      .from(deletionReceipts)
      .where(eq(deletionReceipts.id, failedReceiptId));
    expect(failedReceipt.state).toBe("FAILED");
    const [expiredVerification] = await getDatabase()
      .select({
        challengeHash: identifierVerifications.challengeHash,
        status: identifierVerifications.status,
      })
      .from(identifierVerifications)
      .where(eq(identifierVerifications.id, created.verificationId));
    expect(expiredVerification.status).toBe("EXPIRED");
    expect(expiredVerification.challengeHash).toBe("consumed");
    const completedReceipts = await getDatabase()
      .select({ id: deletionReceipts.id })
      .from(deletionReceipts)
      .where(eq(deletionReceipts.id, completed.receiptId));
    expect(completedReceipts).toHaveLength(0);
    const orphanEvents = await getDatabase()
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.id, orphanAuditId));
    expect(orphanEvents).toHaveLength(0);
    const expiredRateLimits = await getDatabase()
      .select({ scopeToken: rateLimitWindows.scopeToken })
      .from(rateLimitWindows)
      .where(eq(rateLimitWindows.scopeToken, expiredRateLimitToken));
    expect(expiredRateLimits).toHaveLength(0);

    await getDatabase().delete(deletionReceipts).where(eq(deletionReceipts.id, failedReceiptId));
    await deleteAccount(principal, authGateway, { recentlyReauthenticated: true });
  });
});
