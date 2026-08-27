import { resetServerEnvForTests } from "@/config/server-env";
import { createAccountIfMissing, type AccountContext } from "@/core/account-service";
import { addEmailIdentifier, verifyEmailIdentifier } from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import {
  breachFindings,
  consentRecords,
  providerRuns,
  providerUsageReservations,
  scanJobs,
  scans,
  users,
} from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import { deleteAccount } from "@/privacy/deletion-service";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import {
  cancelQueuedPostgresBreachScan,
  enqueuePostgresSyntheticBreachScan,
} from "@/providers/breach/breach-scan-queue";
import { dispatchQueuedPostgresSyntheticBreachScan } from "@/providers/breach/postgres-breach-scan-job";
import { selectBreachProvider } from "@/providers/provider-registry";
import type { AuthGateway, AuthenticatedPrincipal } from "@/security/auth";
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

/**
 * Exercises the recorded Phase 2 rollback order end to end: kill switch,
 * absent credential, queued-work cancellation with reservation
 * reconciliation, registry removal, and provider-derived data disposition.
 */
describeWithDatabase("breach provider kill-switch rollback exercise", () => {
  const testRunId = Date.now();
  const principal: AuthenticatedPrincipal = {
    subject: `breach_rollback_${testRunId}`,
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
  const enabledSelection = selectBreachProvider({
    appEnvironment: "local",
    provider: "synthetic",
    featureEnabled: true,
    killSwitchActive: false,
  });
  const killSwitchSelection = selectBreachProvider({
    appEnvironment: "local",
    provider: "synthetic",
    featureEnabled: true,
    killSwitchActive: true,
  });
  const registryRemovedSelection = selectBreachProvider({
    appEnvironment: "local",
    provider: "disabled",
    featureEnabled: true,
    killSwitchActive: false,
  });

  let account: AccountContext;

  beforeAll(async () => {
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = principal.subject;
    process.env.ENCRYPTION_KEY_ID = "breach-rollback-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 71).toString("base64");
    process.env.LOOKUP_KEY_ID = "breach-rollback-lookup-v1";
    process.env.LOOKUP_KEY = Buffer.alloc(32, 72).toString("base64");
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();

    account = await createAccountIfMissing(principal);
    const identifier = await addEmailIdentifier(account, "breach.rollback@example.test");
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
  });

  afterAll(async () => {
    await getDatabase().delete(users).where(eq(users.id, account.userId));
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("walks the recorded rollback order without any provider activity", async () => {
    // Queued work exists before the incident begins.
    const queued = await enqueuePostgresSyntheticBreachScan({
      account,
      providerSelection: enabledSelection,
    });
    if (queued.status !== "QUEUED") throw new Error(`unexpected enqueue: ${queued.status}`);

    // Step 1 — the kill switch denies every new request before any row.
    const deniedEnqueue = await enqueuePostgresSyntheticBreachScan({
      account,
      providerSelection: killSwitchSelection,
    });
    expect(deniedEnqueue).toEqual({ status: "PROVIDER_DISABLED" });
    const scansAfterDenied = await getDatabase()
      .select({ id: scans.id })
      .from(scans)
      .where(eq(scans.userId, account.userId));
    expect(scansAfterDenied).toHaveLength(1);

    // Step 1, continued — already-queued work drains to a terminal safe
    // failure without constructing the provider or creating a provider run.
    const drained = await dispatchQueuedPostgresSyntheticBreachScan({
      account,
      scanId: queued.scanId,
      now: new Date(),
      providerSelection: killSwitchSelection,
    });
    expect(drained).toBe("DEAD_LETTERED");
    const [drainedJob] = await getDatabase()
      .select({ state: scanJobs.state, lastErrorSafeCode: scanJobs.lastErrorSafeCode })
      .from(scanJobs)
      .where(eq(scanJobs.scanId, queued.scanId));
    expect(drainedJob).toEqual({ state: "DEAD_LETTERED", lastErrorSafeCode: "PROVIDER_DISABLED" });
    const [drainedScan] = await getDatabase()
      .select({ state: scans.state })
      .from(scans)
      .where(eq(scans.id, queued.scanId));
    expect(drainedScan.state).toBe("FAILED");
    expect(
      await getDatabase()
        .select({ id: providerRuns.id })
        .from(providerRuns)
        .where(eq(providerRuns.userId, account.userId)),
    ).toHaveLength(0);

    // Step 2 (credential revocation) has nothing to revoke: server
    // environment validation separately rejects any non-empty breach API
    // key, and no reservation was consumed that would need reconciling.
    expect(
      await getDatabase()
        .select({ id: providerUsageReservations.id })
        .from(providerUsageReservations)
        .where(eq(providerUsageReservations.userId, account.userId)),
    ).toHaveLength(0);

    // Step 3 — pre-dispatch work is cancelled, not retried or fanned out,
    // and still consumes no reservation capacity.
    const requeued = await enqueuePostgresSyntheticBreachScan({
      account,
      providerSelection: enabledSelection,
    });
    if (requeued.status !== "QUEUED") throw new Error(`unexpected enqueue: ${requeued.status}`);
    expect(await cancelQueuedPostgresBreachScan(account, requeued.scanId)).toBe("CANCELLED");
    const [cancelledScan] = await getDatabase()
      .select({ state: scans.state })
      .from(scans)
      .where(eq(scans.id, requeued.scanId));
    expect(cancelledScan.state).toBe("CANCELLED");
    expect(
      await getDatabase()
        .select({ id: providerUsageReservations.id })
        .from(providerUsageReservations)
        .where(eq(providerUsageReservations.userId, account.userId)),
    ).toHaveLength(0);

    // Step 4 — removing the adapter from the registry keeps every later
    // request denied even with the kill switch released.
    expect(registryRemovedSelection.status).toBe("DISABLED");
    expect(
      await enqueuePostgresSyntheticBreachScan({
        account,
        providerSelection: registryRemovedSelection,
      }),
    ).toEqual({ status: "PROVIDER_DISABLED" });

    // Step 5 — account deletion disposes of every provider-derived row.
    await deleteAccount(principal, authGateway, { recentlyReauthenticated: true });
    const database = getDatabase();
    expect(
      await database.select({ id: scans.id }).from(scans).where(eq(scans.userId, account.userId)),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: scanJobs.id })
        .from(scanJobs)
        .where(eq(scanJobs.userId, account.userId)),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: providerRuns.id })
        .from(providerRuns)
        .where(eq(providerRuns.userId, account.userId)),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: breachFindings.id })
        .from(breachFindings)
        .where(eq(breachFindings.userId, account.userId)),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: providerUsageReservations.id })
        .from(providerUsageReservations)
        .where(eq(providerUsageReservations.userId, account.userId)),
    ).toHaveLength(0);
  });
});
