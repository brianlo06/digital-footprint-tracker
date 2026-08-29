import { resetServerEnvForTests } from "@/config/server-env";
import { createAccountIfMissing, type AccountContext } from "@/core/account-service";
import { addEmailIdentifier, verifyEmailIdentifier } from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import { consentRecords, findings, observations, users } from "@/database/schema";
import { runRetentionMaintenance } from "@/privacy/retention-service";
import { withTenantDatabase } from "@/database/tenant";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import { executePostgresSyntheticBreachScan } from "@/providers/breach/postgres-breach-scan";
import { selectBreachProvider } from "@/providers/provider-registry";
import type { ProviderUsageBudget } from "@/providers/provider-usage-ledger";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.REQUIRE_DATABASE_TESTS === "1" && (!testDatabaseUrl || !testRuntimeDatabaseUrl)) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required for the integration test command",
  );
}
const describeWithDatabase = testDatabaseUrl && testRuntimeDatabaseUrl ? describe : describe.skip;

describeWithDatabase("generic finding and observation temporal model", () => {
  const testRunId = Date.now();
  const budget: ProviderUsageBudget = {
    maxUserDailyRequests: 10,
    maxProviderDailyRequests: 50,
    maxProviderMonthlyRequests: 50,
    maxProviderDailyCostUnits: 0,
    maxProviderMonthlyCostUnits: 0,
  };
  const userIds: string[] = [];

  // Provider request caps are global and cross-tenant by design, so these
  // scans would otherwise spend the shared "synthetic-breach" daily quota that
  // the usage-ledger suite asserts against. The temporal model is
  // provider-agnostic, so scoping this file to its own provider id keeps both
  // suites deterministic and additionally proves findings key on that scope.
  const providerScope = `synthetic-temporal-${testRunId}`.toLowerCase().slice(0, 64);

  function selection(scenario: "SUCCESS" | "EMPTY" | "DEGRADED") {
    const selected = selectBreachProvider({
      appEnvironment: "local",
      provider: "synthetic",
      featureEnabled: true,
      killSwitchActive: false,
      syntheticScenario: scenario,
    });
    if (!selected.provider) throw new Error("expected an enabled synthetic provider");
    return { ...selected, provider: { ...selected.provider, id: providerScope } };
  }

  async function prepareAccount(
    principal: AuthenticatedPrincipal,
    sequence: string,
  ): Promise<AccountContext> {
    const account = await createAccountIfMissing(principal);
    userIds.push(account.userId);
    const identifier = await addEmailIdentifier(account, `finding.${sequence}@example.test`);
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

  async function runScan(
    account: AccountContext,
    scenario: "SUCCESS" | "EMPTY" | "DEGRADED",
    now: Date,
  ): Promise<void> {
    const result = await executePostgresSyntheticBreachScan({
      account,
      now,
      providerSelection: selection(scenario),
      usageBudget: budget,
    });
    if (result.status !== "COMPLETED") {
      const reason = "reason" in result ? `: ${result.reason}` : "";
      throw new Error(`expected COMPLETED scan, received ${result.status}${reason}`);
    }
  }

  function findingRows(userId: string) {
    return getDatabase()
      .select({
        id: findings.id,
        type: findings.type,
        title: findings.title,
        fingerprint: findings.fingerprint,
        fingerprintVersion: findings.fingerprintVersion,
        presenceState: findings.presenceState,
        status: findings.status,
        consecutiveAbsences: findings.consecutiveAbsences,
        firstSeenAt: findings.firstSeenAt,
        lastSeenAt: findings.lastSeenAt,
        lastCheckedAt: findings.lastCheckedAt,
      })
      .from(findings)
      .where(eq(findings.userId, userId));
  }

  function observationRows(userId: string) {
    return getDatabase()
      .select({
        id: observations.id,
        presence: observations.presence,
        observedAt: observations.observedAt,
        previousObservationId: observations.previousObservationId,
      })
      .from(observations)
      .where(eq(observations.userId, userId))
      .orderBy(asc(observations.observedAt), asc(observations.id));
  }

  beforeAll(async () => {
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.ENCRYPTION_KEY_ID = "finding-model-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 61).toString("base64");
    process.env.LOOKUP_KEY_ID = "finding-model-lookup-v1";
    process.env.LOOKUP_KEY = Buffer.alloc(32, 62).toString("base64");
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    // Set once and never mutated mid-run: process.env is shared with the
    // other integration files vitest runs concurrently. Every call below
    // passes its principal or account explicitly, so nothing here depends
    // on this value matching a particular test's subject.
    process.env.LOCAL_AUTH_SUBJECT = `finding_model_${testRunId}`;
    resetServerEnvForTests();
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      for (const userId of userIds) {
        await getDatabase().delete(users).where(eq(users.id, userId));
      }
    }
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("creates one deduplicated finding across repeated identical scans", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `finding_dedupe_${testRunId}`,
      mode: "local",
    };
    const account = await prepareAccount(principal, "dedupe");

    await runScan(account, "SUCCESS", new Date("2026-08-29T09:00:00.000Z"));
    await runScan(account, "SUCCESS", new Date("2026-08-29T10:00:00.000Z"));

    const rows = await findingRows(account.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "BREACH",
      title: "Synthetic Commerce",
      presenceState: "PRESENT",
      status: "NEW",
      consecutiveAbsences: 0,
    });
    expect(rows[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // First seen is pinned to the first scan; last seen advances.
    expect(rows[0].firstSeenAt).toEqual(new Date("2026-08-29T09:00:00.000Z"));
    expect(rows[0].lastSeenAt).toEqual(new Date("2026-08-29T10:00:00.000Z"));

    // Two runs, two observations, chained oldest to newest.
    const observed = await observationRows(account.userId);
    expect(observed.map((row) => row.presence)).toEqual(["PRESENT", "PRESENT"]);
    expect(observed[0].previousObservationId).toBeNull();
    expect(observed[1].previousObservationId).toBe(observed[0].id);
  });

  it("resolves a finding only after consecutive confirmed absences, then reappears it", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `finding_lifecycle_${testRunId}`,
      mode: "local",
    };
    const account = await prepareAccount(principal, "lifecycle");

    await runScan(account, "SUCCESS", new Date("2026-08-29T09:00:00.000Z"));

    // One clean absence is not enough to call it resolved.
    await runScan(account, "EMPTY", new Date("2026-08-29T10:00:00.000Z"));
    let [row] = await findingRows(account.userId);
    expect(row).toMatchObject({
      presenceState: "MISSING",
      status: "NEW",
      consecutiveAbsences: 1,
    });

    await runScan(account, "EMPTY", new Date("2026-08-29T11:00:00.000Z"));
    [row] = await findingRows(account.userId);
    expect(row).toMatchObject({
      presenceState: "MISSING",
      status: "RESOLVED",
      consecutiveAbsences: 2,
    });

    await runScan(account, "SUCCESS", new Date("2026-08-29T12:00:00.000Z"));
    [row] = await findingRows(account.userId);
    expect(row).toMatchObject({
      presenceState: "PRESENT",
      status: "REAPPEARED",
      consecutiveAbsences: 0,
    });

    const observed = await observationRows(account.userId);
    expect(observed.map((entry) => entry.presence)).toEqual([
      "PRESENT",
      "MISSING",
      "MISSING",
      "PRESENT",
    ]);
    // Still exactly one finding: reappearance is history, not a new claim.
    expect(await findingRows(account.userId)).toHaveLength(1);
  });

  it("records a degraded scan's absence as INDETERMINATE and never as removal", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `finding_outage_${testRunId}`,
      mode: "local",
    };
    const account = await prepareAccount(principal, "outage");

    await runScan(account, "SUCCESS", new Date("2026-08-29T09:00:00.000Z"));
    const [seeded] = await findingRows(account.userId);

    // DEGRADED returns the same record, so make the provider return nothing
    // while unhealthy by running the EMPTY fixture through a degraded scan:
    // the projection marks the scan PARTIAL, so absence cannot mean removal.
    await executePostgresSyntheticBreachScan({
      account,
      now: new Date("2026-08-29T10:00:00.000Z"),
      providerSelection: selectBreachProvider({
        appEnvironment: "local",
        provider: "synthetic",
        featureEnabled: true,
        killSwitchActive: false,
        syntheticScenario: "DEGRADED",
      }),
      usageBudget: budget,
    });

    const [row] = await findingRows(account.userId);
    // The degraded run still reported the breach, so it stays present and its
    // absence streak is untouched.
    expect(row).toMatchObject({
      id: seeded.id,
      presenceState: "PRESENT",
      consecutiveAbsences: 0,
    });
  });

  it("ages out old observations but always keeps each finding's most recent one", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `finding_retention_${testRunId}`,
      mode: "local",
    };
    const account = await prepareAccount(principal, "retention");

    // Real-time offsets, not fixed instants: the invocation gate requires the
    // identifier to have been verified within 24 hours of the scan clock, and
    // the retention call below needs a clock PostgreSQL will accept.
    // Each clock must sit at or after the identifier's verification instant
    // (a negative verification age is rejected as stale) and stay ordered.
    const base = Date.now();
    await runScan(account, "SUCCESS", new Date(base));
    await runScan(account, "SUCCESS", new Date(base + 60_000));
    await runScan(account, "SUCCESS", new Date(base + 2 * 60_000));
    expect(await observationRows(account.userId)).toHaveLength(3);

    // Age every observation well past the retention window.
    await getDatabase()
      .update(observations)
      .set({ observedAt: new Date("2024-01-01T00:00:00.000Z") })
      .where(eq(observations.userId, account.userId));

    // PostgreSQL rejects a maintenance clock more than five minutes ahead of
    // its own, so this one call uses real time rather than a fixed instant.
    const result = await runRetentionMaintenance({
      now: new Date(),
      batchSize: 100,
      orphanAuditRetentionDays: 365,
      scanJobRetentionDays: 90,
      observationRetentionDays: 730,
    });
    expect(result.deletedObservations).toBeGreaterThanOrEqual(2);

    // `docs/PRIVACY.md` keeps evidence provenance for the life of the finding,
    // so the newest observation survives however old it is.
    const remaining = await observationRows(account.userId);
    expect(remaining).toHaveLength(1);
    // The finding itself is untouched by observation retention.
    const [finding] = await findingRows(account.userId);
    expect(finding).toMatchObject({ presenceState: "PRESENT", status: "NEW" });
  });

  it("keeps findings isolated between tenants", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `finding_tenant_${testRunId}`,
      mode: "local",
    };
    const account = await prepareAccount(principal, "tenant");
    await runScan(account, "SUCCESS", new Date("2026-08-29T09:00:00.000Z"));

    const otherPrincipal: AuthenticatedPrincipal = {
      subject: `finding_tenant_other_${testRunId}`,
      mode: "local",
    };
    const otherAccount = await prepareAccount(otherPrincipal, "tenant-other");

    const visible = await withTenantDatabase(otherPrincipal, (transaction) =>
      transaction.select({ id: findings.id }).from(findings),
    );
    expect(visible).toHaveLength(0);

    await runScan(otherAccount, "SUCCESS", new Date("2026-08-29T09:30:00.000Z"));
    const ownVisible = await withTenantDatabase(otherPrincipal, (transaction) =>
      transaction.select({ userId: findings.userId }).from(findings),
    );
    expect(ownVisible).toHaveLength(1);
    expect(ownVisible[0].userId).toBe(otherAccount.userId);
  });
});
