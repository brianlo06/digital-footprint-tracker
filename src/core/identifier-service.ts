import "server-only";

import { randomUUID } from "node:crypto";
import {
  auditEvents,
  consentRecords,
  identifierLookupTokens,
  identifiers,
  identifierVerifications,
} from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import type { AuthenticatedPrincipal } from "@/security/auth";
import {
  challengeMatches,
  createChallengeHash,
  createLookupToken,
  encryptSensitiveValue,
} from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { getApplicationLookupKeyring } from "@/security/lookup-keyring";
import {
  getEmailVerificationGateway,
  type EmailVerificationGateway,
} from "@/verification/email-verification-gateway";
import { and, desc, eq, lt, sql } from "drizzle-orm";

import type { AccountContext } from "./account-service";
import { identifierLookupNamespace } from "./identifier-namespaces";
import { maskEmail, normalizeEmail } from "./identifier-normalization";

export interface IdentifierSummary {
  readonly id: string;
  readonly type: "EMAIL";
  readonly maskedDisplay: string;
  readonly verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" | "EXPIRED" | "REVOKED";
  readonly createdAt: Date;
}

const MAX_VERIFICATION_ATTEMPTS = 5;

function identifierEncryptionContext(identityId: string, identifierId: string): string {
  return `identifier:${identityId}:${identifierId}:value:v1`;
}

function accountPrincipal(account: AccountContext): AuthenticatedPrincipal {
  return { subject: account.authSubject, mode: account.authMode };
}

export async function addEmailIdentifier(
  account: AccountContext,
  rawEmail: string,
  verificationGateway: EmailVerificationGateway = getEmailVerificationGateway(),
): Promise<{ identifierId: string; verificationId: string; maskedDisplay: string }> {
  const normalized = normalizeEmail(rawEmail);
  const identifierId = randomUUID();
  const verificationId = randomUUID();
  const correlationId = randomUUID();
  const keyring = getApplicationKeyring();
  const namespace = identifierLookupNamespace("EMAIL");
  const maskedDisplay = maskEmail(normalized);
  const encryptedValue = encryptSensitiveValue(
    normalized,
    identifierEncryptionContext(account.identityId, identifierId),
    keyring,
  );
  const lookupToken = createLookupToken(normalized, namespace, keyring);
  const lookupKeyring = getApplicationLookupKeyring();
  const activeLookupKeys = lookupKeyring.previous
    ? [lookupKeyring.current, lookupKeyring.previous]
    : [lookupKeyring.current];
  const challenge = await verificationGateway.issueEmailChallenge({
    verificationId,
    destination: normalized,
  });

  await withTenantDatabase(accountPrincipal(account), async (transaction) => {
    await transaction.insert(identifiers).values({
      id: identifierId,
      identityId: account.identityId,
      type: "EMAIL",
      encryptedValue,
      lookupToken,
      normalizationVersion: "email-v1-lowercase",
      verificationStatus: "PENDING",
      sensitivity: "SENSITIVE",
      maskedDisplay,
    });
    await transaction.insert(identifierLookupTokens).values(
      activeLookupKeys.map((key) => ({
        identifierId,
        identityId: account.identityId,
        identifierType: "EMAIL" as const,
        namespace,
        normalizationVersion: "email-v1-lowercase",
        lookupKeyId: key.keyId,
        token: createLookupToken(normalized, namespace, key),
      })),
    );
    await transaction.insert(identifierVerifications).values({
      id: verificationId,
      identifierId,
      method: challenge.method,
      challengeHash: challenge.challengeHash,
      status: "PENDING",
      expiresAt: challenge.expiresAt,
    });
    await transaction.insert(consentRecords).values({
      userId: account.userId,
      identityId: account.identityId,
      purpose: "STORE_AND_VERIFY_EMAIL_IDENTIFIER",
      dataCategories: ["EMAIL_IDENTIFIER"],
      policyVersion: "phase1-v1",
      state: "GRANTED",
    });
    await transaction.insert(auditEvents).values({
      userId: account.userId,
      actorType: "USER",
      action: "IDENTIFIER_ADDED",
      targetType: "IDENTIFIER",
      targetId: identifierId,
      outcome: "SUCCESS",
      correlationId,
    });
  });

  return { identifierId, verificationId, maskedDisplay };
}

export async function listIdentifiers(account: AccountContext): Promise<IdentifierSummary[]> {
  return withTenantDatabase(accountPrincipal(account), async (transaction) => {
    return transaction
      .select({
        id: identifiers.id,
        type: identifiers.type,
        maskedDisplay: identifiers.maskedDisplay,
        verificationStatus: identifiers.verificationStatus,
        createdAt: identifiers.createdAt,
      })
      .from(identifiers)
      .where(eq(identifiers.identityId, account.identityId))
      .orderBy(desc(identifiers.createdAt)) as Promise<IdentifierSummary[]>;
  });
}

export async function verifyEmailIdentifier(
  account: AccountContext,
  verificationId: string,
  code: string,
): Promise<void> {
  if (!/^[0-9]{6}$/.test(code)) throw new Error("VERIFICATION_INVALID");

  const outcome = await withTenantDatabase(accountPrincipal(account), async (transaction) => {
    const [verification] = await transaction
      .select({
        id: identifierVerifications.id,
        identifierId: identifierVerifications.identifierId,
        challengeHash: identifierVerifications.challengeHash,
        status: identifierVerifications.status,
        expiresAt: identifierVerifications.expiresAt,
        attemptCount: identifierVerifications.attemptCount,
      })
      .from(identifierVerifications)
      .innerJoin(identifiers, eq(identifiers.id, identifierVerifications.identifierId))
      .where(
        and(
          eq(identifierVerifications.id, verificationId),
          eq(identifiers.identityId, account.identityId),
        ),
      )
      .limit(1);

    if (
      !verification ||
      verification.status !== "PENDING" ||
      verification.attemptCount >= MAX_VERIFICATION_ATTEMPTS
    ) {
      return "NOT_AVAILABLE" as const;
    }
    if (verification.expiresAt.getTime() <= Date.now()) {
      await transaction
        .update(identifierVerifications)
        .set({ status: "EXPIRED", challengeHash: "consumed" })
        .where(
          and(
            eq(identifierVerifications.id, verification.id),
            eq(identifierVerifications.status, "PENDING"),
          ),
        );
      return "EXPIRED" as const;
    }

    const actualHash = createChallengeHash(code, verification.id, getApplicationKeyring());
    if (!challengeMatches(verification.challengeHash, actualHash)) {
      const nextAttemptCount = sql<number>`${identifierVerifications.attemptCount} + 1`;
      const [updated] = await transaction
        .update(identifierVerifications)
        .set({
          attemptCount: nextAttemptCount,
          status: sql`case when ${nextAttemptCount} >= ${MAX_VERIFICATION_ATTEMPTS} then 'REVOKED'::verification_status else ${identifierVerifications.status} end`,
          challengeHash: sql`case when ${nextAttemptCount} >= ${MAX_VERIFICATION_ATTEMPTS} then 'consumed' else ${identifierVerifications.challengeHash} end`,
          lockedAt: sql`case when ${nextAttemptCount} >= ${MAX_VERIFICATION_ATTEMPTS} then now() else ${identifierVerifications.lockedAt} end`,
        })
        .where(
          and(
            eq(identifierVerifications.id, verification.id),
            eq(identifierVerifications.status, "PENDING"),
            lt(identifierVerifications.attemptCount, MAX_VERIFICATION_ATTEMPTS),
          ),
        )
        .returning({ id: identifierVerifications.id });

      if (updated) {
        await transaction.insert(auditEvents).values({
          userId: account.userId,
          actorType: "USER",
          action: "IDENTIFIER_VERIFICATION_DENIED",
          targetType: "IDENTIFIER",
          targetId: verification.identifierId,
          outcome: "DENIED",
          correlationId: randomUUID(),
        });
      }
      return updated ? ("INVALID" as const) : ("NOT_AVAILABLE" as const);
    }

    const now = new Date();
    const correlationId = randomUUID();
    const [completed] = await transaction
      .update(identifierVerifications)
      .set({ status: "VERIFIED", completedAt: now, challengeHash: "consumed" })
      .where(
        and(
          eq(identifierVerifications.id, verification.id),
          eq(identifierVerifications.status, "PENDING"),
          lt(identifierVerifications.attemptCount, MAX_VERIFICATION_ATTEMPTS),
        ),
      )
      .returning({ id: identifierVerifications.id });
    if (!completed) return "NOT_AVAILABLE" as const;
    await transaction
      .update(identifiers)
      .set({ verificationStatus: "VERIFIED", lastVerifiedAt: now })
      .where(eq(identifiers.id, verification.identifierId));
    await transaction.insert(auditEvents).values({
      userId: account.userId,
      actorType: "USER",
      action: "IDENTIFIER_VERIFIED",
      targetType: "IDENTIFIER",
      targetId: verification.identifierId,
      outcome: "SUCCESS",
      correlationId,
    });
    return "VERIFIED" as const;
  });

  if (outcome === "NOT_AVAILABLE") throw new Error("VERIFICATION_NOT_AVAILABLE");
  if (outcome === "EXPIRED") throw new Error("VERIFICATION_EXPIRED");
  if (outcome === "INVALID") throw new Error("VERIFICATION_INVALID");
}
