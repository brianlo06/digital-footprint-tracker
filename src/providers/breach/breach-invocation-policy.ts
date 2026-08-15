export const BREACH_CONSENT_PURPOSE = "BREACH_METADATA_LOOKUP";
export const BREACH_CONSENT_POLICY_VERSION = "phase2-breach-v1";
export const BREACH_CONSENT_DATA_CATEGORIES = ["EMAIL_IDENTIFIER", "BREACH_METADATA"] as const;
export const BREACH_VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export interface BreachInvocationCommandIdentity {
  readonly userId: string;
  readonly identityId: string;
  readonly identifierId: string;
  readonly consentRecordId: string;
}

export interface BreachInvocationAuthorizationSnapshot {
  readonly account: {
    readonly userId: string;
    readonly state: "ACTIVE" | "DELETION_PENDING";
  };
  readonly identity: {
    readonly identityId: string;
    readonly userId: string;
    readonly state: "ACTIVE" | "ARCHIVED";
  };
  readonly identifier: {
    readonly identifierId: string;
    readonly identityId: string;
    readonly type: "EMAIL";
    readonly verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" | "EXPIRED" | "REVOKED";
    readonly lastVerifiedAt: Date | null;
  };
  readonly consent: {
    readonly consentRecordId: string;
    readonly userId: string;
    readonly identityId: string;
    readonly purpose: string;
    readonly policyVersion: string;
    readonly state: "GRANTED" | "WITHDRAWN";
    readonly dataCategories: readonly string[];
    readonly grantedAt: Date;
    readonly withdrawnAt: Date | null;
  };
}

export type BreachInvocationDenialReason =
  | "RESOURCE_NOT_AVAILABLE"
  | "ACCOUNT_NOT_ACTIVE"
  | "IDENTITY_NOT_ACTIVE"
  | "IDENTIFIER_NOT_VERIFIED"
  | "VERIFICATION_STALE"
  | "CONSENT_NOT_GRANTED"
  | "CONSENT_SCOPE_INVALID";

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function evaluateBreachInvocationAuthorization(
  command: BreachInvocationCommandIdentity,
  snapshot: BreachInvocationAuthorizationSnapshot | null,
  now: Date,
): BreachInvocationDenialReason | null {
  if (!validDate(now)) throw new Error("PROVIDER_INVOCATION_NOW_INVALID");
  if (!snapshot) return "RESOURCE_NOT_AVAILABLE";

  const ownershipMatches =
    snapshot.account.userId === command.userId &&
    snapshot.identity.identityId === command.identityId &&
    snapshot.identity.userId === command.userId &&
    snapshot.identifier.identifierId === command.identifierId &&
    snapshot.identifier.identityId === command.identityId &&
    snapshot.consent.consentRecordId === command.consentRecordId &&
    snapshot.consent.userId === command.userId &&
    snapshot.consent.identityId === command.identityId;
  if (!ownershipMatches) return "RESOURCE_NOT_AVAILABLE";

  if (snapshot.account.state !== "ACTIVE") return "ACCOUNT_NOT_ACTIVE";
  if (snapshot.identity.state !== "ACTIVE") return "IDENTITY_NOT_ACTIVE";
  if (
    snapshot.identifier.type !== "EMAIL" ||
    snapshot.identifier.verificationStatus !== "VERIFIED" ||
    !snapshot.identifier.lastVerifiedAt ||
    !validDate(snapshot.identifier.lastVerifiedAt)
  ) {
    return "IDENTIFIER_NOT_VERIFIED";
  }

  const verificationAge = now.getTime() - snapshot.identifier.lastVerifiedAt.getTime();
  if (verificationAge < 0 || verificationAge > BREACH_VERIFICATION_MAX_AGE_MS) {
    return "VERIFICATION_STALE";
  }

  if (
    snapshot.consent.state !== "GRANTED" ||
    snapshot.consent.withdrawnAt !== null ||
    !validDate(snapshot.consent.grantedAt) ||
    snapshot.consent.grantedAt.getTime() > now.getTime()
  ) {
    return "CONSENT_NOT_GRANTED";
  }

  const categories = new Set(snapshot.consent.dataCategories);
  if (
    snapshot.consent.purpose !== BREACH_CONSENT_PURPOSE ||
    snapshot.consent.policyVersion !== BREACH_CONSENT_POLICY_VERSION ||
    categories.size !== BREACH_CONSENT_DATA_CATEGORIES.length ||
    !BREACH_CONSENT_DATA_CATEGORIES.every((category) => categories.has(category))
  ) {
    return "CONSENT_SCOPE_INVALID";
  }

  return null;
}
