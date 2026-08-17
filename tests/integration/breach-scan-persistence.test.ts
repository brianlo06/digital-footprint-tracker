import { resetServerEnvForTests } from "@/config/server-env";
import { createAccountIfMissing, type AccountContext } from "@/core/account-service";
import { addEmailIdentifier, verifyEmailIdentifier } from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import {
  breachFindings,
  consentRecords,
  identifiers,
  providerRuns,
  scans,
  users,
} from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import { executePostgresSyntheticBreachScan } from "@/providers/breach/postgres-breach-scan";
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
});
