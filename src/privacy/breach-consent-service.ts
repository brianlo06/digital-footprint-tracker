import "server-only";

import { randomUUID } from "node:crypto";
import type { AccountContext } from "@/core/account-service";
import type { DatabaseTransaction } from "@/database/client";
import { auditEvents, consentRecords, identities, users } from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import {
  BREACH_CONSENT_DATA_CATEGORIES,
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { and, desc, eq, sql } from "drizzle-orm";

export interface BreachConsentSummary {
  readonly consentRecordId: string;
  readonly state: "GRANTED" | "WITHDRAWN";
  readonly grantedAt: Date;
  readonly withdrawnAt: Date | null;
}

export interface BreachConsentMutationResult extends BreachConsentSummary {
  readonly changed: boolean;
}

function accountPrincipal(account: AccountContext): AuthenticatedPrincipal {
  return { subject: account.authSubject, mode: account.authMode };
}

function activeBreachConsentPredicate(account: AccountContext) {
  return and(
    eq(consentRecords.userId, account.userId),
    eq(consentRecords.identityId, account.identityId),
    eq(consentRecords.purpose, BREACH_CONSENT_PURPOSE),
    eq(consentRecords.policyVersion, BREACH_CONSENT_POLICY_VERSION),
    eq(consentRecords.state, "GRANTED"),
    sql`${consentRecords.withdrawnAt} is null`,
  );
}

async function requireActiveAccountIdentity(
  account: AccountContext,
  transaction: DatabaseTransaction,
): Promise<void> {
  const [ownedAccount] = await transaction
    .select({ userId: users.id })
    .from(users)
    .innerJoin(identities, eq(identities.userId, users.id))
    .where(
      and(
        eq(users.id, account.userId),
        eq(users.authSubject, account.authSubject),
        eq(users.state, "ACTIVE"),
        eq(identities.id, account.identityId),
        eq(identities.state, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!ownedAccount) throw new Error("ACCOUNT_NOT_AVAILABLE");
}

export async function getBreachConsentSummary(
  account: AccountContext,
): Promise<BreachConsentSummary | null> {
  return withTenantDatabase(accountPrincipal(account), async (transaction) => {
    const [consent] = await transaction
      .select({
        consentRecordId: consentRecords.id,
        state: consentRecords.state,
        grantedAt: consentRecords.grantedAt,
        withdrawnAt: consentRecords.withdrawnAt,
      })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.userId, account.userId),
          eq(consentRecords.identityId, account.identityId),
          eq(consentRecords.purpose, BREACH_CONSENT_PURPOSE),
          eq(consentRecords.policyVersion, BREACH_CONSENT_POLICY_VERSION),
        ),
      )
      .orderBy(sql`${consentRecords.state} = 'GRANTED' desc`, desc(consentRecords.grantedAt))
      .limit(1);
    return consent ?? null;
  });
}

export async function grantBreachConsent(
  account: AccountContext,
): Promise<BreachConsentMutationResult> {
  return withTenantDatabase(accountPrincipal(account), async (transaction) => {
    await requireActiveAccountIdentity(account, transaction);

    const [created] = await transaction
      .insert(consentRecords)
      .values({
        userId: account.userId,
        identityId: account.identityId,
        purpose: BREACH_CONSENT_PURPOSE,
        dataCategories: [...BREACH_CONSENT_DATA_CATEGORIES],
        policyVersion: BREACH_CONSENT_POLICY_VERSION,
        state: "GRANTED",
      })
      .onConflictDoNothing()
      .returning({
        consentRecordId: consentRecords.id,
        state: consentRecords.state,
        grantedAt: consentRecords.grantedAt,
        withdrawnAt: consentRecords.withdrawnAt,
      });

    if (created) {
      await transaction.insert(auditEvents).values({
        userId: account.userId,
        actorType: "USER",
        action: "BREACH_CONSENT_GRANTED",
        targetType: "CONSENT_RECORD",
        targetId: created.consentRecordId,
        outcome: "SUCCESS",
        correlationId: randomUUID(),
      });
      return { ...created, changed: true };
    }

    const [existing] = await transaction
      .select({
        consentRecordId: consentRecords.id,
        state: consentRecords.state,
        grantedAt: consentRecords.grantedAt,
        withdrawnAt: consentRecords.withdrawnAt,
      })
      .from(consentRecords)
      .where(activeBreachConsentPredicate(account))
      .limit(1);
    if (!existing) throw new Error("CONSENT_GRANT_FAILED");
    return { ...existing, changed: false };
  });
}

export async function withdrawBreachConsent(
  account: AccountContext,
): Promise<BreachConsentMutationResult | null> {
  return withTenantDatabase(accountPrincipal(account), async (transaction) => {
    await requireActiveAccountIdentity(account, transaction);
    const [withdrawn] = await transaction
      .update(consentRecords)
      .set({ state: "WITHDRAWN", withdrawnAt: sql`now()` })
      .where(activeBreachConsentPredicate(account))
      .returning({
        consentRecordId: consentRecords.id,
        state: consentRecords.state,
        grantedAt: consentRecords.grantedAt,
        withdrawnAt: consentRecords.withdrawnAt,
      });
    if (!withdrawn) return null;

    await transaction.insert(auditEvents).values({
      userId: account.userId,
      actorType: "USER",
      action: "BREACH_CONSENT_WITHDRAWN",
      targetType: "CONSENT_RECORD",
      targetId: withdrawn.consentRecordId,
      outcome: "SUCCESS",
      correlationId: randomUUID(),
    });
    return { ...withdrawn, changed: true };
  });
}
