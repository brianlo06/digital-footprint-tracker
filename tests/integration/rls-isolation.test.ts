import { randomUUID } from "node:crypto";
import { createAccountIfMissing } from "@/core/account-service";
import { addEmailIdentifier } from "@/core/identifier-service";
import { resetServerEnvForTests } from "@/config/server-env";
import { closeDatabase, getDatabase } from "@/database/client";
import {
  deletionReceipts,
  identifiers,
  identifierVerifications,
  users,
  verificationDeliveryOutbox,
} from "@/database/schema";
import { deletionSubjectToken } from "@/database/tenant";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.REQUIRE_DATABASE_TESTS === "1" && (!testDatabaseUrl || !testRuntimeDatabaseUrl)) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required for the integration test command",
  );
}
const describeWithDatabase = testDatabaseUrl && testRuntimeDatabaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL row-level tenant isolation", () => {
  const testRunId = Date.now();
  const ownerPrincipal: AuthenticatedPrincipal = {
    subject: `rls_owner_${testRunId}`,
    mode: "local",
  };
  const otherPrincipal: AuthenticatedPrincipal = {
    subject: `rls_other_${testRunId}`,
    mode: "local",
  };
  const receiptIds = [randomUUID(), randomUUID()];
  const runtimeSql = postgres(testRuntimeDatabaseUrl!, { max: 1, prepare: false });
  let ownerUserId = "";
  let otherUserId = "";
  let ownerIdentifierId = "";

  async function withRawTenant<T>(
    principal: AuthenticatedPrincipal,
    operation: (transaction: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    const subjectToken = deletionSubjectToken(principal.subject);
    return (await runtimeSql.begin(async (transaction) => {
      await transaction`
        select
          set_config('app.auth_subject', ${principal.subject}, true),
          set_config('app.subject_token', ${subjectToken}, true)
      `;
      return operation(transaction);
    })) as unknown as T;
  }

  beforeAll(async () => {
    // process.env is a shared global; another concurrently running
    // integration test file may have left a previous lookup key set.
    delete process.env.PREVIOUS_LOOKUP_KEY_ID;
    delete process.env.PREVIOUS_LOOKUP_KEY;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = ownerPrincipal.subject;
    process.env.ENCRYPTION_KEY_ID = "rls-isolation-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 53).toString("base64");
    process.env.LOOKUP_KEY = Buffer.alloc(32, 59).toString("base64");
    process.env.LOOKUP_KEY_ID = "rls-isolation-lookup-v1";
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();

    const owner = await createAccountIfMissing(ownerPrincipal);
    const other = await createAccountIfMissing(otherPrincipal);
    const identifier = await addEmailIdentifier(owner, "rls.owner@example.test");
    ownerUserId = owner.userId;
    otherUserId = other.userId;
    ownerIdentifierId = identifier.identifierId;

    await getDatabase()
      .insert(deletionReceipts)
      .values([
        {
          id: receiptIds[0],
          subjectToken: deletionSubjectToken(ownerPrincipal.subject),
          state: "COMPLETED",
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        {
          id: receiptIds[1],
          subjectToken: deletionSubjectToken(otherPrincipal.subject),
          state: "COMPLETED",
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ]);
  });

  afterAll(async () => {
    if (ownerUserId && otherUserId) {
      await getDatabase()
        .delete(users)
        .where(inArray(users.id, [ownerUserId, otherUserId]));
    }
    await getDatabase().delete(deletionReceipts).where(inArray(deletionReceipts.id, receiptIds));
    await runtimeSql.end({ timeout: 5 });
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("uses a non-bypass role and forces RLS on every tenant table", async () => {
    const [role] = await runtimeSql<
      {
        currentUser: string;
        superuser: boolean;
        bypassRls: boolean;
        canExecuteRetention: boolean;
      }[]
    >`
      select
        current_user as "currentUser",
        rolsuper as superuser,
        rolbypassrls as "bypassRls",
        has_function_privilege(
          current_user,
          'public.run_retention_maintenance(timestamptz,integer,timestamptz)',
          'EXECUTE'
        ) as "canExecuteRetention"
      from pg_roles
      where rolname = current_user
    `;
    expect(role).toEqual({
      currentUser: "digital_footprint_runtime",
      superuser: false,
      bypassRls: false,
      canExecuteRetention: false,
    });

    const protectedTables = await runtimeSql<{ name: string; enabled: boolean; forced: boolean }[]>`
      select
        relname as name,
        relrowsecurity as enabled,
        relforcerowsecurity as forced
      from pg_class
      where relname in (
        'users',
        'identities',
        'identifiers',
        'identifier_lookup_tokens',
        'identifier_verifications',
        'consent_records',
        'audit_events',
        'deletion_receipts',
        'provider_usage_reservations',
        'rate_limit_windows',
        'verification_delivery_outbox'
      )
      order by relname
    `;
    expect(protectedTables).toHaveLength(11);
    expect(protectedTables.every((table) => table.enabled && table.forced)).toBe(true);
  });

  it("lets runtime insert into the delivery outbox but denies direct read or write", async () => {
    const [verificationRow] = await getDatabase()
      .select({ id: identifierVerifications.id })
      .from(identifierVerifications)
      .where(eq(identifierVerifications.identifierId, ownerIdentifierId));

    const deliveryId = randomUUID();
    await expect(
      withRawTenant(ownerPrincipal, async (transaction) => {
        await transaction`
          insert into verification_delivery_outbox (
            delivery_id, verification_id, user_id, template, encrypted_payload, state
          ) values (
            ${deliveryId}, ${verificationRow.id}, ${ownerUserId},
            'EMAIL_VERIFICATION_CODE_V1', ${JSON.stringify({ placeholder: true })}, 'PENDING'
          )
        `;
      }),
    ).resolves.not.toThrow();

    await expect(
      runtimeSql`select 1 from verification_delivery_outbox where delivery_id = ${deliveryId}`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtimeSql`
        update verification_delivery_outbox
        set state = 'CANCELLED'
        where delivery_id = ${deliveryId}
      `,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtimeSql`delete from verification_delivery_outbox where delivery_id = ${deliveryId}`,
    ).rejects.toMatchObject({ code: "42501" });

    await getDatabase()
      .delete(verificationDeliveryOutbox)
      .where(eq(verificationDeliveryOutbox.deliveryId, deliveryId));
  });

  it("denies direct runtime access to the provider usage ledger", async () => {
    await expect(runtimeSql`select 1 from provider_usage_reservations`).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      runtimeSql`
        insert into provider_usage_reservations (
          user_id, provider_id, idempotency_key, request_fingerprint, estimated_cost_units
        ) values (
          ${ownerUserId}, 'synthetic-breach', 'forbidden:provider:usage',
          'forbidden:provider:fingerprint', 0
        )
      `,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("fails closed without context and does not leak transaction-local identity", async () => {
    const beforeContext = await runtimeSql<{ count: number }[]>`
      select count(*)::int as count from users
    `;
    expect(beforeContext[0].count).toBe(0);

    await expect(
      runtimeSql`insert into users (auth_subject) values (${`rls_forbidden_${testRunId}`})`,
    ).rejects.toMatchObject({ code: "42501" });

    await withRawTenant(ownerPrincipal, async (transaction) => {
      const visible = await transaction<{ id: string }[]>`select id from users`;
      expect(visible).toEqual([{ id: ownerUserId }]);
    });

    const afterContext = await runtimeSql<{ count: number }[]>`
      select count(*)::int as count from users
    `;
    expect(afterContext[0].count).toBe(0);
  });

  it("blocks cross-tenant reads and mutations at the database boundary", async () => {
    await withRawTenant(otherPrincipal, async (transaction) => {
      const visibleUsers = await transaction<{ id: string }[]>`select id from users`;
      expect(visibleUsers).toEqual([{ id: otherUserId }]);

      const ownerIdentifiers = await transaction<{ id: string }[]>`
        select id from identifiers where id = ${ownerIdentifierId}
      `;
      expect(ownerIdentifiers).toHaveLength(0);

      const updated = await transaction<{ id: string }[]>`
        update identifiers
        set masked_display = 'cross-tenant-write'
        where id = ${ownerIdentifierId}
        returning id
      `;
      expect(updated).toHaveLength(0);

      const ownerLookupTokens = await transaction<{ identifierId: string }[]>`
        select identifier_id as "identifierId"
        from identifier_lookup_tokens
        where identifier_id = ${ownerIdentifierId}
      `;
      expect(ownerLookupTokens).toHaveLength(0);
    });

    await withRawTenant(ownerPrincipal, async (transaction) => {
      const ownerLookupTokens = await transaction<{ identifierId: string }[]>`
        select identifier_id as "identifierId"
        from identifier_lookup_tokens
        where identifier_id = ${ownerIdentifierId}
      `;
      expect(ownerLookupTokens.length).toBeGreaterThan(0);
    });

    await expect(
      withRawTenant(otherPrincipal, async (transaction) => {
        await transaction`
          insert into identities (id, user_id, label)
          values (${randomUUID()}, ${ownerUserId}, 'forbidden')
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });

    const [stored] = await getDatabase()
      .select({ maskedDisplay: identifiers.maskedDisplay })
      .from(identifiers)
      .where(eq(identifiers.id, ownerIdentifierId));
    expect(stored.maskedDisplay).toBe("r***@***.test");
  });

  it("scopes durable deletion receipts by pseudonymous subject token", async () => {
    await withRawTenant(ownerPrincipal, async (transaction) => {
      const receipts = await transaction<{ id: string }[]>`
        select id from deletion_receipts order by id
      `;
      expect(receipts).toEqual([{ id: receiptIds[0] }]);
    });

    await withRawTenant(otherPrincipal, async (transaction) => {
      const receipts = await transaction<{ id: string }[]>`
        select id from deletion_receipts order by id
      `;
      expect(receipts).toEqual([{ id: receiptIds[1] }]);
    });
  });
});
