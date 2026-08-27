import { randomBytes, randomUUID } from "node:crypto";
import { resetServerEnvForTests } from "@/config/server-env";
import { createAccountIfMissing } from "@/core/account-service";
import { addEmailIdentifier } from "@/core/identifier-service";
import { closeDatabase, getDatabase } from "@/database/client";
import { identifierVerifications, users, verificationDeliveryOutbox } from "@/database/schema";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { createDeliveryKeyring } from "@/security/crypto";
import {
  claimVerificationDeliveries,
  completeVerificationDelivery,
  reportVerificationDeliveryFailure,
} from "@/verification/delivery-outbox-service";
import {
  deliveryEncryptionContext,
  encryptDeliveryCommand,
} from "@/verification/delivery-envelope";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const testDeliveryDatabaseUrl = process.env.TEST_DELIVERY_DATABASE_URL;
if (
  process.env.REQUIRE_DATABASE_TESTS === "1" &&
  (!testDatabaseUrl || !testRuntimeDatabaseUrl || !testDeliveryDatabaseUrl)
) {
  throw new Error(
    "TEST_DATABASE_URL, TEST_RUNTIME_DATABASE_URL, and TEST_DELIVERY_DATABASE_URL are required for verification-delivery-outbox integration tests",
  );
}
const describeWithDatabase =
  testDatabaseUrl && testRuntimeDatabaseUrl && testDeliveryDatabaseUrl ? describe : describe.skip;

describeWithDatabase("bounded verification delivery outbox worker", () => {
  const testRunId = Date.now();
  const deliveryKeyring = createDeliveryKeyring({
    keyId: `delivery-outbox-v1-${testRunId}`,
    encryptionKeyBase64: Buffer.alloc(32, 71).toString("base64"),
  });
  const createdUserIds: string[] = [];

  interface SeedOverrides {
    readonly verificationStatus?: "PENDING" | "VERIFIED" | "EXPIRED" | "REVOKED";
    readonly expiresAt?: Date;
    readonly lockedAt?: Date | null;
    readonly accountState?: "ACTIVE" | "DELETION_PENDING";
    readonly maxAttempts?: number;
  }

  async function seedDeliveryFixture(overrides: SeedOverrides = {}) {
    const principal: AuthenticatedPrincipal = {
      subject: `delivery_outbox_fixture_${randomUUID()}`,
      mode: "local",
    };
    const account = await createAccountIfMissing(principal);
    createdUserIds.push(account.userId);
    const created = await addEmailIdentifier(
      account,
      `delivery.outbox.${randomUUID()}@example.test`,
    );

    if (
      overrides.verificationStatus !== undefined ||
      overrides.expiresAt !== undefined ||
      overrides.lockedAt !== undefined
    ) {
      await getDatabase()
        .update(identifierVerifications)
        .set({
          status: overrides.verificationStatus ?? "PENDING",
          expiresAt: overrides.expiresAt ?? new Date(Date.now() + 15 * 60 * 1_000),
          lockedAt: overrides.lockedAt ?? null,
        })
        .where(eq(identifierVerifications.id, created.verificationId));
    }
    if (overrides.accountState === "DELETION_PENDING") {
      await getDatabase()
        .update(users)
        .set({ state: "DELETION_PENDING" })
        .where(eq(users.id, account.userId));
    }

    const deliveryId = randomUUID();
    const encryptedPayload = encryptDeliveryCommand(
      { destination: "fixture@example.test", code: "000000" },
      deliveryEncryptionContext({
        deliveryId,
        verificationId: created.verificationId,
        channel: "EMAIL",
        template: "EMAIL_VERIFICATION_CODE_V1",
      }),
      deliveryKeyring,
    );
    await getDatabase()
      .insert(verificationDeliveryOutbox)
      .values({
        deliveryId,
        verificationId: created.verificationId,
        userId: account.userId,
        channel: "EMAIL",
        template: "EMAIL_VERIFICATION_CODE_V1",
        encryptedPayload,
        state: "PENDING",
        // Claiming is intentionally global. Put this disposable fixture ahead
        // of unrelated eligible rows that a prior interrupted test run may
        // have left in the shared local test database.
        notBefore: new Date(0),
        maxAttempts: overrides.maxAttempts ?? 8,
      });

    return { account, deliveryId, verificationId: created.verificationId };
  }

  async function outboxRow(deliveryId: string) {
    const [row] = await getDatabase()
      .select({
        state: verificationDeliveryOutbox.state,
        encryptedPayload: verificationDeliveryOutbox.encryptedPayload,
        leaseToken: verificationDeliveryOutbox.leaseToken,
        attemptCount: verificationDeliveryOutbox.attemptCount,
        notBefore: verificationDeliveryOutbox.notBefore,
      })
      .from(verificationDeliveryOutbox)
      .where(eq(verificationDeliveryOutbox.deliveryId, deliveryId));
    return row;
  }

  beforeAll(() => {
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.DELIVERY_DATABASE_URL = testDeliveryDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = `delivery_outbox_default_${testRunId}`;
    process.env.ENCRYPTION_KEY_ID = "delivery-outbox-envelope-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 149).toString("base64");
    process.env.LOOKUP_KEY_ID = "delivery-outbox-lookup-v1";
    process.env.LOOKUP_KEY = Buffer.alloc(32, 151).toString("base64");
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await getDatabase().delete(users).where(inArray(users.id, createdUserIds));
    }
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("keeps the delivery login function-only, and denies cross-role execute in both directions", async () => {
    const deliverySql = postgres(testDeliveryDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [capabilities] = await deliverySql<
        {
          currentUser: string;
          superuser: boolean;
          bypassRls: boolean;
          canReadOutbox: boolean;
          canReadVerifications: boolean;
          canReadUsers: boolean;
          canClaim: boolean;
          canComplete: boolean;
          canReportFailure: boolean;
          runtimeCanClaim: boolean;
          lookupRotationCanClaim: boolean;
          maintenanceCanClaim: boolean;
          rotationCanClaim: boolean;
        }[]
      >`
        select
          current_user as "currentUser",
          role.rolsuper as superuser,
          role.rolbypassrls as "bypassRls",
          has_table_privilege(
            current_user, 'public.verification_delivery_outbox', 'SELECT'
          ) as "canReadOutbox",
          has_table_privilege(
            current_user, 'public.identifier_verifications', 'SELECT'
          ) as "canReadVerifications",
          has_table_privilege(current_user, 'public.users', 'SELECT') as "canReadUsers",
          has_function_privilege(
            current_user,
            'public.claim_verification_deliveries(timestamptz,integer,integer,text)',
            'EXECUTE'
          ) as "canClaim",
          has_function_privilege(
            current_user, 'public.complete_verification_delivery(timestamptz,uuid,text)', 'EXECUTE'
          ) as "canComplete",
          has_function_privilege(
            current_user,
            'public.report_verification_delivery_failure(timestamptz,uuid,text,text,integer)',
            'EXECUTE'
          ) as "canReportFailure",
          has_function_privilege(
            'digital_footprint_runtime',
            'public.claim_verification_deliveries(timestamptz,integer,integer,text)',
            'EXECUTE'
          ) as "runtimeCanClaim",
          has_function_privilege(
            'digital_footprint_lookup_rotation',
            'public.claim_verification_deliveries(timestamptz,integer,integer,text)',
            'EXECUTE'
          ) as "lookupRotationCanClaim",
          has_function_privilege(
            'digital_footprint_maintenance',
            'public.claim_verification_deliveries(timestamptz,integer,integer,text)',
            'EXECUTE'
          ) as "maintenanceCanClaim",
          has_function_privilege(
            'digital_footprint_rotation',
            'public.claim_verification_deliveries(timestamptz,integer,integer,text)',
            'EXECUTE'
          ) as "rotationCanClaim"
        from pg_roles as role
        where role.rolname = current_user
      `;
      expect(capabilities).toEqual({
        currentUser: "digital_footprint_delivery",
        superuser: false,
        bypassRls: false,
        canReadOutbox: false,
        canReadVerifications: false,
        canReadUsers: false,
        canClaim: true,
        canComplete: true,
        canReportFailure: true,
        runtimeCanClaim: false,
        lookupRotationCanClaim: false,
        maintenanceCanClaim: false,
        rotationCanClaim: false,
      });

      const functionOwners = await deliverySql<{ canLogin: boolean; bypassRls: boolean }[]>`
        select owner.rolcanlogin as "canLogin", owner.rolbypassrls as "bypassRls"
        from pg_proc as procedure
        inner join pg_roles as owner on owner.oid = procedure.proowner
        where procedure.oid in (
          'public.claim_verification_deliveries(timestamptz,integer,integer,text)'::regprocedure,
          'public.complete_verification_delivery(timestamptz,uuid,text)'::regprocedure,
          'public.report_verification_delivery_failure(timestamptz,uuid,text,text,integer)'::regprocedure
        )
        order by procedure.proname
      `;
      expect(functionOwners).toEqual([
        { canLogin: false, bypassRls: false },
        { canLogin: false, bypassRls: false },
        { canLogin: false, bypassRls: false },
      ]);

      await expect(
        deliverySql`select delivery_id from public.verification_delivery_outbox limit 1`,
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        deliverySql`select public.run_retention_maintenance(now(), 100, now(), now())`,
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await deliverySql.end({ timeout: 5 });
    }
  });

  it("never double-claims under concurrent claim calls, and covers every eligible fixture exactly once", async () => {
    const fixtures = await Promise.all(Array.from({ length: 20 }, () => seedDeliveryFixture()));
    const ourIds = new Set<string>(fixtures.map((fixture) => fixture.deliveryId));

    const concurrentSql = postgres(testDeliveryDatabaseUrl!, { max: 8, prepare: false });
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => {
          const leaseToken = randomBytes(32).toString("base64url");
          return concurrentSql<{ deliveryId: string }[]>`
            select delivery_id as "deliveryId"
            from public.claim_verification_deliveries(now(), 50, 120, ${leaseToken})
          `;
        }),
      );
      const claimedIds = results.flat().map((row) => row.deliveryId);
      expect(new Set(claimedIds).size).toBe(claimedIds.length);

      const ourClaimed = claimedIds.filter((id) => ourIds.has(id));
      expect(new Set(ourClaimed)).toEqual(ourIds);
    } finally {
      await concurrentSql.end({ timeout: 5 });
    }
  });

  it("allows re-claiming a delivery once its lease has expired, under a new token", async () => {
    const fixture = await seedDeliveryFixture();
    const firstClaims = await claimVerificationDeliveries({ batchSize: 200, leaseSeconds: 30 });
    const first = firstClaims.find((claim) => claim.deliveryId === fixture.deliveryId);
    expect(first).toBeDefined();

    await getDatabase()
      .update(verificationDeliveryOutbox)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(verificationDeliveryOutbox.deliveryId, fixture.deliveryId));

    const secondClaims = await claimVerificationDeliveries({ batchSize: 200 });
    const second = secondClaims.find((claim) => claim.deliveryId === fixture.deliveryId);
    expect(second).toBeDefined();
    expect(second!.leaseToken).not.toBe(first!.leaseToken);
  });

  it("rejects a stale lease token with LEASE_MISMATCH and leaves the row unchanged", async () => {
    const fixture = await seedDeliveryFixture();
    const claims = await claimVerificationDeliveries({ batchSize: 200 });
    const ours = claims.find((claim) => claim.deliveryId === fixture.deliveryId);
    expect(ours).toBeDefined();

    const staleToken = randomBytes(32).toString("base64url");
    const outcome = await completeVerificationDelivery(fixture.deliveryId, staleToken);
    expect(outcome).toBe("LEASE_MISMATCH");

    const row = await outboxRow(fixture.deliveryId);
    expect(row.state).toBe("CLAIMED");
    expect(row.leaseToken).toBe(ours!.leaseToken);
  });

  it.each<[string, SeedOverrides]>([
    ["an expired verification", { expiresAt: new Date(Date.now() - 60_000) }],
    ["a revoked verification", { verificationStatus: "REVOKED" }],
    ["a locked verification", { lockedAt: new Date() }],
    ["an already-verified verification", { verificationStatus: "VERIFIED" }],
    ["a DELETION_PENDING account", { accountState: "DELETION_PENDING" }],
  ])("cancels and destroys the payload for %s", async (_label, overrides) => {
    const fixture = await seedDeliveryFixture(overrides);
    const claims = await claimVerificationDeliveries({ batchSize: 200 });
    expect(claims.some((claim) => claim.deliveryId === fixture.deliveryId)).toBe(false);

    const row = await outboxRow(fixture.deliveryId);
    expect(row.state).toBe("CANCELLED");
    expect(row.encryptedPayload).toBeNull();
  });

  it("destroys the payload on completion", async () => {
    const fixture = await seedDeliveryFixture();
    const claims = await claimVerificationDeliveries({ batchSize: 200 });
    const ours = claims.find((claim) => claim.deliveryId === fixture.deliveryId)!;

    const outcome = await completeVerificationDelivery(fixture.deliveryId, ours.leaseToken);
    expect(outcome).toBe("COMPLETED");

    const row = await outboxRow(fixture.deliveryId);
    expect(row.state).toBe("COMPLETED");
    expect(row.encryptedPayload).toBeNull();
  });

  it("reschedules a transient failure with advancing backoff, then auto-dead-letters at max_attempts", async () => {
    const fixture = await seedDeliveryFixture({ maxAttempts: 2 });

    const firstClaim = (await claimVerificationDeliveries({ batchSize: 200 })).find(
      (claim) => claim.deliveryId === fixture.deliveryId,
    )!;
    const firstOutcome = await reportVerificationDeliveryFailure({
      deliveryId: fixture.deliveryId,
      leaseToken: firstClaim.leaseToken,
      outcome: "TRANSIENT",
    });
    expect(firstOutcome).toBe("RETRY_SCHEDULED");

    const afterFirst = await outboxRow(fixture.deliveryId);
    expect(afterFirst.state).toBe("PENDING");
    expect(afterFirst.attemptCount).toBe(1);
    expect(afterFirst.notBefore.getTime()).toBeGreaterThan(Date.now());
    expect(afterFirst.encryptedPayload).not.toBeNull();

    // Force the row claimable again immediately instead of waiting out backoff.
    await getDatabase()
      .update(verificationDeliveryOutbox)
      .set({ notBefore: new Date() })
      .where(eq(verificationDeliveryOutbox.deliveryId, fixture.deliveryId));

    const secondClaim = (await claimVerificationDeliveries({ batchSize: 200 })).find(
      (claim) => claim.deliveryId === fixture.deliveryId,
    )!;
    const secondOutcome = await reportVerificationDeliveryFailure({
      deliveryId: fixture.deliveryId,
      leaseToken: secondClaim.leaseToken,
      outcome: "TRANSIENT",
    });
    expect(secondOutcome).toBe("DEAD_LETTERED");

    const afterSecond = await outboxRow(fixture.deliveryId);
    expect(afterSecond.state).toBe("DEAD_LETTERED");
    expect(afterSecond.attemptCount).toBe(2);
    expect(afterSecond.encryptedPayload).toBeNull();
  });

  it("dead-letters a permanent failure immediately regardless of attempt_count", async () => {
    const fixture = await seedDeliveryFixture({ maxAttempts: 8 });
    const claim = (await claimVerificationDeliveries({ batchSize: 200 })).find(
      (entry) => entry.deliveryId === fixture.deliveryId,
    )!;

    const outcome = await reportVerificationDeliveryFailure({
      deliveryId: fixture.deliveryId,
      leaseToken: claim.leaseToken,
      outcome: "PERMANENT",
    });
    expect(outcome).toBe("DEAD_LETTERED");

    const row = await outboxRow(fixture.deliveryId);
    expect(row.state).toBe("DEAD_LETTERED");
    expect(row.attemptCount).toBe(1);
    expect(row.encryptedPayload).toBeNull();
  });
});
