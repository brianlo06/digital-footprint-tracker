import { randomUUID } from "node:crypto";
import { createAccountIfMissing } from "@/core/account-service";
import { addEmailIdentifier, verifyEmailIdentifier } from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import { consentRecords, providerUsageReservations, users } from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import { executeSyntheticBreachInvocation } from "@/providers/breach/breach-invocation-service";
import { executePostgresSyntheticBreachInvocation } from "@/providers/breach/postgres-breach-invocation";
import { PostgresBreachInvocationAuthorizationStore } from "@/providers/breach/postgres-breach-authorization-store";
import { PostgresProviderUsageLedger } from "@/providers/postgres-usage-ledger";
import { selectBreachProvider } from "@/providers/provider-registry";
import type { ProviderUsageBudget } from "@/providers/provider-usage-ledger";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { resetServerEnvForTests } from "@/config/server-env";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.REQUIRE_DATABASE_TESTS === "1" && (!testDatabaseUrl || !testRuntimeDatabaseUrl)) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required for the integration test command",
  );
}
const describeWithDatabase = testDatabaseUrl && testRuntimeDatabaseUrl ? describe : describe.skip;

describeWithDatabase("durable provider usage and authorization boundary", () => {
  const testRunId = Date.now();
  const ownerPrincipal: AuthenticatedPrincipal = {
    subject: `provider_usage_owner_${testRunId}`,
    mode: "local",
  };
  const otherPrincipal: AuthenticatedPrincipal = {
    subject: `provider_usage_other_${testRunId}`,
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
    maxProviderDailyRequests: 5,
    maxProviderMonthlyRequests: 5,
    maxProviderDailyCostUnits: 0,
    maxProviderMonthlyCostUnits: 0,
  };
  const userIds: string[] = [];
  let ownerCommand: Parameters<typeof executeSyntheticBreachInvocation>[0]["command"];
  let otherCommand: Parameters<typeof executeSyntheticBreachInvocation>[0]["command"];

  async function prepareCommand(principal: AuthenticatedPrincipal, sequence: string) {
    const account = await createAccountIfMissing(principal);
    userIds.push(account.userId);
    const identifier = await addEmailIdentifier(account, `provider.usage.${sequence}@example.test`);
    await verifyEmailIdentifier(account, identifier.verificationId, "000000");
    const consentRecordId = randomUUID();
    await withTenantDatabase(principal, async (transaction) => {
      await transaction.insert(consentRecords).values({
        id: consentRecordId,
        userId: account.userId,
        identityId: account.identityId,
        purpose: BREACH_CONSENT_PURPOSE,
        policyVersion: BREACH_CONSENT_POLICY_VERSION,
        dataCategories: ["EMAIL_IDENTIFIER", "BREACH_METADATA"],
        state: "GRANTED",
      });
    });
    return {
      userId: account.userId,
      identityId: account.identityId,
      identifierId: identifier.identifierId,
      consentRecordId,
      scanId: randomUUID(),
      providerRunId: randomUUID(),
      idempotencyKey: `postgres:provider:${sequence}:${randomUUID()}`,
      deadline: "2099-01-01T00:00:00.000Z",
      maxResults: 10,
    };
  }

  async function invoke(
    principal: AuthenticatedPrincipal,
    command: typeof ownerCommand,
    usageBudget?: ProviderUsageBudget,
    providerSelection = selection,
  ) {
    return executePostgresSyntheticBreachInvocation({
      principal,
      command,
      now: new Date(),
      providerSelection,
      usageBudget,
    });
  }

  beforeAll(async () => {
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = ownerPrincipal.subject;
    process.env.ENCRYPTION_KEY_ID = "provider-usage-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 81).toString("base64");
    process.env.LOOKUP_KEY_ID = "provider-usage-lookup-v1";
    process.env.LOOKUP_KEY = Buffer.alloc(32, 82).toString("base64");
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();

    ownerCommand = await prepareCommand(ownerPrincipal, "owner");
    otherCommand = await prepareCommand(otherPrincipal, "other");
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      await getDatabase().delete(users).where(inArray(users.id, userIds));
    }
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("loads only an exact tenant-owned authorization snapshot", async () => {
    await expect(
      withTenantDatabase(ownerPrincipal, (transaction) =>
        new PostgresBreachInvocationAuthorizationStore(transaction).load(ownerCommand),
      ),
    ).resolves.toMatchObject({
      account: { userId: ownerCommand.userId, state: "ACTIVE" },
      identifier: {
        identifierId: ownerCommand.identifierId,
        type: "EMAIL",
        verificationStatus: "VERIFIED",
      },
      consent: {
        consentRecordId: ownerCommand.consentRecordId,
        purpose: BREACH_CONSENT_PURPOSE,
      },
    });

    await expect(
      withTenantDatabase(otherPrincipal, (transaction) =>
        new PostgresBreachInvocationAuthorizationStore(transaction).load(ownerCommand),
      ),
    ).resolves.toBeNull();
  });

  it("persists and reconciles one synthetic invocation idempotently", async () => {
    const first = await invoke(ownerPrincipal, ownerCommand, budget);
    expect(first).toMatchObject({ status: "COMPLETED" });
    await expect(invoke(ownerPrincipal, ownerCommand, budget)).resolves.toMatchObject({
      status: "ALREADY_PROCESSED",
      reservationId: first.status === "COMPLETED" ? first.reservationId : "unexpected",
    });

    const [stored] = await getDatabase()
      .select()
      .from(providerUsageReservations)
      .where(eq(providerUsageReservations.userId, ownerCommand.userId));
    expect(stored).toMatchObject({
      providerId: "synthetic-breach",
      state: "COMPLETED",
      estimatedCostUnits: 0,
      actualCostUnits: 0,
    });
  });

  it("serializes concurrent provider-cap reservations across tenants", async () => {
    const providerId = `synthetic-cap-${testRunId}`;
    const oneRequestBudget = { ...budget, maxProviderDailyRequests: 1 };
    const reserve = (principal: AuthenticatedPrincipal, userId: string, suffix: string) =>
      withTenantDatabase(principal, (transaction) =>
        new PostgresProviderUsageLedger(transaction).reserve(
          {
            userId,
            providerId,
            idempotencyKey: `postgres:concurrent:${suffix}:${randomUUID()}`,
            requestFingerprint: `postgres:concurrent:${suffix}:${randomUUID()}`,
            estimatedCostUnits: 0,
            now: new Date(),
          },
          oneRequestBudget,
        ),
      );

    const decisions = await Promise.all([
      reserve(ownerPrincipal, ownerCommand.userId, "owner"),
      reserve(otherPrincipal, otherCommand.userId, "other"),
    ]);
    expect(decisions.filter((decision) => decision.status === "RESERVED")).toHaveLength(1);
    expect(decisions).toContainEqual({
      status: "DENIED",
      reason: "PROVIDER_DAILY_REQUEST_LIMIT",
    });
  });

  it("enforces provider caps across tenants and zero defaults", async () => {
    const oneProviderRequest = { ...budget, maxProviderDailyRequests: 1 };
    await expect(invoke(otherPrincipal, otherCommand, oneProviderRequest)).resolves.toEqual({
      status: "DENIED",
      reason: "PROVIDER_DAILY_REQUEST_LIMIT",
    });

    const zeroDefaultCommand = {
      ...otherCommand,
      scanId: randomUUID(),
      providerRunId: randomUUID(),
      idempotencyKey: `postgres:provider:zero:${randomUUID()}`,
    };
    await expect(invoke(otherPrincipal, zeroDefaultCommand, undefined)).resolves.toEqual({
      status: "DENIED",
      reason: "USER_DAILY_REQUEST_LIMIT",
    });
  });

  it("denies cross-tenant completion even when a reservation UUID is known", async () => {
    const [stored] = await getDatabase()
      .select({ id: providerUsageReservations.id })
      .from(providerUsageReservations)
      .where(eq(providerUsageReservations.userId, ownerCommand.userId));

    await expect(
      withTenantDatabase(otherPrincipal, (transaction) =>
        new PostgresProviderUsageLedger(transaction).complete(stored.id, "COMPLETED", 0),
      ),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "42501" }) });

    await expect(
      withTenantDatabase(ownerPrincipal, (transaction) =>
        transaction.execute(sql`
          select * from public.complete_provider_usage(
            ${stored.id}::uuid, null::public.provider_usage_state, 0
          )
        `),
      ),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "22023" }) });
  });

  it("commits a failed reservation before rethrowing a synthetic provider error", async () => {
    const failedCommand = {
      ...otherCommand,
      scanId: randomUUID(),
      providerRunId: randomUUID(),
      idempotencyKey: `postgres:provider:failed:${randomUUID()}`,
    };
    const failureSelection = selectBreachProvider({
      appEnvironment: "local",
      provider: "synthetic",
      featureEnabled: true,
      killSwitchActive: false,
      syntheticScenario: "RATE_LIMIT",
    });

    await expect(
      invoke(
        otherPrincipal,
        failedCommand,
        { ...budget, maxProviderDailyRequests: 10 },
        failureSelection,
      ),
    ).rejects.toMatchObject({
      descriptor: { kind: "RATE_LIMIT", safeCode: "PROVIDER_RATE_LIMITED" },
    });
    const [stored] = await getDatabase()
      .select({ state: providerUsageReservations.state })
      .from(providerUsageReservations)
      .where(eq(providerUsageReservations.idempotencyKey, failedCommand.idempotencyKey));
    expect(stored).toEqual({ state: "FAILED" });
  });
});
