import { resetServerEnvForTests } from "@/config/server-env";
import { createAccountIfMissing, type AccountContext } from "@/core/account-service";
import { addEmailIdentifier, verifyEmailIdentifier } from "@/core/identifier-service";
import { closeDatabase, getDatabase, withRuntimeDatabase } from "@/database/client";
import {
  breachFindings,
  consentRecords,
  identifiers,
  providerRuns,
  scanJobs,
  scans,
  users,
} from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import { executePostgresSyntheticBreachScan } from "@/providers/breach/postgres-breach-scan";
import { listRecentBreachScans } from "@/providers/breach/breach-scan-history";
import {
  cancelQueuedPostgresBreachScan,
  enqueuePostgresSyntheticBreachScan,
} from "@/providers/breach/breach-scan-queue";
import { claimBreachScanJobs } from "@/providers/breach/breach-scan-job-core";
import { dispatchQueuedPostgresSyntheticBreachScan } from "@/providers/breach/postgres-breach-scan-job";
import { processClaimedPostgresSyntheticBreachScan } from "@/providers/breach/postgres-breach-scan-worker-core";
import { selectBreachProvider } from "@/providers/provider-registry";
import type { ProviderUsageBudget } from "@/providers/provider-usage-ledger";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.REQUIRE_DATABASE_TESTS === "1" && (!testDatabaseUrl || !testRuntimeDatabaseUrl)) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required for the integration test command",
  );
}
const describeWithDatabase = testDatabaseUrl && testRuntimeDatabaseUrl ? describe : describe.skip;

describeWithDatabase("durable synthetic breach scan persistence", () => {
  const testRunId = Date.now();
  const ownerPrincipal: AuthenticatedPrincipal = {
    subject: `breach_scan_owner_${testRunId}`,
    mode: "local",
  };
  const otherPrincipal: AuthenticatedPrincipal = {
    subject: `breach_scan_other_${testRunId}`,
    mode: "local",
  };
  const selection = selectBreachProvider({
    appEnvironment: "local",
    provider: "synthetic",
    featureEnabled: true,
    killSwitchActive: false,
  });
  const budget: ProviderUsageBudget = {
    maxUserDailyRequests: 5,
    maxProviderDailyRequests: 20,
    maxProviderMonthlyRequests: 20,
    maxProviderDailyCostUnits: 0,
    maxProviderMonthlyCostUnits: 0,
  };
  const userIds: string[] = [];

  async function prepareAccount(
    principal: AuthenticatedPrincipal,
    sequence: string,
  ): Promise<AccountContext> {
    const account = await createAccountIfMissing(principal);
    userIds.push(account.userId);
    const identifier = await addEmailIdentifier(account, `breach.scan.${sequence}@example.test`);
    await verifyEmailIdentifier(account, identifier.verificationId, "000000");
    await withTenantDatabase(principal, async (transaction) => {
      await transaction.insert(consentRecords).values({
        userId: account.userId,
        identityId: account.identityId,
        purpose: BREACH_CONSENT_PURPOSE,
        policyVersion: BREACH_CONSENT_POLICY_VERSION,
        dataCategories: ["EMAIL_IDENTIFIER", "BREACH_METADATA"],
        state: "GRANTED",
      });
    });
    return account;
  }

  let ownerAccount: AccountContext;

  beforeAll(async () => {
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = ownerPrincipal.subject;
    process.env.ENCRYPTION_KEY_ID = "breach-scan-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 91).toString("base64");
    process.env.LOOKUP_KEY_ID = "breach-scan-lookup-v1";
    process.env.LOOKUP_KEY = Buffer.alloc(32, 92).toString("base64");
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();

    ownerAccount = await prepareAccount(ownerPrincipal, "owner");
    await prepareAccount(otherPrincipal, "other");
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await getDatabase().delete(users).where(inArray(users.id, userIds));
    }
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("persists a completed scan, provider run, and normalized findings", async () => {
    const result = await executePostgresSyntheticBreachScan({
      account: ownerAccount,
      now: new Date(),
      providerSelection: selection,
      usageBudget: budget,
    });
    expect(result).toMatchObject({ status: "COMPLETED", findingCount: 1 });
    if (result.status !== "COMPLETED") throw new Error("expected COMPLETED result");

    const [storedScan] = await getDatabase()
      .select()
      .from(scans)
      .where(eq(scans.id, result.scanId));
    expect(storedScan).toMatchObject({
      userId: ownerAccount.userId,
      identityId: ownerAccount.identityId,
      state: "COMPLETED",
      requestedCapability: "BREACH_METADATA_BY_VERIFIED_EMAIL",
    });

    const [storedRun] = await getDatabase()
      .select()
      .from(providerRuns)
      .where(eq(providerRuns.id, result.providerRunId));
    expect(storedRun).toMatchObject({
      scanId: result.scanId,
      providerId: "synthetic-breach",
      state: "COMPLETED",
      resultCount: 1,
      errorSafeCode: null,
    });

    const storedFindings = await getDatabase()
      .select()
      .from(breachFindings)
      .where(eq(breachFindings.providerRunId, result.providerRunId));
    expect(storedFindings).toHaveLength(1);
    expect(storedFindings[0]).toMatchObject({
      userId: ownerAccount.userId,
      identityId: ownerAccount.identityId,
      providerBreachId: "synthetic-commerce-2024",
      breachName: "Synthetic Commerce",
      breachDate: "2024-01-15",
      dataCategories: ["Email addresses", "Names"],
      isVerified: true,
      isSensitive: false,
      isRetired: false,
      sourceUrl: "https://example.test/breaches/synthetic-commerce-2024",
      parserVersion: "synthetic-breach-v1",
    });
  });

  it("enforces tenant isolation on scans, provider runs, and findings", async () => {
    const [ownerScan] = await withTenantDatabase(ownerPrincipal, (transaction) =>
      transaction.select({ id: scans.id }).from(scans).where(eq(scans.userId, ownerAccount.userId)),
    );
    expect(ownerScan).toBeDefined();

    const crossTenantScans = await withTenantDatabase(otherPrincipal, (transaction) =>
      transaction.select({ id: scans.id }).from(scans).where(eq(scans.id, ownerScan.id)),
    );
    expect(crossTenantScans).toHaveLength(0);

    const crossTenantRuns = await withTenantDatabase(otherPrincipal, (transaction) =>
      transaction
        .select({ id: providerRuns.id })
        .from(providerRuns)
        .where(eq(providerRuns.userId, ownerAccount.userId)),
    );
    expect(crossTenantRuns).toHaveLength(0);

    const crossTenantFindings = await withTenantDatabase(otherPrincipal, (transaction) =>
      transaction
        .select({ id: breachFindings.id })
        .from(breachFindings)
        .where(eq(breachFindings.userId, ownerAccount.userId)),
    );
    expect(crossTenantFindings).toHaveLength(0);
  });

  it("marks both rows FAILED with a safe denial reason when verification is stale, without persisting findings", async () => {
    const stalePrincipal: AuthenticatedPrincipal = {
      subject: `breach_scan_stale_${testRunId}`,
      mode: "local",
    };
    const staleAccount = await prepareAccount(stalePrincipal, "stale");
    await withTenantDatabase(stalePrincipal, (transaction) =>
      transaction
        .update(identifiers)
        .set({ lastVerifiedAt: new Date(Date.now() - 48 * 60 * 60 * 1_000) })
        .where(eq(identifiers.identityId, staleAccount.identityId)),
    );

    const result = await executePostgresSyntheticBreachScan({
      account: staleAccount,
      now: new Date(),
      providerSelection: selection,
      usageBudget: budget,
    });
    expect(result).toEqual({
      status: "DENIED",
      scanId: expect.any(String),
      providerRunId: expect.any(String),
      reason: "VERIFICATION_STALE",
    });
    if (result.status !== "DENIED") throw new Error("expected DENIED result");

    const [storedScan] = await getDatabase()
      .select()
      .from(scans)
      .where(eq(scans.id, result.scanId));
    expect(storedScan).toMatchObject({ state: "FAILED" });
    const [storedRun] = await getDatabase()
      .select()
      .from(providerRuns)
      .where(eq(providerRuns.id, result.providerRunId));
    expect(storedRun).toMatchObject({ state: "FAILED", errorSafeCode: "VERIFICATION_STALE" });
    const storedFindings = await getDatabase()
      .select()
      .from(breachFindings)
      .where(eq(breachFindings.providerRunId, result.providerRunId));
    expect(storedFindings).toHaveLength(0);
  });

  it("cascades scan, provider-run, and finding deletion when the account is deleted", async () => {
    const cascadePrincipal: AuthenticatedPrincipal = {
      subject: `breach_scan_cascade_${testRunId}`,
      mode: "local",
    };
    const cascadeAccount = await prepareAccount(cascadePrincipal, "cascade");
    const result = await executePostgresSyntheticBreachScan({
      account: cascadeAccount,
      now: new Date(),
      providerSelection: selection,
      usageBudget: budget,
    });
    expect(result).toMatchObject({ status: "COMPLETED" });
    if (result.status !== "COMPLETED") throw new Error("expected COMPLETED result");

    await getDatabase().delete(users).where(eq(users.id, cascadeAccount.userId));
    userIds.splice(userIds.indexOf(cascadeAccount.userId), 1);

    const [remainingScan] = await getDatabase()
      .select()
      .from(scans)
      .where(eq(scans.id, result.scanId));
    expect(remainingScan).toBeUndefined();
    const [remainingRun] = await getDatabase()
      .select()
      .from(providerRuns)
      .where(eq(providerRuns.id, result.providerRunId));
    expect(remainingRun).toBeUndefined();
    const remainingFindings = await getDatabase()
      .select()
      .from(breachFindings)
      .where(eq(breachFindings.providerRunId, result.providerRunId));
    expect(remainingFindings).toHaveLength(0);
  });

  it("denies a second scan while one is already running for the account, without duplicating rows", async () => {
    const concurrentPrincipal: AuthenticatedPrincipal = {
      subject: `breach_scan_concurrent_${testRunId}`,
      mode: "local",
    };
    const concurrentAccount = await prepareAccount(concurrentPrincipal, "concurrent");

    // Simulate an in-flight scan by inserting its RUNNING row directly; the
    // partial unique index this exercises is what prevents two genuinely
    // concurrent Server Action submissions from double-dispatching.
    await withTenantDatabase(concurrentPrincipal, (transaction) =>
      transaction.insert(scans).values({
        userId: concurrentAccount.userId,
        identityId: concurrentAccount.identityId,
        trigger: "USER",
        state: "RUNNING",
        requestedCapability: "BREACH_METADATA_BY_VERIFIED_EMAIL",
      }),
    );

    const result = await executePostgresSyntheticBreachScan({
      account: concurrentAccount,
      now: new Date(),
      providerSelection: selection,
      usageBudget: budget,
    });
    expect(result).toEqual({ status: "ALREADY_RUNNING" });

    const scanRows = await getDatabase()
      .select({ id: scans.id })
      .from(scans)
      .where(eq(scans.userId, concurrentAccount.userId));
    expect(scanRows).toHaveLength(1);
    const runRows = await getDatabase()
      .select({ id: providerRuns.id })
      .from(providerRuns)
      .where(eq(providerRuns.userId, concurrentAccount.userId));
    expect(runRows).toHaveLength(0);
  });

  it("commits a failed provider run and scan before rethrowing a dispatched provider error", async () => {
    const failurePrincipal: AuthenticatedPrincipal = {
      subject: `breach_scan_failure_${testRunId}`,
      mode: "local",
    };
    const failureAccount = await prepareAccount(failurePrincipal, "failure");
    const failureSelection = selectBreachProvider({
      appEnvironment: "local",
      provider: "synthetic",
      featureEnabled: true,
      killSwitchActive: false,
      syntheticScenario: "RATE_LIMIT",
    });

    await expect(
      executePostgresSyntheticBreachScan({
        account: failureAccount,
        now: new Date(),
        providerSelection: failureSelection,
        usageBudget: budget,
      }),
    ).rejects.toMatchObject({ descriptor: { safeCode: "PROVIDER_RATE_LIMITED" } });

    const storedScans = await getDatabase()
      .select()
      .from(scans)
      .where(eq(scans.userId, failureAccount.userId));
    expect(storedScans).toHaveLength(1);
    expect(storedScans[0]).toMatchObject({ state: "FAILED" });
    const storedRuns = await getDatabase()
      .select()
      .from(providerRuns)
      .where(eq(providerRuns.userId, failureAccount.userId));
    expect(storedRuns).toHaveLength(1);
    expect(storedRuns[0]).toMatchObject({
      state: "FAILED",
      errorSafeCode: "PROVIDER_RATE_LIMITED",
    });
  });

  it("queues opaque work, prevents duplicate active scans, and completes it after dispatch", async () => {
    const queuedPrincipal: AuthenticatedPrincipal = {
      subject: `breach_scan_queued_${testRunId}`,
      mode: "local",
    };
    const queuedAccount = await prepareAccount(queuedPrincipal, "queued");

    const queued = await enqueuePostgresSyntheticBreachScan({
      account: queuedAccount,
      providerSelection: selection,
    });
    expect(queued).toMatchObject({ status: "QUEUED", scanId: expect.any(String) });
    if (queued.status !== "QUEUED") throw new Error("expected QUEUED result");

    const duplicate = await enqueuePostgresSyntheticBreachScan({
      account: queuedAccount,
      providerSelection: selection,
    });
    expect(duplicate).toEqual({ status: "ALREADY_RUNNING", scanId: queued.scanId });

    const [storedJob] = await getDatabase()
      .select()
      .from(scanJobs)
      .where(eq(scanJobs.scanId, queued.scanId));
    expect(storedJob).toMatchObject({
      state: "PENDING",
      userId: queuedAccount.userId,
      identifierId: expect.any(String),
      consentRecordId: expect.any(String),
      leaseToken: null,
    });

    const outcome = await dispatchQueuedPostgresSyntheticBreachScan({
      account: queuedAccount,
      scanId: queued.scanId,
      now: new Date(),
      providerSelection: selection,
    });
    expect(outcome).toBe("COMPLETED");

    const [completedJob] = await getDatabase()
      .select()
      .from(scanJobs)
      .where(eq(scanJobs.scanId, queued.scanId));
    expect(completedJob).toMatchObject({ state: "COMPLETED", attemptCount: 1, leaseToken: null });
    const [completedScan] = await getDatabase()
      .select()
      .from(scans)
      .where(eq(scans.id, queued.scanId));
    expect(completedScan).toMatchObject({ state: "COMPLETED" });
  });

  it("cancels only an unclaimed queued scan", async () => {
    const cancelPrincipal: AuthenticatedPrincipal = {
      subject: `breach_scan_cancel_${testRunId}`,
      mode: "local",
    };
    const cancelAccount = await prepareAccount(cancelPrincipal, "cancel");
    const queued = await enqueuePostgresSyntheticBreachScan({
      account: cancelAccount,
      providerSelection: selection,
    });
    if (queued.status !== "QUEUED") throw new Error("expected QUEUED result");

    await expect(cancelQueuedPostgresBreachScan(cancelAccount, queued.scanId)).resolves.toBe(
      "CANCELLED",
    );
    await expect(cancelQueuedPostgresBreachScan(cancelAccount, queued.scanId)).resolves.toBe(
      "NOT_CANCELLABLE",
    );

    const [cancelledJob] = await getDatabase()
      .select()
      .from(scanJobs)
      .where(eq(scanJobs.scanId, queued.scanId));
    const [cancelledScan] = await getDatabase()
      .select()
      .from(scans)
      .where(eq(scans.id, queued.scanId));
    expect(cancelledJob).toMatchObject({ state: "CANCELLED" });
    expect(cancelledScan).toMatchObject({ state: "CANCELLED" });
  });

  it("persists a bounded retry after a retryable provider failure", async () => {
    const retryPrincipal: AuthenticatedPrincipal = {
      subject: `breach_scan_retry_${testRunId}`,
      mode: "local",
    };
    const retryAccount = await prepareAccount(retryPrincipal, "retry");
    const retrySelection = selectBreachProvider({
      appEnvironment: "local",
      provider: "synthetic",
      featureEnabled: true,
      killSwitchActive: false,
      syntheticScenario: "RATE_LIMIT",
    });
    const queued = await enqueuePostgresSyntheticBreachScan({
      account: retryAccount,
      providerSelection: retrySelection,
    });
    if (queued.status !== "QUEUED") throw new Error("expected QUEUED result");
    const now = new Date();

    await expect(
      dispatchQueuedPostgresSyntheticBreachScan({
        account: retryAccount,
        scanId: queued.scanId,
        now,
        providerSelection: retrySelection,
      }),
    ).resolves.toBe("RETRY_SCHEDULED");

    const [retriedJob] = await getDatabase()
      .select()
      .from(scanJobs)
      .where(eq(scanJobs.scanId, queued.scanId));
    const [retriedScan] = await getDatabase()
      .select()
      .from(scans)
      .where(eq(scans.id, queued.scanId));
    expect(retriedJob).toMatchObject({
      state: "PENDING",
      attemptCount: 1,
      lastErrorSafeCode: "PROVIDER_RATE_LIMITED",
      leaseToken: null,
    });
    expect(retriedJob.notBefore.getTime()).toBeGreaterThan(now.getTime());
    expect(retriedScan).toMatchObject({ state: "QUEUED", completedAt: null });

    await getDatabase()
      .update(scanJobs)
      .set({ notBefore: new Date(now.getTime() - 1_000) })
      .where(eq(scanJobs.scanId, queued.scanId));
    await expect(
      dispatchQueuedPostgresSyntheticBreachScan({
        account: retryAccount,
        scanId: queued.scanId,
        now: new Date(),
        providerSelection: selection,
      }),
    ).resolves.toBe("COMPLETED");

    const history = await listRecentBreachScans(retryAccount, { limit: 5 });
    const retriedHistory = history.filter((entry) => entry.scanId === queued.scanId);
    expect(retriedHistory).toHaveLength(1);
    expect(retriedHistory[0]).toMatchObject({
      scanState: "COMPLETED",
      providerRunState: "COMPLETED",
      errorSafeCode: null,
      findings: [expect.objectContaining({ breachName: "Synthetic Commerce" })],
    });
  });

  it("claims and completes a due multi-tenant batch through isolated RLS transactions", async () => {
    const batchAccounts = await Promise.all(
      ["batch-a", "batch-b"].map((sequence) =>
        prepareAccount(
          { subject: `breach_scan_${sequence}_${testRunId}`, mode: "local" },
          sequence,
        ),
      ),
    );
    const queued = await Promise.all(
      batchAccounts.map((account) =>
        enqueuePostgresSyntheticBreachScan({ account, providerSelection: selection }),
      ),
    );
    const scanIds = queued.map((result) => {
      if (result.status !== "QUEUED") throw new Error("expected QUEUED result");
      return result.scanId;
    });

    // Make these two rows deterministically older than other test work so the
    // unrestricted scheduled claim cannot interfere with another test file.
    await getDatabase()
      .update(scanJobs)
      .set({ notBefore: new Date("2000-01-01T00:00:00.000Z") })
      .where(inArray(scanJobs.scanId, scanIds));

    const now = new Date();
    const claimed = await withRuntimeDatabase((database) =>
      claimBreachScanJobs(database, { now, batchSize: 2, leaseSeconds: 120 }),
    );
    expect(claimed.map((job) => job.scanId).sort()).toEqual([...scanIds].sort());

    const outcomes = await withRuntimeDatabase((database) =>
      Promise.all(
        claimed.map((job) =>
          processClaimedPostgresSyntheticBreachScan({
            database,
            job,
            now,
            providerSelection: selection,
          }),
        ),
      ),
    );
    expect(outcomes).toEqual(["COMPLETED", "COMPLETED"]);

    const completedJobs = await getDatabase()
      .select({
        scanId: scanJobs.scanId,
        state: scanJobs.state,
        attemptCount: scanJobs.attemptCount,
      })
      .from(scanJobs)
      .where(inArray(scanJobs.scanId, scanIds));
    expect(completedJobs).toHaveLength(2);
    expect(completedJobs).toEqual(
      expect.arrayContaining(
        scanIds.map((scanId) => ({ scanId, state: "COMPLETED", attemptCount: 1 })),
      ),
    );
  });
});
