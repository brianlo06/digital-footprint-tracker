import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
  BREACH_VERIFICATION_MAX_AGE_MS,
  evaluateBreachInvocationAuthorization,
  type BreachInvocationAuthorizationSnapshot,
} from "@/providers/breach/breach-invocation-policy";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-15T18:00:00.000Z");
const command = {
  userId: "00000000-0000-4000-8000-000000000001",
  identityId: "00000000-0000-4000-8000-000000000002",
  identifierId: "00000000-0000-4000-8000-000000000003",
  consentRecordId: "00000000-0000-4000-8000-000000000004",
};

function authorizedSnapshot(): BreachInvocationAuthorizationSnapshot {
  return {
    account: { userId: command.userId, state: "ACTIVE" },
    identity: {
      identityId: command.identityId,
      userId: command.userId,
      state: "ACTIVE",
    },
    identifier: {
      identifierId: command.identifierId,
      identityId: command.identityId,
      type: "EMAIL",
      verificationStatus: "VERIFIED",
      lastVerifiedAt: new Date(now.getTime() - 60 * 60 * 1_000),
    },
    consent: {
      consentRecordId: command.consentRecordId,
      userId: command.userId,
      identityId: command.identityId,
      purpose: BREACH_CONSENT_PURPOSE,
      policyVersion: BREACH_CONSENT_POLICY_VERSION,
      state: "GRANTED",
      dataCategories: ["EMAIL_IDENTIFIER", "BREACH_METADATA"],
      grantedAt: new Date(now.getTime() - 60 * 60 * 1_000),
      withdrawnAt: null,
    },
  };
}

describe("breach invocation authorization", () => {
  it("allows only a recently verified self-email with exact Phase 2 consent", () => {
    expect(evaluateBreachInvocationAuthorization(command, authorizedSnapshot(), now)).toBeNull();
  });

  it("returns a generic denial when the resource is absent or ownership does not align", () => {
    expect(evaluateBreachInvocationAuthorization(command, null, now)).toBe(
      "RESOURCE_NOT_AVAILABLE",
    );
    const snapshotBase = authorizedSnapshot();
    const snapshot = {
      ...snapshotBase,
      identity: {
        ...snapshotBase.identity,
        userId: "00000000-0000-4000-8000-000000000099",
      },
    };
    expect(evaluateBreachInvocationAuthorization(command, snapshot, now)).toBe(
      "RESOURCE_NOT_AVAILABLE",
    );
  });

  it("requires active account and identity state", () => {
    const accountBase = authorizedSnapshot();
    const accountInactive: BreachInvocationAuthorizationSnapshot = {
      ...accountBase,
      account: { ...accountBase.account, state: "DELETION_PENDING" },
    };
    expect(evaluateBreachInvocationAuthorization(command, accountInactive, now)).toBe(
      "ACCOUNT_NOT_ACTIVE",
    );

    const identityBase = authorizedSnapshot();
    const identityInactive: BreachInvocationAuthorizationSnapshot = {
      ...identityBase,
      identity: { ...identityBase.identity, state: "ARCHIVED" },
    };
    expect(evaluateBreachInvocationAuthorization(command, identityInactive, now)).toBe(
      "IDENTITY_NOT_ACTIVE",
    );
  });

  it("rejects missing, stale, and future verification evidence", () => {
    const unverifiedBase = authorizedSnapshot();
    const unverified: BreachInvocationAuthorizationSnapshot = {
      ...unverifiedBase,
      identifier: {
        ...unverifiedBase.identifier,
        verificationStatus: "PENDING",
        lastVerifiedAt: null,
      },
    };
    expect(evaluateBreachInvocationAuthorization(command, unverified, now)).toBe(
      "IDENTIFIER_NOT_VERIFIED",
    );

    const staleBase = authorizedSnapshot();
    const stale: BreachInvocationAuthorizationSnapshot = {
      ...staleBase,
      identifier: {
        ...staleBase.identifier,
        lastVerifiedAt: new Date(now.getTime() - BREACH_VERIFICATION_MAX_AGE_MS - 1),
      },
    };
    expect(evaluateBreachInvocationAuthorization(command, stale, now)).toBe("VERIFICATION_STALE");

    const futureBase = authorizedSnapshot();
    const future: BreachInvocationAuthorizationSnapshot = {
      ...futureBase,
      identifier: {
        ...futureBase.identifier,
        lastVerifiedAt: new Date(now.getTime() + 1),
      },
    };
    expect(evaluateBreachInvocationAuthorization(command, future, now)).toBe("VERIFICATION_STALE");
  });

  it("rejects withdrawn, future, or incorrectly scoped consent", () => {
    const withdrawnBase = authorizedSnapshot();
    const withdrawn: BreachInvocationAuthorizationSnapshot = {
      ...withdrawnBase,
      consent: {
        ...withdrawnBase.consent,
        state: "WITHDRAWN",
        withdrawnAt: new Date(now),
      },
    };
    expect(evaluateBreachInvocationAuthorization(command, withdrawn, now)).toBe(
      "CONSENT_NOT_GRANTED",
    );

    const futureBase = authorizedSnapshot();
    const future: BreachInvocationAuthorizationSnapshot = {
      ...futureBase,
      consent: { ...futureBase.consent, grantedAt: new Date(now.getTime() + 1) },
    };
    expect(evaluateBreachInvocationAuthorization(command, future, now)).toBe("CONSENT_NOT_GRANTED");

    const wrongPolicyBase = authorizedSnapshot();
    const wrongPolicy: BreachInvocationAuthorizationSnapshot = {
      ...wrongPolicyBase,
      consent: { ...wrongPolicyBase.consent, policyVersion: "phase1-v1" },
    };
    expect(evaluateBreachInvocationAuthorization(command, wrongPolicy, now)).toBe(
      "CONSENT_SCOPE_INVALID",
    );

    const missingCategoryBase = authorizedSnapshot();
    const missingCategory: BreachInvocationAuthorizationSnapshot = {
      ...missingCategoryBase,
      consent: { ...missingCategoryBase.consent, dataCategories: ["EMAIL_IDENTIFIER"] },
    };
    expect(evaluateBreachInvocationAuthorization(command, missingCategory, now)).toBe(
      "CONSENT_SCOPE_INVALID",
    );
  });

  it("rejects an invalid evaluation clock", () => {
    expect(() =>
      evaluateBreachInvocationAuthorization(command, authorizedSnapshot(), new Date("invalid")),
    ).toThrowError("PROVIDER_INVOCATION_NOW_INVALID");
  });
});
