import { addEmailAction, verifyEmailAction } from "@/app/(protected)/identities/actions";
import { initializeAccountAction } from "@/app/(protected)/onboarding/actions";
import {
  deleteAccountAction,
  grantBreachConsentAction,
  withdrawBreachConsentAction,
} from "@/app/(protected)/settings/privacy/actions";
import { resetServerEnvForTests } from "@/config/server-env";
import { closeDatabase, getDatabase } from "@/database/client";
import {
  consentRecords,
  identifiers,
  identifierVerifications,
  rateLimitWindows,
  users,
} from "@/database/schema";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import { createLookupToken } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRuntimeDatabaseUrl = process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.REQUIRE_DATABASE_TESTS === "1" && (!testDatabaseUrl || !testRuntimeDatabaseUrl)) {
  throw new Error(
    "TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL are required for the integration test command",
  );
}
const describeWithDatabase = testDatabaseUrl && testRuntimeDatabaseUrl ? describe : describe.skip;

async function redirectedTo(action: Promise<void>): Promise<string> {
  try {
    await action;
  } catch (error) {
    const digest =
      error && typeof error === "object" && "digest" in error ? String(error.digest) : "";
    const match = /^NEXT_REDIRECT;[^;]+;([^;]+);/.exec(digest);
    if (match) return match[1];
    throw error;
  }

  throw new Error("Expected Server Action to redirect");
}

describeWithDatabase("Server Action authorization matrix", () => {
  const testRunId = Date.now();
  const uninitializedSubject = `action_uninitialized_${testRunId}`;
  const ownerSubject = `action_owner_${testRunId}`;
  const otherSubject = `action_other_${testRunId}`;

  function useSubject(subject: string): void {
    process.env.LOCAL_AUTH_SUBJECT = subject;
    resetServerEnvForTests();
  }

  function actionScopeTokens(): string[] {
    const keyring = getApplicationKeyring();
    return [uninitializedSubject, ownerSubject, otherSubject]
      .map((subject) => createLookupToken(subject, "rate-limit-user:v1", keyring))
      .concat(createLookupToken("local-development-network", "rate-limit-network:v1", keyring));
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
    process.env.ENCRYPTION_KEY_ID = "action-authorization-v1";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 37).toString("base64");
    process.env.LOOKUP_KEY = Buffer.alloc(32, 41).toString("base64");
    process.env.LOOKUP_KEY_ID = "action-authorization-lookup-v1";
    process.env.LOCAL_VERIFICATION_CODE = "000000";
    useSubject(uninitializedSubject);
    await getDatabase()
      .delete(rateLimitWindows)
      .where(inArray(rateLimitWindows.scopeToken, actionScopeTokens()));
  });

  afterAll(async () => {
    await getDatabase()
      .delete(rateLimitWindows)
      .where(inArray(rateLimitWindows.scopeToken, actionScopeTokens()));
    await closeDatabase();
    resetServerEnvForTests();
  });

  it("does not let a direct identifier action bypass explicit onboarding", async () => {
    const form = new FormData();
    form.set("email", "not-onboarded@example.test");
    form.set("consent", "on");

    await expect(redirectedTo(addEmailAction(form))).resolves.toBe("/onboarding");

    const matchingUsers = await getDatabase()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authSubject, uninitializedSubject));
    expect(matchingUsers).toHaveLength(0);

    const consentForm = new FormData();
    consentForm.set("consent", "on");
    await expect(redirectedTo(grantBreachConsentAction(consentForm))).resolves.toBe("/onboarding");
  });

  it("re-authorizes resource ownership inside direct Server Action calls", async () => {
    useSubject(ownerSubject);
    await expect(redirectedTo(initializeAccountAction())).resolves.toBe("/dashboard");

    const addForm = new FormData();
    addForm.set("email", "action-owner@example.test");
    addForm.set("consent", "on");
    const addedLocation = await redirectedTo(addEmailAction(addForm));
    const verificationId = new URL(addedLocation, "http://local.test").searchParams.get(
      "verification",
    );
    expect(verificationId).toBeTruthy();

    useSubject(otherSubject);
    await expect(redirectedTo(initializeAccountAction())).resolves.toBe("/dashboard");
    const verificationForm = new FormData();
    verificationForm.set("verificationId", verificationId!);
    verificationForm.set("code", "000000");
    await expect(redirectedTo(verifyEmailAction(verificationForm))).resolves.toBe(
      `/identities?error=verification_failed&verification=${verificationId}`,
    );

    const [ownerVerification] = await getDatabase()
      .select({
        attemptCount: identifierVerifications.attemptCount,
        identifierStatus: identifiers.verificationStatus,
        verificationStatus: identifierVerifications.status,
      })
      .from(identifierVerifications)
      .innerJoin(identifiers, eq(identifiers.id, identifierVerifications.identifierId))
      .where(eq(identifierVerifications.id, verificationId!));
    expect(ownerVerification).toEqual({
      attemptCount: 0,
      identifierStatus: "PENDING",
      verificationStatus: "PENDING",
    });

    useSubject(ownerSubject);
    const consentForm = new FormData();
    consentForm.set("consent", "on");
    await expect(redirectedTo(grantBreachConsentAction(consentForm))).resolves.toBe(
      "/settings/privacy?consent=granted",
    );

    useSubject(otherSubject);
    await expect(redirectedTo(withdrawBreachConsentAction())).resolves.toBe(
      "/settings/privacy?consent=unchanged",
    );
    const [ownerConsent] = await getDatabase()
      .select({ state: consentRecords.state, withdrawnAt: consentRecords.withdrawnAt })
      .from(consentRecords)
      .innerJoin(users, eq(users.id, consentRecords.userId))
      .where(
        and(
          eq(users.authSubject, ownerSubject),
          eq(consentRecords.purpose, BREACH_CONSENT_PURPOSE),
          eq(consentRecords.policyVersion, BREACH_CONSENT_POLICY_VERSION),
        ),
      );
    expect(ownerConsent).toEqual({ state: "GRANTED", withdrawnAt: null });

    useSubject(ownerSubject);
    await expect(redirectedTo(withdrawBreachConsentAction())).resolves.toBe(
      "/settings/privacy?consent=withdrawn",
    );

    const deletionForm = new FormData();
    deletionForm.set("confirmation", "DELETE");
    useSubject(otherSubject);
    await expect(redirectedTo(deleteAccountAction(deletionForm))).resolves.toMatch(
      /^\/deleted\?receipt=/,
    );

    const remainingSubjects = await getDatabase()
      .select({ authSubject: users.authSubject })
      .from(users)
      .where(and(eq(users.authSubject, ownerSubject), eq(users.state, "ACTIVE")));
    expect(remainingSubjects).toEqual([{ authSubject: ownerSubject }]);

    useSubject(ownerSubject);
    await expect(redirectedTo(deleteAccountAction(deletionForm))).resolves.toMatch(
      /^\/deleted\?receipt=/,
    );
  });
});
