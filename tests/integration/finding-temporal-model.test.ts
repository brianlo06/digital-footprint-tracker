import { retentionTestLock } from "./retention-test-lock";
import { resetServerEnvForTests } from "@/config/server-env";
import { createAccountIfMissing, type AccountContext } from "@/core/account-service";
import { listTrackedFindings } from "@/core/finding-history";
import { getFindingDetail, reviewFinding } from "@/core/finding-review-service";
import { addEmailIdentifier, verifyEmailIdentifier } from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import { auditEvents, consentRecords, findings, observations, users } from "@/database/schema";
import { runRetentionMaintenance } from "@/privacy/retention-service";
import { withTenantDatabase } from "@/database/tenant";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import { listRecentBreachScans } from "@/providers/breach/breach-scan-history";
import { executePostgresSyntheticBreachScan } from "@/providers/breach/postgres-breach-scan";
import { selectBreachProvider } from "@/providers/provider-registry";
import type { ProviderUsageBudget } from "@/providers/provider-usage-ledger";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const testMaintenanceDatabaseUrl = process.env.TEST_MAINTENANCE_DATABASE_URL;
if (
  process.env.REQUIRE_DATABASE_TESTS === "1" &&
  (!testDatabaseUrl || !testRuntimeDatabaseUrl || !testMaintenanceDatabaseUrl)
) {
  throw new Error(
    "TEST_DATABASE_URL, TEST_RUNTIME_DATABASE_URL, and TEST_MAINTENANCE_DATABASE_URL are required for the integration test command",
  );
}
const describeWithDatabase =
  testDatabaseUrl && testRuntimeDatabaseUrl && testMaintenanceDatabaseUrl
    ? describe
    : describe.skip;

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

  const retentionLock = retentionTestLock(testDatabaseUrl!);

  beforeAll(async () => {
    await retentionLock.acquire();
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.MAINTENANCE_DATABASE_URL = testMaintenanceDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.ENCRYPTION_KEY_ID = "finding-model-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 61).toString("base64");
    process.env.LOOKUP_KEY_ID = "finding-model-lookup-v1";
    process.env.LOOKUP_KEY = Buffer.alloc(32, 62).toString("base64");
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    // Each operation passes its principal/account explicitly.
    process.env.LOCAL_AUTH_SUBJECT = `finding_model_${testRunId}`;
    resetServerEnvForTests();
  });

  afterAll(async () => {
    try {
      for (const userId of userIds) {
        await getDatabase().delete(users).where(eq(users.id, userId));
      }
    } finally {
      await closeDatabase();
      await retentionLock.release();
      resetServerEnvForTests();
    }
  });

  it("creates one deduplicated finding across repeated identical scans", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `finding_dedupe_${testRunId}`,
      mode: "local",
    };
    const account = await prepareAccount(principal, "dedupe");
    const base = Date.now();

    await runScan(account, "SUCCESS", new Date(base));
    await runScan(account, "SUCCESS", new Date(base + 60_000));

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
    expect(rows[0].firstSeenAt).toEqual(new Date(base));
    expect(rows[0].lastSeenAt).toEqual(new Date(base + 60_000));

    // Two runs, two observations, chained oldest to newest.
    const observed = await observationRows(account.userId);
    expect(observed.map((row) => row.presence)).toEqual(["PRESENT", "PRESENT"]);
    expect(observed[0].previousObservationId).toBeNull();
    expect(observed[1].previousObservationId).toBe(observed[0].id);

    // History paging walks both scans newest first without overlap, and the
    // single deduplicated finding does not repeat on a second page.
    const [newest] = await listRecentBreachScans(account, { limit: 1 });
    const [older] = await listRecentBreachScans(account, { limit: 1, offset: 1 });
    expect(newest.scanId).not.toBe(older.scanId);
    expect(newest.startedAt.getTime()).toBeGreaterThan(older.startedAt.getTime());
    expect(await listRecentBreachScans(account, { limit: 1, offset: 2 })).toEqual([]);
    expect(await listTrackedFindings(account, { limit: 1 })).toHaveLength(1);
    expect(await listTrackedFindings(account, { limit: 1, offset: 1 })).toEqual([]);
  });

  it("resolves a finding only after consecutive confirmed absences, then reappears it", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `finding_lifecycle_${testRunId}`,
      mode: "local",
    };
    const account = await prepareAccount(principal, "lifecycle");
    const base = Date.now();

    await runScan(account, "SUCCESS", new Date(base));

    // One clean absence is not enough to call it resolved.
    await runScan(account, "EMPTY", new Date(base + 60_000));
    let [row] = await findingRows(account.userId);
    expect(row).toMatchObject({
      presenceState: "MISSING",
      status: "NEW",
      consecutiveAbsences: 1,
    });

    await runScan(account, "EMPTY", new Date(base + 2 * 60_000));
    [row] = await findingRows(account.userId);
    expect(row).toMatchObject({
      presenceState: "MISSING",
      status: "RESOLVED",
      consecutiveAbsences: 2,
    });

    await runScan(account, "SUCCESS", new Date(base + 3 * 60_000));
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
    const base = Date.now();

    await runScan(account, "SUCCESS", new Date(base));
    const [seeded] = await findingRows(account.userId);

    // Preserve the same provider scope, but return no records while degraded.
    // This exercises indeterminate absence rather than a different finding.
    const degraded = selection("DEGRADED");
    const empty = selection("EMPTY");
    const result = await executePostgresSyntheticBreachScan({
      account,
      now: new Date(base + 60_000),
      providerSelection: {
        ...degraded,
        provider: { ...degraded.provider, scan: empty.provider.scan },
      },
      usageBudget: budget,
    });
    expect(result.status).toBe("COMPLETED");

    const [row] = await findingRows(account.userId);
    // An unhealthy absence must not change the last known presence.
    expect(row).toMatchObject({
      id: seeded.id,
      presenceState: "PRESENT",
      consecutiveAbsences: 0,
    });
    expect((await observationRows(account.userId)).map((entry) => entry.presence)).toEqual([
      "PRESENT",
      "INDETERMINATE",
    ]);
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

    const original = await observationRows(account.userId);
    // Preserve ordering while aging all rows beyond the cutoff. Equal timestamps
    // would select an arbitrary UUID rather than prove the newest row survives.
    const now = new Date();
    for (const [index, observation] of original.entries()) {
      await getDatabase()
        .update(observations)
        .set({ observedAt: new Date(now.getTime() - (740 - index) * 86_400_000) })
        .where(eq(observations.id, observation.id));
    }

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
    expect(remaining[0].id).toBe(original[2].id);
    const repeated = await runRetentionMaintenance({ now });
    expect(repeated.deletedObservations).toBe(0);
    // The finding itself is untouched by observation retention.
    const [finding] = await findingRows(account.userId);
    expect(finding).toMatchObject({ presenceState: "PRESENT", status: "NEW" });
  });

  it("records a review the owner can undo, and that later checks never overwrite", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `finding_review_${testRunId}`,
      mode: "local",
    };
    const strangerPrincipal: AuthenticatedPrincipal = {
      subject: `finding_review_stranger_${testRunId}`,
      mode: "local",
    };
    const account = await prepareAccount(principal, "review");
    const stranger = await prepareAccount(strangerPrincipal, "review-stranger");
    const base = Date.now();
    await runScan(account, "SUCCESS", new Date(base));
    const [{ id: findingId }] = await findingRows(account.userId);

    // Another account can neither read nor review the finding.
    expect(await getFindingDetail(stranger, findingId)).toBeNull();
    expect(await reviewFinding(stranger, findingId, "FALSE_POSITIVE")).toEqual({
      outcome: "NOT_FOUND",
    });
    expect(await reviewFinding(account, "not-a-uuid", "CONFIRMED")).toEqual({
      outcome: "NOT_FOUND",
    });

    expect(await reviewFinding(account, findingId, "RESET")).toEqual({ outcome: "UNCHANGED" });
    expect(await reviewFinding(account, findingId, "FALSE_POSITIVE")).toEqual({
      outcome: "UPDATED",
      status: "FALSE_POSITIVE",
    });
    expect(await reviewFinding(account, findingId, "FALSE_POSITIVE")).toEqual({
      outcome: "UNCHANGED",
    });

    // Dismissed findings leave the default list but stay in the full one.
    expect(await listTrackedFindings(account, { limit: 10, excludeDismissed: true })).toEqual([]);
    expect(await listTrackedFindings(account, { limit: 10 })).toHaveLength(1);

    // Two confirmed absences would resolve an unreviewed finding; a later
    // presence would mark it reappeared. The user's label survives both.
    await runScan(account, "EMPTY", new Date(base + 60_000));
    await runScan(account, "EMPTY", new Date(base + 120_000));
    await runScan(account, "SUCCESS", new Date(base + 180_000));
    const detail = await getFindingDetail(account, findingId);
    expect(detail).toMatchObject({
      status: "FALSE_POSITIVE",
      presenceState: "PRESENT",
      observationsTruncated: false,
    });
    expect(detail!.matchedIdentifierMasked).toMatch(/\*/);
    expect(detail!.observations.map((entry) => entry.presence)).toEqual([
      "PRESENT",
      "MISSING",
      "MISSING",
      "PRESENT",
    ]);
    expect(detail!.observations.every((entry) => !entry.contentChanged)).toBe(true);

    // Undo returns to what automatic rules hold for the current state.
    expect(await reviewFinding(account, findingId, "RESET")).toEqual({
      outcome: "UPDATED",
      status: "NEW",
    });
    expect(await listTrackedFindings(account, { limit: 10, excludeDismissed: true })).toHaveLength(
      1,
    );

    const audited = await getDatabase()
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.targetId, findingId))
      .orderBy(asc(auditEvents.occurredAt));
    expect(audited.map((row) => row.action)).toEqual([
      "FINDING_REVIEW_FALSE_POSITIVE",
      "FINDING_REVIEW_RESET",
    ]);
  });

  it("keeps findings isolated between tenants", async () => {
    const principal: AuthenticatedPrincipal = {
      subject: `finding_tenant_${testRunId}`,
      mode: "local",
    };
    const account = await prepareAccount(principal, "tenant");
    const base = Date.now();
    await runScan(account, "SUCCESS", new Date(base));

    const otherPrincipal: AuthenticatedPrincipal = {
      subject: `finding_tenant_other_${testRunId}`,
      mode: "local",
    };
    const otherAccount = await prepareAccount(otherPrincipal, "tenant-other");

    const visible = await withTenantDatabase(otherPrincipal, (transaction) =>
      transaction.select({ id: findings.id }).from(findings),
    );
    expect(visible).toHaveLength(0);

    await runScan(otherAccount, "SUCCESS", new Date(Date.now() + 60_000));
    const ownVisible = await withTenantDatabase(otherPrincipal, (transaction) =>
      transaction.select({ userId: findings.userId }).from(findings),
    );
    expect(ownVisible).toHaveLength(1);
    expect(ownVisible[0].userId).toBe(otherAccount.userId);
  });
});
