import { resetServerEnvForTests } from "@/config/server-env";
import { closeDatabase, getDatabase } from "@/database/client";
import { rateLimitWindows } from "@/database/schema";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { createLookupToken } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { consumeActionRateLimit } from "@/security/rate-limit";
import { inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.REQUIRE_DATABASE_TESTS === "1" && (!testDatabaseUrl || !testRuntimeDatabaseUrl)) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required for rate-limit integration tests",
  );
}
const describeWithDatabase = testDatabaseUrl && testRuntimeDatabaseUrl ? describe : describe.skip;

describeWithDatabase("distributed action rate limits", () => {
  const testRunId = Date.now();
  const networkOne = `192.0.2.${(testRunId % 200) + 1}`;
  const networkTwo = `198.51.100.${(testRunId % 200) + 1}`;
  const primaryPrincipal: AuthenticatedPrincipal = {
    subject: `rate_limit_primary_${testRunId}`,
    mode: "local",
  };
  const runtimeSql = postgres(testRuntimeDatabaseUrl!, { max: 1, prepare: false });
  const scopeTokens = new Set<string>();

  function rememberTokens(subject: string, network: string): void {
    const keyring = getApplicationKeyring();
    scopeTokens.add(createLookupToken(subject, "rate-limit-user:v1", keyring));
    scopeTokens.add(createLookupToken(network, "rate-limit-network:v1", keyring));
  }

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RUNTIME_DATABASE_URL = testRuntimeDatabaseUrl;
    process.env.APP_ENV = "local";
    process.env.AUTH_MODE = "local";
    process.env.LOCAL_AUTH_SUBJECT = primaryPrincipal.subject;
    process.env.ENCRYPTION_KEY_ID = "rate-limit-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 71).toString("base64");
    process.env.LOOKUP_KEY = Buffer.alloc(32, 73).toString("base64");
    process.env.LOOKUP_KEY_ID = "rate-limit-lookup-v1";
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    resetServerEnvForTests();
  });

  afterAll(async () => {
    if (scopeTokens.size > 0) {
      await getDatabase()
        .delete(rateLimitWindows)
        .where(inArray(rateLimitWindows.scopeToken, [...scopeTokens]));
    }
    await runtimeSql.end({ timeout: 5 });
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("allows only five concurrent onboarding attempts for one user", async () => {
    rememberTokens(primaryPrincipal.subject, networkOne);
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () =>
        consumeActionRateLimit(primaryPrincipal, networkOne, "ONBOARDING"),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    const denied = decisions.filter((decision) => !decision.allowed);
    expect(denied).toHaveLength(5);
    expect(denied.every((decision) => decision.limitingScope === "USER")).toBe(true);
    expect(denied.every((decision) => decision.retryAfterSeconds > 0)).toBe(true);
  });

  it("shares a twenty-attempt network limit across distinct users", async () => {
    const principals = Array.from({ length: 21 }, (_, index) => ({
      subject: `rate_limit_network_user_${testRunId}_${index}`,
      mode: "local" as const,
    }));
    for (const principal of principals) rememberTokens(principal.subject, networkTwo);

    const decisions = await Promise.all(
      principals.map((principal) => consumeActionRateLimit(principal, networkTwo, "ONBOARDING")),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(20);
    expect(decisions.filter((decision) => !decision.allowed)).toEqual([
      expect.objectContaining({ limitingScope: "NETWORK" }),
    ]);
  });

  it("stores only keyed tokens behind a function-only runtime capability", async () => {
    const [capabilities] = await runtimeSql<
      { canReadWindows: boolean; canExecuteLimiter: boolean }[]
    >`
      select
        has_table_privilege(current_user, 'public.rate_limit_windows', 'SELECT')
          as "canReadWindows",
        has_function_privilege(
          current_user,
          'public.consume_action_rate_limit(text,text,rate_limit_action)',
          'EXECUTE'
        ) as "canExecuteLimiter"
    `;
    expect(capabilities).toEqual({ canReadWindows: false, canExecuteLimiter: true });
    await expect(runtimeSql`select * from public.rate_limit_windows`).rejects.toMatchObject({
      code: "42501",
    });

    const [functionOwner] = await runtimeSql<{ canLogin: boolean; bypassRls: boolean }[]>`
      select owner.rolcanlogin as "canLogin", owner.rolbypassrls as "bypassRls"
      from pg_proc as procedure
      inner join pg_roles as owner on owner.oid = procedure.proowner
      where procedure.oid =
        'public.consume_action_rate_limit(text,text,rate_limit_action)'::regprocedure
    `;
    expect(functionOwner).toEqual({ canLogin: false, bypassRls: true });

    const stored = await getDatabase()
      .select({ scopeToken: rateLimitWindows.scopeToken })
      .from(rateLimitWindows)
      .where(inArray(rateLimitWindows.scopeToken, [...scopeTokens]));
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(primaryPrincipal.subject);
    expect(serialized).not.toContain(networkOne);

    await expect(
      runtimeSql`
        select * from public.consume_action_rate_limit(
          'invalid',
          'invalid',
          'ONBOARDING'::public.rate_limit_action
        )
      `,
    ).rejects.toMatchObject({ code: "22023" });
  });
});
